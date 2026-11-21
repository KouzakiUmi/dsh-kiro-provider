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
  advanced: { quotaRefreshSeconds: 60, streamIdleTimeoutMs: 180000, maxRequestImageBytes: 10000000, autoOpenBrowser: true },
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

test('kit and panels render without undefined identifiers (expanding stub)', () => {
  // 展开函数组件并提供最小 hooks 桩：组件体内的未定义变量（如 props 简写笔误）会在此暴露。
  const expandStub = {
    createElement: (type, props, ...children) => {
      const merged = { ...(props ?? {}), children: children.length === 1 ? children[0] : children };
      if (typeof type === 'function') return type(merged);
      return { type, props: merged };
    },
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: init => ({ current: init }),
    useId: () => 'kiro-test-id',
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useSyncExternalStore: (_subscribe, get) => get(),
    Fragment: 'Fragment',
  };
  const rendered = factory(() => expandStub);
  const { kit, createKiroStore: createStore2 } = rendered;

  let clicked = null;
  const switchEl = kit.Switch({ checked: true, label: '启用模型', onChange: () => { clicked = 'yes'; } });
  assert.equal(switchEl.props.role, 'switch');
  assert.equal(switchEl.props['aria-checked'], true);
  assert.equal(typeof switchEl.props.onClick, 'function');
  switchEl.props.onClick();
  assert.equal(clicked, 'yes');
  kit.Section({ title: 'T', summary: 's', actions: kit.button('A', () => {}, false), children: null });
  kit.Row({ name: 'N', tags: kit.Chip({ children: 'x' }), meta: 'm', switchControl: switchEl, moreLabel: '更多', expanded: true, onToggle: () => {}, detail: kit.Notice({ kind: 'warn', children: 'w' }) });
  kit.EmptyState({ failed: true, onRetry: () => {}, emptyText: 'e' });
  kit.Meter({ percent: 120, label: 'l' });
  const deadline = kit.RelativeDeadline({ at: Date.now() + 3600_000, prefix: '重置：' });
  assert.equal(deadline.type, 'time');
  assert.ok(deadline.props.dateTime);
  const number = kit.NumberField({ id: 'n', label: 'L', value: '999999999', min: 5, max: 3600, onChange: () => {} });
  assert.ok(number.props.children.some(child => child && child.props && child.props.role === 'alert'));

  const fullView = view({
    oauthConnected: true,
    models: [{ id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', enabled: true, efforts: ['low', 'max'], contextWindow: 200000, creditRate: 1.3, maxTokenRange: { min: 1, max: 64000 } }],
    catalogAt: 1700000000000, catalogSource: 'memory',
    usage: { supported: true, plan: 'Kiro Pro', windows: [{ kind: 'plan', name: 'Credits', used: 10, limit: 100, percent: 10, resetsAt: '2026-01-01T00:00:00.000Z' }], at: 1700000000000, stale: false, autoRefreshPaused: false, nextRefreshAt: 1700000060000, refreshFailures: 0 },
    modelDefaults: [{ id: 'claude-sonnet-5.5', effort: 'max', maxTokens: 4096 }],
  });
  const store = createStore2(async () => fullView);
  const state = { view: fullView, login: { phase: 'idle', url: null, message: '', method: null }, busy: {}, notice: '', alert: '' };
  rendered.ModelsPanel({ state, store });
  rendered.UsagePanel({ state, store });
  rendered.UsagePanel({ state: { ...state, view: { ...fullView, usage: { supported: false } } }, store });
  rendered.AdvancedPanel({ state, store, formId: 'f' });
  rendered.LoginPanel({ state, store, formId: 'f' });
  rendered.ConnectionPanel({ state, store, formId: 'f' });
  rendered.Settings({ client: { invoke: async () => fullView } });
  store.dispose();
});

test('quota status chain follows error > login > stale > empty > worst window', () => {
  const { quotaStatusView } = clientModule;
  const windows = percent => [{ kind: 'plan', name: 'Credits', used: percent, limit: 100, percent }];
  assert.equal(quotaStatusView({ supported: false }).kind, 'unsupported');
  assert.equal(quotaStatusView({ supported: true, error: 'x', windows: windows(10) }).kind, 'error');
  assert.equal(quotaStatusView({ supported: true, windows: windows(10) }, { oauthMode: true, connected: false }).kind, 'need-login');
  assert.equal(quotaStatusView({ supported: true, stale: true, at: 1700000000000, windows: windows(10) }).kind, 'stale');
  assert.equal(quotaStatusView({ supported: true, stale: true, at: null, windows: [] }).kind, 'empty');
  assert.equal(quotaStatusView({ supported: true, windows: [] }).kind, 'empty');
  assert.equal(quotaStatusView({ supported: true, windows: windows(100) }).kind, 'critical');
  assert.equal(quotaStatusView({ supported: true, windows: windows(95) }).kind, 'danger');
  assert.equal(quotaStatusView({ supported: true, windows: windows(75) }).kind, 'warn');
  assert.equal(quotaStatusView({ supported: true, windows: windows(10) }).kind, 'good');
  // aside 窗口（overage 开启时的套餐展示窗）不参与严重度，停止线是 overage。
  assert.equal(quotaStatusView({ supported: true, windows: [{ kind: 'plan', name: 'p', used: 100, limit: 100, percent: 100, aside: true }, { kind: 'overage', name: 'o', used: 50, limit: 100, percent: 50 }] }).kind, 'good');
});

test('model sorting, search and tab keyboard navigation are pure and bounded', () => {
  const { sortModelsByEnabled, filterModels, tabAfter } = clientModule;
  const models = [{ id: 'a', name: 'Alpha', enabled: false }, { id: 'b', name: 'Beta', enabled: true }, { id: 'c', name: 'gamma', enabled: false }];
  assert.deepEqual(sortModelsByEnabled(models).map(m => m.id), ['b', 'a', 'c']);
  assert.deepEqual(filterModels(models, 'BET').map(m => m.id), ['b']);
  assert.deepEqual(filterModels(models, 'gam').map(m => m.id), ['c']);
  assert.deepEqual(filterModels(models, '  ').map(m => m.id), ['a', 'b', 'c']);
  assert.deepEqual(filterModels(models, 'zzz'), []);
  assert.equal(tabAfter('ArrowRight', 'overview'), 'models');
  assert.equal(tabAfter('ArrowLeft', 'overview'), 'advanced');
  assert.equal(tabAfter('Home', 'advanced'), 'overview');
  assert.equal(tabAfter('End', 'overview'), 'advanced');
  assert.equal(tabAfter('Enter', 'overview'), null);
});

test('cross-scope concurrent writes resync to the host view after settlement', async () => {
  // warn 回归：a 的失败响应被 b 的序号票丢弃时，不得把 a 的乐观值留在视图里。
  const hostModels = new Map([['a', true], ['b', true]]);
  const gates = new Map();
  const snapshotView = () => view({ models: [...hostModels].map(([id, enabled]) => ({ id, name: id, enabled })) });
  const store = createKiroStore(async request => {
    if (request.op === 'model') {
      await new Promise(resolve => gates.set(request.id, resolve));
      if (request.id === 'a') throw new Error('a rejected');
      hostModels.set(request.id, request.enabled);
      return snapshotView();
    }
    return snapshotView();
  });
  await store.load();
  const writeA = store.toggleModel('a', false);
  const writeB = store.toggleModel('b', false);
  assert.equal(store.getSnapshot().view.models.find(m => m.id === 'a').enabled, false);
  gates.get('a')();
  await writeA;
  gates.get('b')();
  await writeB;
  await new Promise(resolve => setTimeout(resolve, 10));
  const final = store.getSnapshot().view.models;
  assert.equal(final.find(m => m.id === 'a').enabled, true);
  assert.equal(final.find(m => m.id === 'b').enabled, false);
  assert.deepEqual(store.getSnapshot().busy, {});
  store.dispose();
});

test('writes project optimistically and roll back on failure', async () => {
  const base = view({ models: [{ id: 'm', name: 'M', enabled: true }] });
  let gate;
  const pending = new Promise(resolve => { gate = resolve; });
  let fail = false;
  const store = createKiroStore(async request => {
    if (request.op === 'model') {
      await pending;
      if (fail) throw new Error('rejected');
      return { ...base, models: [{ id: 'm', name: 'M', enabled: request.enabled }] };
    }
    return base;
  });
  await store.load();
  const write = store.toggleModel('m', false);
  assert.equal(store.getSnapshot().view.models[0].enabled, false);
  gate();
  await write;
  assert.equal(store.getSnapshot().notice, '设置已保存。');
  fail = true;
  const write2 = store.toggleModel('m', true);
  assert.equal(store.getSnapshot().view.models[0].enabled, true);
  gate();
  await write2;
  assert.equal(store.getSnapshot().view.models[0].enabled, false);
  assert.match(store.getSnapshot().notice, /已恢复原值/);
  assert.match(store.getSnapshot().alert, /rejected/);
  store.dispose();
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