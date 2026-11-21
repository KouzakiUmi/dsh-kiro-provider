// 显示投影（host/client 共享纯函数）：请求 ID 原样保留，显示名清理 ID 格式；
// 扣费倍率只由徽标表达，不拼进名称；旧版判定 = 已核实的外部后继关系 + 目录内同家族更高版本。
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

// 倍率徽标：x{倍率} + 消耗色调（≤0.5 低耗 / ≤1.5 常规 / >1.5 高耗）。
export function modelRateBadge(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return { label: `x${Number(rate.toFixed(2))}`, tone: rate <= 0.5 ? 'success' : rate <= 1.5 ? 'info' : 'warning', multiplier: rate };
}

const VERSION_SEGMENT = /^[a-z]?(\d+(?:\.\d+)*)$/i;

// 已核实的外部后继关系（2026-11-21 直接访问 Artificial Analysis 排行榜内嵌数据核对 deprecated 标志，
// 辅以厂商平台文档；来源与逐条证据见 docs/model-curation.md）。
// 即使后继不在 Kiro 目录内，这些型号也按旧版默认关闭；用户可显式开启。
const SUPERSEDED = new Map([
  ['gpt-5.6-sol', 'GPT-6.2 Sol'],
  ['gpt-5.6-terra', 'GPT-6.1 Terra'],
  ['gpt-5.6-luna', 'GPT-6 Luna'],
  ['deepseek-3.2', 'DeepSeek V4.1 Flash 1017'],
  ['glm-5', 'GLM-5.3'],
  ['kimi-k3', 'Kimi K3.1 Pro'],
  ['minimax-m2.5', 'MiniMax M3.1 Flash'],
  ['minimax-m2.1', 'MiniMax M3.1 Flash'],
  ['qwen3-coder-next', 'Qwen4 Max'],
]);

export const supersededBy = id => SUPERSEDED.get(String(id).toLowerCase());

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

// 旧版 = 已核实外部后继 + 同家族存在更高版本。默认关闭建议由此产生；用户显式开关优先。
export function legacyModelIds(rows) {
  const parsed = [];
  const legacy = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.id !== 'string') continue;
    if (SUPERSEDED.has(row.id.toLowerCase())) legacy.add(row.id);
    const info = parseVersion(row.id);
    if (info) parsed.push({ id: row.id, ...info });
  }
  for (const entry of parsed) {
    if (parsed.some(other => other.family === entry.family && compareVersions(other.version, entry.version) > 0)) legacy.add(entry.id);
  }
  return [...legacy];
}