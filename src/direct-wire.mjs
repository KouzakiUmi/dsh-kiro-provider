import { createHash, randomUUID } from 'node:crypto';
import { KiroProblem } from './cli.mjs';

export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const validName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const validCall = /^[A-Za-z0-9_-]{1,100}$/;
const asId = id => typeof id === 'string' && validCall.test(id) ? id : `dsh_${hash(String(id)).slice(0, 48)}`;
const invalid = message => { throw new KiroProblem(message, 'INVALID_REQUEST'); };
const parts = content => typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
const textOf = content => parts(content).filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n\n');
const join = (...s) => s.filter(Boolean).join('\n\n');

// The same mapping applies to declarations, history, and reverse streaming lookup.
export function nameMap(declared, historical) {
  const names = [...new Set([...declared, ...historical])].sort();
  const used = new Set(names.filter(n => validName.test(n)));
  const forward = new Map();
  const reverse = new Map();
  for (const name of names) {
    if (validName.test(name)) continue;
    const text = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 27);
    let i = 0, alias;
    do { alias = `dsh_${text}_${hash(JSON.stringify([name, i++])).slice(0, 28)}`; } while (used.has(alias));
    used.add(alias); forward.set(name, alias);
  }
  for (const name of declared) reverse.set(forward.get(name) ?? name, name);
  return { toWire: name => forward.get(name) ?? name, reverse };
}

function addImage(message, part, row) {
  const type = /^(?:image\/)(png|jpeg|webp|gif)$/.exec(part.source?.media_type)?.[1];
  const bytes = part.source?.data;
  if (!row.inputModalities.includes('image') || !type || part.source?.type !== 'base64' || typeof bytes !== 'string' || bytes.length > 5_000_000) invalid('Kiro 无法发送此图片。');
  (message.images ??= []).push({ format: type, source: { bytes } });
}

function assistantMessage(blocks, names) {
  const toolUses = [];
  for (const p of blocks) if (p?.type === 'tool_use') {
    if (typeof p.name !== 'string' || typeof p.id !== 'string') invalid('Kiro 工具历史缺少调用标识。');
    toolUses.push({ name: names.toWire(p.name), toolUseId: asId(p.id), input: object(p.input) ? p.input : {} });
  }
  return { content: textOf(blocks), ...(toolUses.length ? { toolUses } : {}) };
}

function userMessage(blocks, row) {
  const u = { content: textOf(blocks), modelId: row.id, origin: 'AI_EDITOR' };
  const results = [];
  for (const p of blocks) {
    if (p?.type === 'image') addImage(u, p, row);
    if (p?.type !== 'tool_result') continue;
    if (typeof p.tool_use_id !== 'string') invalid('Kiro 工具结果缺少调用标识。');
    for (const c of parts(p.content)) if (c?.type === 'image') addImage(u, c, row);
    const text = textOf(p.content);
    results.push({ toolUseId: asId(p.tool_use_id), status: p.is_error ? 'error' : 'success', content: [{ text: text.slice(0, 249_900) || '(no text output)' }] });
  }
  if (results.length) u.userInputMessageContext = { toolResults: results };
  return u;
}

function historyOf(messages, row, names) {
  const history = [];
  for (const m of messages) {
    const blocks = parts(m?.content);
    if (m?.role !== 'assistant' && m?.role !== 'user') invalid('Kiro 消息角色无效。');
    const role = m.role === 'assistant' ? 'assistantResponseMessage' : 'userInputMessage';
    const data = m.role === 'assistant' ? assistantMessage(blocks, names) : userMessage(blocks, row);
    if (m.role === 'assistant' && !data.content && !data.toolUses?.length) continue;
    const previous = history.at(-1)?.[role];
    if (!previous) { history.push({ [role]: data }); continue; }
    previous.content = join(previous.content, data.content);
    if (data.toolUses) previous.toolUses = [...(previous.toolUses ?? []), ...data.toolUses];
    if (data.images) previous.images = [...(previous.images ?? []), ...data.images];
    if (data.userInputMessageContext) previous.userInputMessageContext = { toolResults: [...(previous.userInputMessageContext?.toolResults ?? []), ...data.userInputMessageContext.toolResults] };
  }
  if (!history[0]?.userInputMessage || !history.at(-1)?.userInputMessage) invalid('Kiro 会话须以用户消息开始，并以用户消息或工具结果结束。');
  let previousCalls = [];
  for (const entry of history) {
    if (entry.assistantResponseMessage) { previousCalls = entry.assistantResponseMessage.toolUses ?? []; continue; }
    const u = entry.userInputMessage;
    const prior = new Map((u.userInputMessageContext?.toolResults ?? []).map(r => [r.toolUseId, r]));
    const results = previousCalls.map(c => prior.get(c.toolUseId) ?? { toolUseId: c.toolUseId, status: 'error', content: [{ text: 'No result was recorded for this tool call.' }] });
    if (results.length) u.userInputMessageContext = { toolResults: results }; else delete u.userInputMessageContext;
    if (!u.content && !results.length && !u.images?.length) u.content = 'Continue.';
    previousCalls = [];
  }
  return history;
}

function toolSpecification(name, t) {
  const schema = object(t?.input_schema) ? t.input_schema : {};
  return { toolSpecification: { name, description: t?.description || name, inputSchema: { json: { ...schema, type: 'object', properties: object(schema.properties) ? schema.properties : {} } } } };
}

export function directWire(req, row, { effort, maxTokens } = {}) {
  if (!object(req) || req.model !== row.id || !Array.isArray(req.messages)) invalid('Kiro 收到无效的模型请求。');
  const tools = new Map((Array.isArray(req.tools) ? req.tools : []).filter(t => typeof t?.name === 'string' && t.name && (!t.type || t.type === 'custom')).map(t => [t.name, t]));
  const historyNames = req.messages.flatMap(m => parts(m?.content).filter(b => b?.type === 'tool_use' && typeof b.name === 'string').map(b => b.name));
  const names = nameMap([...tools.keys()], historyNames);
  const turns = historyOf(req.messages, row, names);
  turns[0].userInputMessage.content = join(textOf(req.system), turns[0].userInputMessage.content);
  const currentMessage = turns.pop();
  const specifications = [...new Set([...tools.keys(), ...historyNames])].map(n => toolSpecification(names.toWire(n), tools.get(n)));
  if (specifications.length) (currentMessage.userInputMessage.userInputMessageContext ??= {}).tools = specifications;
  const wire = { conversationState: { chatTriggerType: 'MANUAL', agentTaskType: 'vibe', conversationId: randomUUID(), currentMessage, ...(turns.length ? { history: turns } : {}) } };
  if (effort && effort !== 'off') {
    if (!row.effortField || !row.efforts.includes(effort)) invalid('Kiro 未发布这个模型的所选思考档位。');
    wire.additionalModelRequestFields = { ...(row.adaptive ? { thinking: { type: 'adaptive' } } : {}), [row.effortField]: { effort } };
  }
  if (maxTokens !== undefined) {
    const range = row.maxTokenRange;
    if (!range) throw new KiroProblem('该 Kiro 模型未公开可调的输出长度上限。', 'UNSUPPORTED_OPTION');
    if (!Number.isSafeInteger(maxTokens) || maxTokens < range.min || maxTokens > range.max) invalid(`Kiro 输出长度上限须在 ${range.min}–${range.max} 之间。`);
    (wire.additionalModelRequestFields ??= {}).max_tokens = maxTokens;
  }
  if (Buffer.byteLength(JSON.stringify(wire)) > 16_000_000) invalid('Kiro 请求超过 16 MB。');
  return { wire, names };
}
