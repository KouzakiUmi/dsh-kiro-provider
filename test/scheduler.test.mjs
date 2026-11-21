import assert from 'node:assert/strict';
import test from 'node:test';
import { createUsageScheduler, PAUSE_AFTER } from '../src/usage-scheduler.mjs';

function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout: id => { pending.delete(id); },
    fire: async () => {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, { fn }] of entries) await fn();
    },
    count: () => pending.size,
  };
}

test('scheduler pauses after consecutive failures and a manual success resumes it', async () => {
  const timers = fakeTimers();
  let fail = true;
  let calls = 0;
  const scheduler = createUsageScheduler({
    refresh: async () => { calls++; if (fail) throw new Error('upstream down'); return { windows: [] }; },
    intervalSeconds: () => 60,
    enabled: () => true,
    timers,
  });
  scheduler.schedule();
  assert.equal(scheduler.state().nextRefreshAt !== null, true);
  for (let i = 0; i < PAUSE_AFTER; i++) await timers.fire();
  assert.equal(calls, PAUSE_AFTER);
  assert.equal(scheduler.state().autoRefreshPaused, true);
  assert.equal(scheduler.state().nextRefreshAt, null);
  assert.equal(timers.count(), 0);
  await timers.fire();
  assert.equal(calls, PAUSE_AFTER);
  fail = false;
  await scheduler.manual(scheduler && Promise.resolve({ windows: [] }));
  assert.equal(scheduler.state().autoRefreshPaused, false);
  assert.equal(scheduler.state().refreshFailures, 0);
  assert.equal(timers.count(), 1);
  scheduler.dispose();
  assert.equal(timers.count(), 0);
});

test('scheduler respects the enabled gate and reset clears failures', async () => {
  const timers = fakeTimers();
  let on = false;
  let calls = 0;
  const scheduler = createUsageScheduler({ refresh: async () => { calls++; }, intervalSeconds: () => 60, enabled: () => on, timers });
  scheduler.schedule();
  assert.equal(timers.count(), 0);
  on = true;
  scheduler.reset();
  assert.equal(timers.count(), 1);
  await timers.fire();
  assert.equal(calls, 1);
  scheduler.dispose();
});

test('manual failure counts toward the pause threshold', async () => {
  const timers = fakeTimers();
  const scheduler = createUsageScheduler({ refresh: async () => {}, intervalSeconds: () => 60, enabled: () => true, timers });
  for (let i = 0; i < PAUSE_AFTER; i++) {
    await assert.rejects(scheduler.manual(Promise.reject(new Error('no'))));
  }
  assert.equal(scheduler.state().autoRefreshPaused, true);
  scheduler.dispose();
});