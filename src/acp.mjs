import { StringDecoder } from 'node:string_decoder';
import { classifyCliFailure, KiroProblem, spawnKiro } from './cli.mjs';

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const MAX_LINE = 2_000_000;

export function lineReader(stream, handle, fail, limit = MAX_LINE) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  stream.on('data', chunk => {
    pending += decoder.write(chunk);
    for (let pos = pending.indexOf('\n'); pos >= 0; pos = pending.indexOf('\n')) {
      if (pos > limit) { fail(new Error('Kiro 返回的单条消息超过上限。')); return; }
      const line = pending.slice(0, pos).trim();
      pending = pending.slice(pos + 1);
      if (line) handle(line);
    }
    if (pending.length > limit) fail(new Error('Kiro 返回的单条消息超过上限。'));
  });
}

function permissionResult(params) {
  const reject = Array.isArray(params?.options) && params.options.find(x => x?.kind === 'reject_once' && typeof x.optionId === 'string');
  return { outcome: reject ? { outcome: 'selected', optionId: reject.optionId } : { outcome: 'cancelled' } };
}

export class AcpConnection {
  #child;
  #next = 0;
  #pending = new Map();
  #listeners = new Set();
  #failure;
  #closed;

  constructor(binary, options, { spawn = spawnKiro, signal } = {}) {
    this.#child = spawn(binary, ['acp', '--agent-engine=v3', '--auth-method=cli'], options);
    const closed = new Promise(resolve => this.#child.once('close', resolve));
    this.#closed = closed;
    const abort = () => this.#fail(new Error('Kiro 请求已取消。'));
    signal?.addEventListener('abort', abort, { once: true });
    this.#child.once('close', () => {
      signal?.removeEventListener('abort', abort);
      this.#fail(new Error('Kiro ACP 连接已关闭。'));
    });
    this.#child.on('error', () => this.#fail(new Error('无法启动 Kiro CLI。')));
    this.#child.stdin.on('error', () => this.#fail(new Error('无法写入 Kiro ACP 连接。')));
    this.#child.stderr.resume();
    lineReader(this.#child.stdout, line => this.#line(line), error => this.#fail(error));
    if (signal?.aborted) abort();
  }

  #send(frame) {
    if (this.#failure) return;
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
  }

  #line(line) {
    if (this.#failure) return;
    let message;
    try { message = JSON.parse(line); } catch { this.#fail(new Error('Kiro ACP 返回了无效消息。')); return; }
    if (!isRecord(message) || message.jsonrpc !== '2.0') return;
    if (typeof message.method === 'string') {
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        if (message.method === 'session/request_permission') this.#send({ id: message.id, result: permissionResult(message.params) });
        else this.#send({ id: message.id, error: { code: -32601, message: 'Method not available in DSH' } });
        return;
      }
      if (message.method === 'session/update') {
        for (const notify of this.#listeners) notify(message.params);
      }
      return;
    }
    const request = this.#pending.get(message.id);
    if (!request) return;
    if (isRecord(message.error)) {
      // Provider messages can carry account or prompt fragments; classify without exposing them.
      const text = typeof message.error.message === 'string' ? message.error.message : '';
      const failure = classifyCliFailure(text);
      request.reject(failure.code === 'TRANSPORT' ? new KiroProblem('Kiro 拒绝了 ACP 请求。') : failure);
    } else if (Object.hasOwn(message, 'result')) request.resolve(message.result);
    else request.reject(new Error('Kiro ACP 返回缺少结果。'));
  }

  #fail(error) {
    if (this.#failure) return;
    this.#failure = error;
    for (const request of this.#pending.values()) request.reject(error);
    this.#listeners.clear();
    if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill();
  }

  request(method, params = {}, timeout = 20_000) {
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      const id = ++this.#next;
      const timer = setTimeout(() => this.#fail(new Error('等待 Kiro ACP 响应超时。')), timeout);
      const release = next => result => { clearTimeout(timer); this.#pending.delete(id); next(result); };
      this.#pending.set(id, { resolve: release(resolve), reject: release(reject) });
      this.#send({ id, method, params });
    });
  }

  subscribe(callback) {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  async close(sessionId) {
    if (sessionId) this.#send({ method: 'session/cancel', params: { sessionId } });
    this.#child.stdin.end();
    this.#fail(new Error('Kiro ACP 连接已关闭。'));
    await this.#closed;
  }
}
