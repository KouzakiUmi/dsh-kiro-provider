import { KiroProblem } from './cli.mjs';
import { createResource } from './resource.mjs';

const num = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const active = x => String(x ?? '').toUpperCase() === 'ACTIVE';
const iso = seconds => finite(seconds) && seconds > 0 ? new Date(Math.trunc(seconds) * 1000).toISOString() : undefined;
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;

// GetUsageLimits / Get-Usage-Limits projection: plan credits, optional overage cap, bonuses and free trial.
// Numbers come only from Kiro's response; missing values stay missing, never estimated.
export function parseUsage(response, now = Date.now()) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new KiroProblem('Kiro 没有返回额度信息。', 'INVALID_RESPONSE');
  const list = Array.isArray(response.usageBreakdownList) ? response.usageBreakdownList.slice(0, 24) : [];
  const config = response.overageConfiguration;
  const overage = String(config?.overageStatus ?? '').toUpperCase() === 'ENABLED' || config?.overageEnabled === true;
  const windows = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const trial = entry.freeTrialInfo;
    if (trial && active(trial.freeTrialStatus) && num(trial.usageLimitWithPrecision) > 0) {
      const used = num(trial.currentUsageWithPrecision), limit = num(trial.usageLimitWithPrecision);
      const expiry = iso(trial.freeTrialExpiry);
      windows.push({ kind: 'trial', name: '免费试用', used, limit, percent: 100 * used / limit, ...(expiry ? { resetsAt: expiry } : {}) });
    }
    for (const bonus of Array.isArray(entry.bonuses) ? entry.bonuses.slice(0, 24) : []) {
      if (!bonus || !active(bonus.status) || num(bonus.usageLimit) <= 0) continue;
      const expires = finite(bonus.expiresAt) && bonus.expiresAt > 0 ? Math.trunc(bonus.expiresAt) * 1000 : 0;
      if (expires && expires <= now) continue;
      const used = num(bonus.currentUsage), limit = num(bonus.usageLimit);
      windows.push({ kind: 'bonus', name: label(bonus.displayName, '赠送额度'), used, limit, percent: 100 * used / limit,
        ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}) });
    }
    const used = num(entry.currentUsageWithPrecision), limit = num(entry.usageLimitWithPrecision);
    const cap = overage ? num(entry.overageCapWithPrecision) || num(entry.overageCap) : 0;
    const reset = iso(num(entry.nextDateReset) || num(response.nextDateReset));
    const name = label(entry.displayNamePlural, label(entry.displayName, '额度'));
    if (cap > 0) {
      // With overage enabled the plan window no longer stops the account; the overage cap does.
      const said = finite(entry.currentOveragesWithPrecision) ? entry.currentOveragesWithPrecision : entry.currentOverages;
      const over = finite(said) && said >= 0 ? said : Math.max(0, used - limit);
      if (limit > 0) windows.push({ kind: 'plan', name, used: Math.min(used, limit), limit, percent: 100 * Math.min(used, limit) / limit, ...(reset ? { resetsAt: reset } : {}), aside: true });
      windows.push({ kind: 'overage', name: '超额用量', used: over, limit: cap, percent: 100 * over / cap, ...(reset ? { resetsAt: reset } : {}) });
    } else if (limit > 0) {
      windows.push({ kind: 'plan', name, used, limit, percent: 100 * used / limit, ...(reset ? { resetsAt: reset } : {}) });
    }
  }
  const title = response.subscriptionInfo?.subscriptionTitle;
  const plan = typeof title === 'string' && title.trim()
    ? title.trim().toLowerCase().split(/\s+/).map(word => word === 'kiro' ? 'Kiro' : word[0].toUpperCase() + word.slice(1)).join(' ').slice(0, 80)
    : undefined;
  const email = response.userInfo?.email;
  return { ...(plan ? { plan } : {}), ...(typeof email === 'string' && email.length <= 320 && email.includes('@') ? { user: email } : {}), windows };
}

export function validateUsage(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.windows) || value.windows.length > 48) return undefined;
  if (value.plan !== undefined && (typeof value.plan !== 'string' || value.plan.length > 80)) return undefined;
  if (value.user !== undefined && (typeof value.user !== 'string' || value.user.length > 320)) return undefined;
  const windows = [];
  for (const window of value.windows) {
    if (!window || !['plan', 'overage', 'bonus', 'trial'].includes(window.kind)) continue;
    if (typeof window.name !== 'string' || !window.name.length || window.name.length > 80) continue;
    if (!finite(window.used) || window.used < 0 || !finite(window.limit) || window.limit <= 0 || !finite(window.percent) || window.percent < 0) continue;
    const out = { kind: window.kind, name: window.name, used: window.used, limit: window.limit, percent: window.percent };
    for (const key of ['resetsAt', 'expiresAt']) if (typeof window[key] === 'string' && window[key].length <= 40) out[key] = window[key];
    if (window.aside === true) out.aside = true;
    windows.push(out);
  }
  return { ...(value.plan ? { plan: value.plan } : {}), ...(value.user ? { user: value.user } : {}), windows };
}

export function createUsage({ store, keyOf, fetch }) {
  return createResource({ kind: 'usage', store, keyOf, fetch, ttl: 60_000, maxBackoff: 8 });
}