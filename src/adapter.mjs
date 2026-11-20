import { AcpConnection } from './acp.mjs';
import { AGENT_ID, KiroProblem, runKiro } from './cli.mjs';

const MAX_PROMPT = 1_000_000;
const MAX_OUTPUT = 2_000_000;

export function promptOf({ system, messages }) {
  if (!Array.isArray(messages) || !messages.length) throw new KiroProblem('Kiro 请求没有消息。');
  const parts = system ? [{ role: 'system', content: [{ type: 'text', text: system }] }] : [];
  const history = [...parts, ...messages].map(message => {
    const content = message.content.flatMap(block => {
      if (block.type === 'text') return [block.text];
      if (block.type === 'tool-call') return [`Tool call ${block.name} (${block.id}): ${block.arguments}`];
      if (block.type === 'image') throw new KiroProblem('此 Kiro 路由当前仅支持文本输入。', 'UNSUPPORTED_CONTENT');
      return [];
    });
    return { role: message.role, ...(message.role === 'tool' ? { callId: message.toolCallId } : {}), content };
  }).filter(message => message.content.length);
  const prompt = `Continue the following DSH conversation and answer its latest request. The JSON entries are ordered transcript messages. Tool-call history is context only; answer with text.\n${JSON.stringify(history)}`;
  if (!history.length || Buffer.byteLength(prompt) > MAX_PROMPT) throw new KiroProblem('Kiro 文本请求为空或超过 1 MB。');
  return prompt;
}

function selectedOption(session, id) {
  const options = Array.isArray(session?.configOptions) ? session.configOptions : [];
  return options.find(option => option?.id === id)?.currentValue;
}

export async function openSession(connection, cwd, model, effort) {
  const hello = await connection.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-kiro-provider', version: '0.1.0-alpha.1' } });
  if (hello?.protocolVersion !== 1) throw new Error('Kiro ACP 协议版本不兼容。');
  const session = await connection.request('session/new', { cwd, mcpServers: [], _meta: { kiro: { modeId: AGENT_ID, modelId: model, ...(effort ? { effortLevel: effort } : {}) } } });
  if (typeof session?.sessionId !== 'string' || !session.sessionId) throw new Error('Kiro 没有返回会话 ID。');
  const mode = session.modes?.currentModeId ?? selectedOption(session, 'mode');
  if (mode !== AGENT_ID) throw new KiroProblem('Kiro 没有启用 DSH 限制模式；请求未发送。');
  if (selectedOption(session, 'model') !== model) throw new KiroProblem('Kiro 未确认所选模型；请求未发送。', 'MODEL_UNSUPPORTED');
  if (effort && selectedOption(session, 'effortLevel') !== effort) throw new KiroProblem('Kiro 未确认所选思考档位；请求未发送。');
  return { session, extensions: hello.agentCapabilities?._meta?.kiro?.extensionMethods ?? [] };
}

function updateFor(params, id) {
  if (params?.sessionId !== id || params.update?._meta?.kiro?.replay === true) return;
  const update = params.update;
  if (update?.content?.type !== 'text' || typeof update.content.text !== 'string') return;
  if (update.sessionUpdate === 'agent_message_chunk') return ['text', update.content.text];
  if (update.sessionUpdate === 'agent_thought_chunk') return ['reasoning', update.content.text];
}

async function* streamAcp(target, options, prompt, connect) {
  const connection = connect(target.binary, target.process, { signal: options.signal });
  let id;
  let unsubscribe;
  try {
    const { session } = await openSession(connection, target.process.cwd, options.model, options.reasoningEffort);
    id = session.sessionId;
    const queue = [];
    let count = 0, size = 0, wake, done = false, result, failure;
    const notify = () => { wake?.(); wake = undefined; };
    unsubscribe = connection.subscribe(params => {
      const update = updateFor(params, id);
      if (!update || !update[1] || failure) return;
      size += Buffer.byteLength(update[1]);
      if (size > MAX_OUTPUT || ++count > 20_000) failure = new Error('Kiro 响应超过 2 MB 或分片上限。');
      else queue.push(update);
      notify();
    });
    const terminal = connection.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: prompt }] }, 240_000).then(
      value => { result = value; }, error => { failure ??= error; },
    ).finally(() => { done = true; notify(); });
    const blocks = new Map();
    while (!done || queue.length) {
      if (failure) throw failure;
      if (!queue.length) { await new Promise(resolve => { wake = resolve; }); continue; }
      const batch = queue.splice(0);
      for (const [type, delta] of batch) {
        let block = blocks.get(type);
        if (!block) {
          block = { index: blocks.size, chunks: [] };
          blocks.set(type, block);
          yield { type: 'block-start', index: block.index, blockType: type };
        }
        block.chunks.push(delta);
        yield { type: `${type}-delta`, index: block.index, text: delta };
      }
    }
    await terminal;
    if (failure) throw failure;
    for (const [type, block] of blocks) yield { type: 'block-end', index: block.index, block: { type, text: block.chunks.join('') } };
    const kind = new Map([['end_turn', 'stop'], ['max_tokens', 'max-tokens'], ['cancelled', 'aborted'], ['refusal', 'refusal']]).get(result?.stopReason);
    if (!kind || (!blocks.has('text') && kind === 'stop')) throw new Error('Kiro 未返回可用回答。');
    if (kind === 'refusal') yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTENT_REFUSED', message: 'Kiro 拒绝回答此请求。' } } };
    else if (kind === 'aborted') yield { type: 'finish', reason: { kind, failure: { code: 'ABORTED', message: 'Kiro 请求已取消。' } } };
    else yield { type: 'finish', reason: { kind } };
  } finally {
    unsubscribe?.();
    await connection.close(id);
  }
}

async function* streamHeadless(target, options, prompt, run) {
  const { code, stdout, failure } = await run(target.binary, ['chat', '--v3', '--no-interactive', '--agent', AGENT_ID, '--model', options.model,
    ...(options.reasoningEffort ? ['--effort', options.reasoningEffort] : [])], target.process, { input: prompt, signal: options.signal, timeout: 240_000, limit: MAX_OUTPUT });
  if (failure) throw failure;
  if (code !== 0) throw new KiroProblem('Kiro API Key 请求失败；请检查 Key、订阅和 Kiro CLI 版本。', 'TRANSPORT');
  const text = stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (!text) throw new Error('Kiro 没有返回文本。');
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

export function generate(target, options, { connect = (...args) => new AcpConnection(...args), run = runKiro } = {}) {
  const prompt = promptOf(options);
  if (options.stop?.length || options.temperature !== undefined || options.maxTokens !== undefined) throw new KiroProblem('Kiro CLI 路由不支持 stop、temperature 或 maxTokens 参数。');
  return target.mode === 'key' ? streamHeadless(target, options, prompt, run) : streamAcp(target, options, prompt, connect);
}
