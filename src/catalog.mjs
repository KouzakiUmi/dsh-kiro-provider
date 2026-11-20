import { KiroProblem } from './cli.mjs';
import { createResource } from './resource.mjs';

export const MODEL_ID = /^[a-z0-9][a-z0-9._:/-]{0,159}$/i;
export const effortIds = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const positive = n => Number.isSafeInteger(n) && n > 0;

// CLI catalog JSON variants; never invents missing facts.
export function parseCatalog(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { throw new KiroProblem('Kiro CLI 返回的模型目录不是 JSON。'); }
  const rows = Array.isArray(parsed) ? parsed : parsed?.models;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) throw new KiroProblem('Kiro CLI 没有返回有效模型目录。');
  const unique = new Set();
  const models = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = row.id ?? row.modelId ?? row.model_id;
    if (typeof id !== 'string' || !MODEL_ID.test(id) || unique.has(id)) continue;
    unique.add(id);
    const label = row.name ?? row.display_name ?? row.displayName;
    const name = typeof label === 'string' && label.trim() && label.length <= 120 && !/[\x00-\x1f\x7f]/.test(label) ? label.trim() : id;
    const capacity = row.context_window_tokens ?? row.contextWindowTokens;
    const declared = row.reasoning_efforts ?? row.reasoningEfforts;
    const efforts = Array.isArray(declared) ? [...new Set(declared.filter(x => typeof x === 'string' && effortIds.has(x)))] : [];
    const rate = typeof row.rate_multiplier === 'number' && Number.isFinite(row.rate_multiplier) && row.rate_multiplier > 0
      && String(row.rate_unit ?? '').toLowerCase() === 'credit' ? row.rate_multiplier : undefined;
    models.push(Object.freeze({ id, name, ...(positive(capacity) ? { contextWindow: capacity } : {}), efforts: Object.freeze(efforts), ...(rate ? { creditRate: rate } : {}) }));
  }
  if (!models.length) throw new KiroProblem('Kiro CLI 没有返回可选模型。');
  return Object.freeze(models);
}

// Persisted entries are re-validated on load and before write; unknown fields are dropped.
export function validateCatalog(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.rows) || value.rows.length > 500) return undefined;
  if (!(value.cli === null || (typeof value.cli === 'string' && value.cli.length <= 64))) return undefined;
  const rows = [];
  const seen = new Set();
  for (const row of value.rows) {
    if (!row || typeof row.id !== 'string' || !MODEL_ID.test(row.id) || seen.has(row.id)) continue;
    if (typeof row.name !== 'string' || !row.name.length || row.name.length > 120) continue;
    if (!Array.isArray(row.efforts) || row.efforts.some(e => !effortIds.has(e))) continue;
    const out = { id: row.id, name: row.name, efforts: [...new Set(row.efforts)] };
    if (positive(row.contextWindow)) out.contextWindow = row.contextWindow;
    if (positive(row.maxTokens)) out.maxTokens = row.maxTokens;
    if (Array.isArray(row.inputModalities) && row.inputModalities.length && row.inputModalities.every(m => m === 'text' || m === 'image')) out.inputModalities = [...new Set(row.inputModalities)];
    if (row.effortField === 'output_config' || row.effortField === 'reasoning') out.effortField = row.effortField;
    if (typeof row.adaptive === 'boolean') out.adaptive = row.adaptive;
    if (row.maxTokenRange && positive(row.maxTokenRange.min) && positive(row.maxTokenRange.max) && row.maxTokenRange.min <= row.maxTokenRange.max) {
      out.maxTokenRange = { min: row.maxTokenRange.min, max: row.maxTokenRange.max };
    }
    if (typeof row.creditRate === 'number' && Number.isFinite(row.creditRate) && row.creditRate > 0) out.creditRate = row.creditRate;
    seen.add(row.id);
    rows.push(out);
  }
  if (!rows.length) return undefined;
  return { rows, cli: value.cli };
}

export function createCatalog({ store, keyOf, fetch, onUpdate }) {
  return createResource({ kind: 'catalog', store, keyOf, fetch, ttl: 300_000, maxBackoff: 8, onUpdate });
}