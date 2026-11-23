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

const nonNeg = n => Number.isSafeInteger(n) && n >= 0 ? n : undefined;
const positiveInt = n => Number.isSafeInteger(n) && n > 0 ? n : undefined;
const finitePct = n => typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

function parseTokenUsage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const outputTokens = nonNeg(raw.outputTokens ?? raw.output_tokens);
  const cacheReadTokens = nonNeg(raw.cachedReadTokens ?? raw.cacheReadTokens ?? raw.cacheReadInputTokens ?? raw.cache_read_input_tokens);
  const cacheWriteTokens = nonNeg(raw.cachedWriteTokens ?? raw.cacheWriteTokens ?? raw.cacheWriteInputTokens ?? raw.cache_write_input_tokens);
  const reasoningTokens = nonNeg(raw.thoughtTokens ?? raw.reasoningTokens ?? raw.reasoning_tokens);
  const directInput = nonNeg(raw.uncachedInputTokens ?? raw.inputTokens ?? raw.input_tokens);
  const totalTokens = nonNeg(raw.totalTokens ?? raw.total_tokens);
  if ([directInput, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens].every(v => v === undefined)) return undefined;
  const out = outputTokens ?? 0;
  const cacheRead = cacheReadTokens ?? 0;
  const cacheWrite = cacheWriteTokens ?? 0;
  const input = directInput ?? (totalTokens !== undefined ? Math.max(0, totalTokens - out - cacheRead - cacheWrite) : 0);
  return {
    inputTokens: input,
    outputTokens: out,
    ...(totalTokens !== undefined ? { totalTokens } : { totalTokens: input + out + cacheRead + cacheWrite }),
    ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    ...(reasoningTokens !== undefined && reasoningTokens > 0 ? { reasoningTokens } : {}),
  };
}

function resolveAcpUsage({ resultUsage, metaUsage, used, contextPercentage, contextWindow, outputChars }) {
  const candidate = resultUsage ?? metaUsage;
  if (candidate) {
    const hasPrompt = candidate.inputTokens > 0 || (candidate.cacheReadTokens ?? 0) > 0 || (candidate.cacheWriteTokens ?? 0) > 0;
    if (hasPrompt) return candidate;
    const recovered = used ?? (contextPercentage && contextWindow ? Math.round((contextPercentage / 100) * contextWindow) : 0);
    if (recovered > 0) {
      const outputTokens = candidate.outputTokens || (outputChars > 0 ? Math.max(1, Math.round(outputChars / 4)) : 0);
      return {
        ...candidate,
        inputTokens: recovered,
        outputTokens,
        totalTokens: recovered + outputTokens + (candidate.cacheReadTokens ?? 0) + (candidate.cacheWriteTokens ?? 0),
      };
    }
    return candidate.outputTokens > 0 || candidate.totalTokens > 0 || used === 0 ? candidate : undefined;
  }
  const inputTokens = used ?? (contextPercentage && contextWindow ? Math.round((contextPercentage / 100) * contextWindow) : undefined);
  if (inputTokens === undefined) return undefined;
  return { inputTokens, outputTokens: 0, totalTokens: inputTokens };
}

function updateFor(params, id) {
  if (params?.sessionId !== id || params.update?._meta?.kiro?.replay === true) return;
  if (params._notification === '_kiro.dev/metadata') return { kind: 'metadata', data: params };
  const update = params.update;
  if (!update || typeof update !== 'object') return;
  if (update.sessionUpdate === 'usage_update') return { kind: 'usage_update', data: update };
  if (update.sessionUpdate === '_kiro.dev/metadata') return { kind: 'metadata', data: update };
  if (update.content?.type !== 'text' || typeof update.content.text !== 'string') return;
  if (update.sessionUpdate === 'agent_message_chunk') return { kind: 'chunk', channel: 'text', text: update.content.text };
  if (update.sessionUpdate === 'agent_thought_chunk') return { kind: 'chunk', channel: 'reasoning', text: update.content.text };
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
    let observedUsed, observedWindow = positiveInt(options.nativeContextWindow), contextPercentage, metaUsage, outputChars = 0;
    const notify = () => { wake?.(); wake = undefined; };
    const recordMeta = data => {
      const parsed = parseTokenUsage(data?.tokenUsage);
      if (parsed) metaUsage = parsed;
      contextPercentage = finitePct(data?.contextUsagePercentage) ?? finitePct(data?.tokenUsage?.contextUsagePercentage) ?? contextPercentage;
    };
    unsubscribe = connection.subscribe(params => {
      const event = updateFor(params, id);
      if (!event || failure) return;
      if (event.kind === 'usage_update') {
        const nextWindow = positiveInt(event.data.size);
        if (nextWindow) {
          observedWindow = nextWindow;
          options.onContextWindow?.(nextWindow);
        }
        const used = nonNeg(event.data.used);
        if (used !== undefined) observedUsed = used;
        return;
      }
      if (event.kind === 'metadata') { recordMeta(event.data); return; }
      if (!event.text) return;
      size += Buffer.byteLength(event.text);
      if (size > MAX_OUTPUT || ++count > 20_000) failure = new Error('Kiro 响应超过 2 MB 或分片上限。');
      else queue.push([event.channel, event.text]);
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
        outputChars += delta.length;
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
    recordMeta(result?._meta?.kiro ?? result?._meta);
    for (const [type, block] of blocks) yield { type: 'block-end', index: block.index, block: { type, text: block.chunks.join('') } };
    const usage = resolveAcpUsage({
      resultUsage: parseTokenUsage(result?.usage ?? result?._meta?.usage),
      metaUsage, used: observedUsed, contextPercentage, contextWindow: observedWindow, outputChars,
    });
    const kind = new Map([['end_turn', 'stop'], ['max_tokens', 'max-tokens'], ['cancelled', 'aborted'], ['refusal', 'refusal']]).get(result?.stopReason);
    if (!kind || (!blocks.has('text') && kind === 'stop')) throw new Error('Kiro 未返回可用回答。');
    if (usage) yield { type: 'usage', usage };
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
