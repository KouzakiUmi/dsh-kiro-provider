import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { KiroProblem } from './cli.mjs';
import { kiroFailure } from './direct-http.mjs';
import { object } from './direct-wire.mjs';

const utf8 = new TextDecoder('utf8', { fatal: true });
const malformed = () => new KiroProblem('Kiro 的事件流不完整或格式错误。', 'MALFORMED_RESPONSE');
const eventErrors = new Set(['error', 'throttlingError', 'validationError', 'serviceUnavailableError', 'internalServerException']);

function headersOf(buf) {
  const values = new Map();
  for (let i = 0; i < buf.length;) {
    const nameLen = buf[i++];
    if (!nameLen || i + nameLen >= buf.length) throw malformed();
    const name = utf8.decode(buf.subarray(i, i + nameLen));
    i += nameLen;
    const type = buf[i++];
    if (type === 6 || type === 7) {
      if (i + 2 > buf.length) throw malformed();
      const len = buf.readUInt16BE(i); i += 2;
      if (i + len > buf.length) throw malformed();
      if (type === 7) values.set(name, utf8.decode(buf.subarray(i, i + len)));
      i += len;
    } else {
      const size = [0, 0, 1, 2, 4, 8, undefined, undefined, 8, 16][type];
      if (size === undefined || i + size > buf.length) throw malformed();
      i += size;
    }
  }
  return values;
}

function frame(buf, headersLength) {
  if (crc32(buf.subarray(0, -4)) !== buf.readUInt32BE(buf.length - 4)) throw malformed();
  const headers = headersOf(buf.subarray(12, 12 + headersLength));
  const payload = buf.subarray(12 + headersLength, -4);
  let value;
  try { value = payload.length ? JSON.parse(utf8.decode(payload)) : {}; } catch { throw malformed(); }
  if (!object(value)) throw malformed();
  return { type: headers.get(':message-type'), event: headers.get(':event-type'), exception: headers.get(':exception-type'), value };
}

export async function* decodeFrames(body) {
  let remaining = Buffer.alloc(0);
  for await (const piece of body) {
    remaining = remaining.length ? Buffer.concat([remaining, piece]) : Buffer.from(piece);
    while (remaining.length >= 12) {
      const total = remaining.readUInt32BE(0);
      const h = remaining.readUInt32BE(4);
      if (total < 16 || total > 16_000_000 || h > total - 16 || h > 131_072 || crc32(remaining.subarray(0, 8)) !== remaining.readUInt32BE(8)) throw malformed();
      if (remaining.length < total) break;
      yield frame(remaining.subarray(0, total), h);
      remaining = remaining.subarray(total);
    }
  }
  if (remaining.length) throw malformed();
}

const event = (type, data = {}) => ({ type, ...data });
const usageOf = u => ({ input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite });
const count = x => Number.isSafeInteger(x) && x >= 0 ? x : 0;
const finishReason = (stop, tools) => {
  const value = String(stop ?? '').toLowerCase();
  if (value === 'model_context_window_exceeded') return 'model_context_window_exceeded';
  if (value === 'content_filtered' || value === 'refusal') return 'refusal';
  if (value === 'max_tokens') return 'max_tokens';
  return tools ? 'tool_use' : 'end_turn';
};

class MessagesEvents {
  index = -1;
  current;
  tools = 0;
  usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  stop;

  *close() {
    if (!this.current) return;
    if (this.current.type === 'tool') {
      const args = this.current.args;
      if (args) { try { if (!object(JSON.parse(args))) throw malformed(); } catch { throw malformed(); } }
    }
    this.current = undefined;
    yield event('content_block_stop', { index: this.index });
  }

  *start(type, id, content) {
    yield* this.close();
    this.current = { type, id, args: '' };
    yield event('content_block_start', { index: ++this.index, content_block: content });
  }

  delta(type, value) { return event('content_block_delta', { index: this.index, delta: { type, ...value } }); }

  *push(kind, m, names) {
    if (kind === 'assistantResponseEvent' && typeof m.content === 'string' && m.content) {
      if (this.current?.type !== 'text') yield* this.start('text', undefined, { type: 'text', text: '' });
      yield this.delta('text_delta', { text: m.content });
    } else if (kind === 'reasoningContentEvent' && typeof m.text === 'string' && m.text) {
      if (this.current?.type !== 'thinking') yield* this.start('thinking', undefined, { type: 'thinking', thinking: '' });
      yield this.delta('thinking_delta', { thinking: m.text });
    } else if (kind === 'toolUseEvent') {
      if (m.toolUseId && m.toolUseId !== this.current?.id) {
        const name = names.get(m.name);
        if (!name || typeof m.toolUseId !== 'string' || m.toolUseId.length > 160) throw new KiroProblem('Kiro 返回了未声明的工具或无效调用标识。', 'INVALID_RESPONSE');
        ++this.tools;
        yield* this.start('tool', m.toolUseId, { type: 'tool_use', id: m.toolUseId, name, input: {} });
      }
      if (this.current?.type !== 'tool') throw malformed();
      const fragment = typeof m.input === 'string' ? m.input : object(m.input) && Object.keys(m.input).length ? JSON.stringify(m.input) : '';
      if (fragment) {
        this.current.args += fragment;
        if (this.current.args.length > 1_000_000) throw malformed();
        yield this.delta('input_json_delta', { partial_json: fragment });
      }
    } else if (kind === 'metadataEvent' || kind === 'messageMetadataEvent') {
      if (typeof m.stopReason === 'string') this.stop = m.stopReason;
      if (object(m.tokenUsage)) {
        if (m.tokenUsage.uncachedInputTokens !== undefined || m.tokenUsage.inputTokens !== undefined) this.usage.input = count(m.tokenUsage.uncachedInputTokens ?? m.tokenUsage.inputTokens);
        if (m.tokenUsage.outputTokens !== undefined) this.usage.output = count(m.tokenUsage.outputTokens);
        if (m.tokenUsage.cacheReadInputTokens !== undefined) this.usage.cacheRead = count(m.tokenUsage.cacheReadInputTokens);
        if (m.tokenUsage.cacheWriteInputTokens !== undefined) this.usage.cacheWrite = count(m.tokenUsage.cacheWriteInputTokens);
      }
    }
  }
}

async function* transform(body, row, names) {
  const blocks = new MessagesEvents();
  yield event('message_start', { message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: row.id,
    content: [], stop_reason: null, stop_sequence: null, usage: usageOf(blocks.usage) } });
  for await (const { type, event: kind, exception, value } of decodeFrames(body)) {
    if (type === 'exception' || type === 'error' || eventErrors.has(kind)) throw kiroFailure(0, `${exception || kind || ''} ${typeof value.reason === 'string' ? value.reason : ''} ${typeof value.message === 'string' ? value.message : ''}`);
    yield* blocks.push(kind, value, names);
  }
  yield* blocks.close();
  const stop = finishReason(blocks.stop, blocks.tools);
  if (blocks.index < 0 && stop === 'end_turn') throw new KiroProblem('Kiro 返回空响应。', 'EMPTY_RESPONSE');
  yield event('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: usageOf(blocks.usage) });
  yield event('message_stop');
}

// In-memory Messages compatibility layer for the existing DSH PiAiAdapter.
export function messagesResponse(body, row, names, { onFailure, signal, cancel } = {}) {
  const stream = transform(body, row, names);
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await stream.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`));
      } catch (error) {
        const failure = signal?.aborted || error?.name === 'AbortError' ? new KiroProblem('Kiro 请求已取消。', 'ABORTED') : error instanceof KiroProblem ? error : malformed();
        onFailure?.(failure);
        controller.error(failure);
      }
    },
    async cancel() { cancel?.(); await stream.return(); if (!body.locked) await body.cancel().catch(() => {}); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
