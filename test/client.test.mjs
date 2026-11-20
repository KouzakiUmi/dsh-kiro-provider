import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Load the built client bundle exactly as the browser module loader would.
const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
let factory;
const context = vm.createContext({
  window: { __ModuleLoader__: { load: entry => { factory = entry.factory; } } },
  document: undefined,
});
vm.runInContext(bundle, context);
const reactStub = { createElement: (type, props, ...children) => ({ type, props, children }) };
const clientModule = factory(name => {
  assert.equal(name, 'react');
  return reactStub;
});
const { createKiroStore, normalizeLogin, registerContextPill } = clientModule;

const view = overrides => ({
  mode: 'oauth', keyRef: 'KIRO_API_KEY', region: 'us-east-1', oauthConnected: false,
  models: [], catalogAt: null, catalogSource: 'none', usage: { supported: true, at: null }, modelDefaults: [],
  ...overrides,
});

test('client bundle exposes the plugin contract and normalizes login state', () => {
  assert.equal(clientModule.name, 'dsh-kiro-provider');
  assert.deepEqual(clientModule.inject, ['slots', 'remote']);
  assert.equal(typeof clientModule.apply, 'function');
  assert.deepEqual(normalizeLogin({ phase: 'waiting', url: 'https://app.kiro.dev/signin', token: 'secret' }),
    { phase: 'waiting', url: 'https://app.kiro.dev/signin', message: '' });
  assert.equal(normalizeLogin({ phase: 'waiting', url: 'http://evil.example' }).url, null);
  assert.deepEqual(normalizeLogin(null), { phase: 'idle', url: null, message: '' });
});

test('store loads the view and login state; subscribers see snapshots', async () => {
  const calls = [];
  const store = createKiroStore(async request => {
    calls.push(request.op);
    if (request.op === 'status') return view();
    return { phase: 'idle' };
  });
  let notified = 0;
  store.subscribe(() => { notified++; });
  await store.load();
  assert.deepEqual(calls, ['status', 'loginStatus']);
  assert.equal(store.getSnapshot().view.mode, 'oauth');
  assert.ok(notified > 0);
  store.dispose();
});

test('same-scope operations are single-flight; stale responses never overwrite newer ones', async () => {
  let releaseSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const store = createKiroStore(async request => {
    if (request.op === 'status') { await slow; return view({ catalogSource: 'memory', catalogAt: 1 }); }
    if (request.op === 'refresh') return view({ catalogSource: 'memory', catalogAt: 2 });
    return { phase: 'idle' };
  });
  const first = store.retry();
  const second = store.refresh();
  assert.equal(await second, true);
  assert.equal(store.getSnapshot().view.catalogAt, 2);
  releaseSlow();
  assert.equal(await first, false);
  assert.equal(store.getSnapshot().view.catalogAt, 2);
  assert.deepEqual(store.getSnapshot().busy, {});
  // The leaked-lock regression: a superseded global op must not block later global ops.
  assert.equal(await store.retry(), true);
  store.dispose();
});

test('login validation fails locally; polling backs off without cancelling the task', async () => {
  const calls = [];
  let failPoll = false;
  const store = createKiroStore(async request => {
    calls.push(request.op);
    if (request.op === 'loginStart') return { phase: 'waiting', url: 'https://oidc.us-east-1.amazonaws.com/authorize' };
    if (request.op === 'loginStatus') {
      if (failPoll) throw new Error('transport down');
      return { phase: 'waiting' };
    }
    return view();
  });
  await store.startLogin('organization', { url: 'https://evil.example/start', region: 'us-east-1' });
  assert.equal(store.getSnapshot().login.phase, 'failed');
  assert.deepEqual(calls, []);
  await store.startLogin('builder');
  assert.equal(store.getSnapshot().login.phase, 'waiting');
  assert.equal(store.getSnapshot().login.url, 'https://oidc.us-east-1.amazonaws.com/authorize');
  failPoll = true;
  const failed = await store.pollLogin();
  assert.equal(failed.ok, false);
  assert.match(store.getSnapshot().login.message, /自动重试/);
  assert.equal(store.getSnapshot().login.phase, 'waiting');
  failPoll = false;
  const recovered = await store.pollLogin();
  assert.deepEqual(recovered, { ok: true, phase: 'waiting' });
  store.dispose();
});

test('pill injects the ModelDirectory instance, whose select writes the session effort', () => {
  // select 是 ModelDirectory 实例方法，快照 store 只有 subscribe/getSnapshot；
  // 注入本体而非 .store，否则档位切换在运行时 TypeError。
  const fakeDirectory = {
    store: { subscribe: () => () => {}, getSnapshot: () => ({ current: null, status: 'idle', pending: null }) },
    select: async () => ({ ok: true, value: undefined }),
  };
  let registered;
  const scope = {
    modelDirectories: { directoryFor: () => fakeDirectory },
    effect: fn => fn(),
    slots: {
      inject: (owner, register) => register(),
      register: (meta, component) => { registered = { meta, component }; },
    },
  };
  const ctx = { inject: (names, fn) => { if (names.includes('modelDirectories')) fn(scope); } };
  registerContextPill(ctx, async () => ({}));
  assert.equal(registered.meta.name, 'conversation.input.right');
  const props = registered.meta.inject('session-fixture');
  assert.equal(props.directory, fakeDirectory);
  assert.equal(typeof props.directory.select, 'function');
  assert.equal(typeof props.directory.store.subscribe, 'function');
  assert.equal(typeof props.directory.store.getSnapshot, 'function');
});

test('silent reads skip while writes are in flight and never touch notices', async () => {
  let releaseWrite;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  let catalogAt = 5;
  const store = createKiroStore(async request => {
    if (request.op === 'refresh') { await gate; catalogAt = 9; return view({ catalogAt }); }
    return view({ catalogAt });
  });
  await store.load();
  const write = store.refresh();
  store.setNotice('保留的通知');
  await store.pollRead();
  assert.equal(store.getSnapshot().view.catalogAt, 5);
  assert.equal(store.getSnapshot().notice, '保留的通知');
  releaseWrite();
  await write;
  await store.pollRead();
  assert.equal(store.getSnapshot().view.catalogAt, 9);
  store.dispose();
});