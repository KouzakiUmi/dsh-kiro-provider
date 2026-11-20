import assert from 'node:assert/strict';
import test from 'node:test';
import { parseUsage, validateUsage } from '../src/usage.mjs';

const NOW = 1700000000000;
const RESET = 1767225600;
const row = {
  displayName: 'Credit', displayNamePlural: 'Credits',
  currentUsageWithPrecision: 250.5, usageLimitWithPrecision: 1000, nextDateReset: RESET,
  bonuses: [{ status: 'ACTIVE', displayName: 'Upgrade bonus', currentUsage: 5, usageLimit: 50, expiresAt: RESET }],
  freeTrialInfo: { freeTrialStatus: 'ACTIVE', currentUsageWithPrecision: 1, usageLimitWithPrecision: 10, freeTrialExpiry: RESET },
};
const response = { subscriptionInfo: { subscriptionTitle: 'KIRO PRO' }, userInfo: { email: 'user@example.com' }, nextDateReset: RESET, usageBreakdownList: [row] };

test('parseUsage projects plan, trial and bonus windows without inventing numbers', () => {
  const usage = parseUsage(response, NOW);
  assert.equal(usage.plan, 'Kiro Pro');
  assert.equal(usage.user, 'user@example.com');
  assert.deepEqual(usage.windows.map(w => w.kind), ['trial', 'bonus', 'plan']);
  const plan = usage.windows.find(w => w.kind === 'plan');
  assert.equal(plan.used, 250.5);
  assert.equal(plan.limit, 1000);
  assert.equal(plan.percent, 25.05);
  assert.equal(plan.resetsAt, new Date(RESET * 1000).toISOString());
  assert.equal(usage.windows.find(w => w.kind === 'bonus').name, 'Upgrade bonus');
});

test('overage splits the display-only plan window from the stopping cap', () => {
  const usage = parseUsage({ ...response, overageConfiguration: { overageStatus: 'ENABLED' },
    usageBreakdownList: [{ ...row, overageCapWithPrecision: 500, currentOveragesWithPrecision: 120 }] }, NOW);
  const plan = usage.windows.find(w => w.kind === 'plan');
  const over = usage.windows.find(w => w.kind === 'overage');
  assert.equal(plan.aside, true);
  assert.equal(plan.used, 250.5);
  assert.equal(over.used, 120);
  assert.equal(over.limit, 500);
  assert.equal(over.aside, undefined);
});

test('expired bonuses and inactive trials drop; missing limits produce no window', () => {
  const usage = parseUsage({ usageBreakdownList: [{
    currentUsageWithPrecision: 5, usageLimitWithPrecision: 0,
    bonuses: [{ status: 'ACTIVE', currentUsage: 1, usageLimit: 10, expiresAt: 1600000000 }],
    freeTrialInfo: { freeTrialStatus: 'EXPIRED', currentUsageWithPrecision: 1, usageLimitWithPrecision: 10 },
  }] }, NOW);
  assert.deepEqual(usage.windows, []);
  assert.equal(usage.plan, undefined);
  assert.throws(() => parseUsage(null), /额度信息/);
  assert.deepEqual(parseUsage({}).windows, []);
});

test('validateUsage round-trips projections and drops malformed windows', () => {
  const usage = parseUsage(response, NOW);
  assert.deepEqual(validateUsage(usage), usage);
  assert.equal(validateUsage(undefined), undefined);
  assert.equal(validateUsage({ windows: 'x' }), undefined);
  const dropped = validateUsage({ windows: [{ kind: 'plan', name: 'x', used: -1, limit: 10, percent: 0 }, { kind: 'other', name: 'y', used: 1, limit: 10, percent: 1 }] });
  assert.deepEqual(dropped.windows, []);
});