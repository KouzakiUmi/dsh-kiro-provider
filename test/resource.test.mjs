import assert from 'node:assert/strict';
import test from 'node:test';
import { createResource } from '../src/resource.mjs';
import { KiroProblem } from '../src/cli.mjs';

const stubStore = () => {
  const map = new Map();
  return {
    get: (kind, key) => map.get(`${kind}:${key}`),
    set: async (kind, key, value, at) => { map.set(`${kind}:${key}`, { value, at }); },
    remove: async (kind, key) => { map.delete(`${kind}:${key}`); },
    load: async () => {},
  };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('read serves the persisted snapshot without fetching; refresh deduplicates', async () => {
  let calls = 0;
  const store = stubStore();
  await store.set('catalog', 'k', { rows: ['old'] }, 1000);
  const r = createResource({ kind: 'catalog', store, keyOf: () => 'k', fetch: async () => { calls++; return { rows: ['new'] }; }, ttl: 300_000 });
  const view = r.read({});
  assert.equal(view.source, 'disk');
  assert.deepEqual(view.value.rows, ['old']);
  assert.equal(view.stale, true);
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([r.refresh({}), r.refresh({})]);
  assert.equal(calls, 1);
  assert.deepEqual(a.rows, ['new']);
  assert.deepEqual(b.rows, ['new']);
  assert.equal(r.read({}).source, 'memory');
  assert.equal(r.read({}).stale, false);
});

test('failures back off, keep the last error visible and never erase the snapshot', async () => {
  let calls = 0;
  let fail = true;
  const store = stubStore();
  await store.set('catalog', 'k', { rows: ['good'] }, Date.now());
  const r = createResource({ kind: 'catalog', store, keyOf: () => 'k', ttl: 1000,
    fetch: async () => { calls++; if (fail) throw new KiroProblem('Kiro 拒绝了凭据。', 'AUTH'); return { rows: ['new'] }; } });
  await assert.rejects(r.refresh({}, { force: true }), /拒绝了凭据/);
  const view = r.read({});
  assert.deepEqual(view.value.rows, ['good']);
  assert.equal(view.error, 'Kiro 拒绝了凭据。');
  await assert.rejects(r.refresh({}), /拒绝了凭据/);
  assert.equal(calls, 1);
  fail = false;
  await r.refresh({}, { force: true });
  assert.equal(calls, 2);
  assert.equal(r.read({}).error, undefined);
});

test('reset invalidates in-flight cache writes; persistence failure is non-fatal', async () => {
  let resolveFetch;
  const r = createResource({ kind: 'catalog', store: stubStore(), keyOf: () => 'k', ttl: 300_000,
    fetch: () => new Promise(resolve => { resolveFetch = resolve; }) });
  const pending = r.refresh({});
  r.reset();
  resolveFetch({ rows: ['late'] });
  await pending;
  assert.equal(r.read({}).source, 'none');

  const broken = createResource({ kind: 'catalog', store: { ...stubStore(), set: async () => { throw new Error('disk full'); } },
    keyOf: () => 'k', ttl: 300_000, fetch: async () => ({ rows: ['ok'] }) });
  await broken.refresh({});
  assert.deepEqual(broken.read({}).value.rows, ['ok']);
});

test('revalidate fetches in the background only when stale', async () => {
  let calls = 0;
  const r = createResource({ kind: 'catalog', store: stubStore(), keyOf: () => 'k', ttl: 300_000,
    fetch: async () => { calls++; return { rows: ['x'] }; } });
  r.revalidate({});
  await settle();
  assert.equal(calls, 1);
  r.revalidate({});
  await settle();
  assert.equal(calls, 1);
});