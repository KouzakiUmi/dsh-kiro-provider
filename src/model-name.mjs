// 显示投影（host/client 共享纯函数）：请求 ID 原样保留，显示名清理 ID 格式；
// 扣费倍率只由徽标表达，不拼进名称；旧版判定 = 目录内同家族更高版本 + 跨世代外部后继在目录内实际存在。
// 外部后继表来源与核验日期见 docs/model-curation.md；变体型号（sol/terra/luna）不互相压制。

const BRANDS = {
  claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini', glm: 'GLM', gpt: 'GPT', grok: 'Grok',
  kimi: 'Kimi', llama: 'Llama', mimo: 'MiMo', minimax: 'MiniMax', qwen: 'Qwen', nova: 'Nova', auto: 'Auto',
};
const GLUED = /^(qwen|glm|gpt|llama|grok|gemini|kimi)(?=\d)/i;

export function readableModelName(id, name) {
  const source = (typeof name === 'string' && name.trim()) || (typeof id === 'string' && id.trim()) || '';
  if (!source) return '未命名模型';
  return source.split(/\s+/).map(part => {
    let slug = part;
    // 提供商限定的 ID 前缀只影响路由，不进显示名。
    if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(slug)) slug = slug.slice(slug.indexOf('/') + 1);
    if (/^[a-z0-9.]+(?:[-_][a-z0-9.]+)+$/i.test(slug) || GLUED.test(slug)) {
      return slug.replace(/(?<=\d)[-_](?=\d{1,2}(?:[-_]|$))/g, '.')
        .replace(GLUED, '$1 ')
        .split(/[-_ ]+/)
        .map(word => BRANDS[word.toLowerCase()] ?? (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
        .join(' ');
    }
    return BRANDS[slug.toLowerCase()] ?? slug;
  }).join(' ');
}

// 倍率徽标：x{倍率}（两位小数，与 Unified Router 同格式）+ 消耗色调（≤0.5 低耗 / ≤1.5 常规 / >1.5 高耗）。
export function modelRateBadge(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return { label: `x${rate.toFixed(2)}`, tone: rate <= 0.5 ? 'success' : rate <= 1.5 ? 'info' : 'warning', multiplier: rate };
}

// DSH 核心原生 LlmModelInfo.badge：只经 listModels 广告给会话选择器（收起态名前、下拉行名后），
// resolveModel 与请求/会话事件不携带。未知倍率不挂徽标，不谎报免费。
export function selectorRateBadge(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return undefined;
  const text = `x${rate.toFixed(2)}`;
  return { text: { en: text, zh: text }, tone: 'neutral' };
}

const VERSION_SEGMENT = /^[a-z]?(\d+(?:\.\d+)*)$/i;

// 已核实的外部跨世代后继关系（2026-11-21 直接访问 Artificial Analysis 排行榜内嵌数据核对 deprecated 标志，
// 辅以厂商平台文档；来源与逐条证据见 docs/model-curation.md）。
// 跨世代：后继与现役型号家族不同（GPT-5.6→6.x、DeepSeek 3.2→V4.x 等），目录内同家族版本规则覆盖不到。
// 第二项是后继的 Kiro ID 前缀：仅当目录内实际存在匹配该前缀的型号时压制才生效——
// 厂商侧弃用不等于 Kiro 侧弃用，目录缩水时幸存者（可能是该账号唯一可用模型）必须保持默认开启。
const SUPERSEDED = new Map([
  ['gpt-5.6-sol', { successor: 'GPT-6.2 Sol', prefixes: ['gpt-6'] }],
  ['gpt-5.6-terra', { successor: 'GPT-6.1 Terra', prefixes: ['gpt-6'] }],
  ['gpt-5.6-luna', { successor: 'GPT-6 Luna', prefixes: ['gpt-6'] }],
  ['deepseek-3.2', { successor: 'DeepSeek V4.1 Flash 1017', prefixes: ['deepseek-v4', 'deepseek-4'] }],
  ['glm-5', { successor: 'GLM-5.3', prefixes: ['glm-5.3', 'glm-6'] }],
  ['kimi-k3', { successor: 'Kimi K3.1 Pro', prefixes: ['kimi-k3.1', 'kimi-k4'] }],
  ['minimax-m2.5', { successor: 'MiniMax M3.1 Flash', prefixes: ['minimax-m3'] }],
  ['minimax-m2.1', { successor: 'MiniMax M3.1 Flash', prefixes: ['minimax-m3'] }],
  ['qwen3-coder-next', { successor: 'Qwen4 Max', prefixes: ['qwen4'] }],
]);

export const supersededBy = id => SUPERSEDED.get(String(id).toLowerCase())?.successor;

// 外部后继是否在目录内实际存在（按已核实的 Kiro ID 前缀，大小写不敏感）。
function successorPresent(rows, entry) {
  return rows.some(row => typeof row?.id === 'string' && entry.prefixes.some(prefix => row.id.toLowerCase().startsWith(prefix)));
}

// 旧版标记的展示后继：仅当外部压制实际生效（后继在目录内）时返回显示名，
// 同家族压制或后继缺席时返回 null，由调用方回退到通用文案。
export function legacySuccessor(rows, id) {
  const entry = SUPERSEDED.get(String(id).toLowerCase());
  return entry && successorPresent(Array.isArray(rows) ? rows : [], entry) ? entry.successor : null;
}

function parseVersion(id) {
  // 与显示名同规则先把版本连字符转点，避免 4-5 与 4.5 误分家族。
  const parts = String(id).replace(/(?<=\d)[-_](?=\d{1,2}(?:[-_]|$))/g, '.').split('-');
  if (parts.length < 2) return null;
  const match = VERSION_SEGMENT.exec(parts[parts.length - 1]);
  if (!match) return null;
  return { family: parts.slice(0, -1).join('-').toLowerCase(), version: match[1].split('.').map(Number) };
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

// 旧版 = 目录内同家族存在更高版本，或跨世代外部后继在目录内实际存在。
// 默认关闭建议由此产生；用户显式开关优先。后继缺席时幸存者不按旧版压制。
export function legacyModelIds(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const parsed = [];
  const legacy = new Set();
  for (const row of list) {
    if (!row || typeof row.id !== 'string') continue;
    const external = SUPERSEDED.get(row.id.toLowerCase());
    if (external && successorPresent(list, external)) legacy.add(row.id);
    const info = parseVersion(row.id);
    if (info) parsed.push({ id: row.id, ...info });
  }
  for (const entry of parsed) {
    if (parsed.some(other => other.family === entry.family && compareVersions(other.version, entry.version) > 0)) legacy.add(entry.id);
  }
  return [...legacy];
}