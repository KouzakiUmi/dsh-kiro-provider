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
const { createKiroStore, normalizeLogin, registerContextPill, registerUsagePill } = clientModule;

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

test('pill injects the ModelDirectory instance and the RPC caller', () => {
  // 药丸从 directory.store 读会话选择，经插件 RPC 写上下文档位；注入本体而非 .store。
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
  const call = async () => ({});
  registerContextPill(ctx, call);
  assert.equal(registered.meta.name, 'conversation.input.right');
  const props = registered.meta.inject('session-fixture');
  assert.equal(props.directory, fakeDirectory);
  assert.equal(props.call, call);
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
    models: [{ id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', enabled: true, efforts: ['low', 'max'], contextWindow: 200000, creditRate: 1.3, maxTokenRange: { min: 1, max: 64000 } },
      { id: 'claude-sonnet-4.5', name: 'claude-sonnet-4.5', enabled: false, legacy: true, efforts: [], contextWindow: 200000, creditRate: 1.3 }],
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
  rendered.KiroContextPill({ directory: { store: { subscribe: () => () => {}, getSnapshot: () => ({ current: { provider: 'kiro-native', model: 'claude-sonnet-5.5' } }) } }, call: async () => fullView, sessionId: 's' });
  rendered.KiroUsagePill({ directory: { store: { subscribe: () => () => {}, getSnapshot: () => ({ current: { provider: 'kiro-native', model: 'claude-sonnet-5.5' } }) } }, call: async () => fullView, sessionId: 's' });
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
  assert.deepEqual(filterModels([{ id: 'claude-sonnet-5.5', name: 'claude-sonnet-5.5', enabled: true }], 'Claude Sonnet').map(m => m.id), ['claude-sonnet-5.5']);
  assert.equal(tabAfter('ArrowRight', 'overview'), 'models');
  assert.equal(tabAfter('ArrowLeft', 'overview'), 'advanced');
  assert.equal(tabAfter('Home', 'advanced'), 'overview');
  assert.equal(tabAfter('End', 'overview'), 'advanced');
  assert.equal(tabAfter('Enter', 'overview'), null);
});

test('model settings writes carry the context tier and project optimistically', async () => {
  const base = view({ models: [{ id: 'm', name: 'M', enabled: true, contextWindow: 1000000 }], modelDefaults: [{ id: 'm', effort: 'max' }] });
  const calls = [];
  const store = createKiroStore(async request => {
    calls.push(request);
    return { ...base, modelDefaults: [{ id: 'm', effort: 'max', contextTier: 'standard' }] };
  });
  await store.load();
  const write = store.saveModelSettings('m', 'max', 0, 'standard');
  assert.equal(store.getSnapshot().view.modelDefaults[0].contextTier, 'standard');
  await write;
  const sent = calls.find(c => c.op === 'modelSettings');
  assert.deepEqual(sent, { op: 'modelSettings', id: 'm', effort: 'max', maxTokens: 0, contextTier: 'standard' });
  assert.equal(store.getSnapshot().view.modelDefaults[0].contextTier, 'standard');
  store.dispose();
});

test('pill context writes use field-level merge op and preserve other defaults', async () => {
  const base = view({ models: [{ id: 'm', name: 'M', enabled: true, contextWindow: 1000000 }], modelDefaults: [{ id: 'm', effort: 'max', maxTokens: 4096 }] });
  const calls = [];
  const store = createKiroStore(async request => {
    calls.push(request);
    return { ...base, modelDefaults: [{ id: 'm', effort: 'max', maxTokens: 4096, contextTier: 'standard' }] };
  });
  await store.load();
  const write = store.setContextTier('m', 'standard');
  assert.equal(store.getSnapshot().view.modelDefaults[0].contextTier, 'standard');
  assert.equal(store.getSnapshot().view.modelDefaults[0].effort, 'max');
  await write;
  const sent = calls.find(c => c.op === 'modelContext');
  assert.deepEqual(sent, { op: 'modelContext', id: 'm', contextTier: 'standard' });
  store.dispose();
});

test('restore recommended clears overrides and projects legacy models off', async () => {
  const base = view({ models: [{ id: 'claude-sonnet-4.5', name: 'claude-sonnet-4.5', enabled: true }, { id: 'claude-sonnet-5.5', name: 'claude-sonnet-5.5', enabled: true }] });
  const calls = [];
  const store = createKiroStore(async request => {
    calls.push(request.op);
    return { ...base, models: [{ id: 'claude-sonnet-4.5', name: 'claude-sonnet-4.5', enabled: false, legacy: true }, { id: 'claude-sonnet-5.5', name: 'claude-sonnet-5.5', enabled: true, legacy: false }] };
  });
  await store.load();
  const write = store.restoreRecommended();
  assert.equal(store.getSnapshot().view.models.find(m => m.id === 'claude-sonnet-4.5').enabled, false);
  await write;
  assert.ok(calls.includes('recommend'));
  assert.equal(store.getSnapshot().notice, '设置已保存。');
  store.dispose();
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

test('usage pill registers conversation.input.right slot and hides for non-kiro providers', () => {
  const fakeDirectory = {
    store: { subscribe: () => () => {}, getSnapshot: () => ({ current: { provider: 'openai', model: 'gpt-5' } }) },
  };
  let registered;
  const scope = {
    modelDirectories: { directoryFor: () => fakeDirectory },
    effect: fn => fn(),
    slots: {
      inject: (_owner, register) => register(),
      register: (meta, component) => { registered = { meta, component }; },
    },
  };
  const ctx = { inject: (names, fn) => { if (names.includes('modelDirectories')) fn(scope); } };
  const call = async () => view();
  registerUsagePill(ctx, call);
  assert.equal(registered.meta.name, 'conversation.input.right');
  assert.equal(registered.meta.id, 'kiro-provider-quota');
  assert.equal(registered.meta.order, 1002);
  const props = registered.meta.inject('s-1');
  assert.equal(props.directory, fakeDirectory);
  assert.equal(props.call, call);

  const expandStub = {
    createElement: (type, p, ...c) => typeof type === 'function' ? type({ ...(p ?? {}), children: c.length === 1 ? c[0] : c }) : { type, props: { ...(p ?? {}), children: c } },
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: init => ({ current: init }),
    useCallback: fn => fn,
    useSyncExternalStore: (_sub, get) => get(),
    Fragment: 'Fragment',
  };
  const { KiroUsagePill } = factory(() => expandStub);
  assert.equal(KiroUsagePill({ directory: fakeDirectory, call, sessionId: 's-1' }), null);
});

test('usage pill displays proportional remaining bars, warns cleanly, opens popover, and refreshes via op=usage', async () => {
  const slots = [];
  const effectDeps = [];
  const cleanups = [];
  let pending = [];
  let cursor = 0;

  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const mount = (Component, props) => {
    const step = () => {
      cursor = 0;
      const tree = harness.createElement(Component, props);
      const run = pending;
      pending = [];
      for (const [slotIdx, fn] of run) {
        if (cleanups[slotIdx]) { cleanups[slotIdx](); cleanups[slotIdx] = undefined; }
        cleanups[slotIdx] = fn();
      }
      return tree;
    };
    return {
      render: step,
      settle: async () => {
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setImmediate(r));
          step();
        }
        return step();
      },
      unmount: () => { for (const c of cleanups) c?.(); },
    };
  };

  const harness = {
    createElement: (type, p, ...children) => {
      const merged = { ...(p ?? {}), children: children.length === 1 ? children[0] : children };
      if (typeof type === 'function') return type(merged);
      return { type, props: merged };
    },
    useState: init => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef: init => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useCallback: (fn, deps) => {
      const i = cursor++;
      if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useSyncExternalStore: (_sub, get) => get(),
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (!effectDeps[i] || !deps || !sameDeps(effectDeps[i], deps)) {
        effectDeps[i] = deps;
        pending.push([i, fn]);
      }
    },
    Fragment: 'Fragment',
  };

  const find = (node, pred) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) { const hit = find(item, pred); if (hit) return hit; }
      return null;
    }
    if (pred(node)) return node;
    return node.props?.children !== undefined ? find(node.props.children, pred) : null;
  };
  const collectText = node => {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join('');
    if (typeof node === 'object' && node.props?.children !== undefined) return collectText(node.props.children);
    return '';
  };

  const { KiroUsagePill } = factory(() => harness);
  const ops = [];
  let snap = view({
    oauthConnected: true,
    usage: {
      supported: true, plan: 'Kiro Pro', user: 'dev@example.com',
      windows: [{ kind: 'plan', name: 'Credits', used: 80, limit: 100, percent: 80, resetsAt: '2026-12-01T00:00:00.000Z' }],
      at: Date.now() - 30_000, stale: false, autoRefreshPaused: false, refreshFailures: 0,
    },
  });
  let currentProvider = 'kiro-native';
  const directory = {
    store: {
      subscribe: () => () => {},
      getSnapshot: () => ({ current: { provider: currentProvider, model: 'claude-sonnet-5.5' } }),
    },
  };
  let usageHandler = async () => {
    snap = view({
      oauthConnected: true,
      usage: {
        supported: true, plan: 'Kiro Pro', user: 'dev@example.com',
        windows: [{ kind: 'plan', name: 'Credits', used: 100, limit: 100, percent: 100, resetsAt: '2026-12-01T00:00:00.000Z' }],
        at: Date.now(), stale: false, autoRefreshPaused: false, refreshFailures: 0,
      },
    });
    return snap;
  };
  const call = async req => {
    ops.push(req.op);
    if (req.op === 'usage') return usageHandler();
    return snap;
  };

  const mounted = mount(KiroUsagePill, { directory, call, sessionId: 's-quota' });
  try {
    let tree = await mounted.settle();
    assert.ok(ops.includes('status'));
    const trigger = find(tree, n => n.props?.className === 'kiro-quota-trigger');
    assert.ok(trigger);
    assert.equal(trigger.props['data-tinted'], 'true');
    const barFill = find(trigger, n => n.props?.className === 'kiro-quota-mini-fill');
    assert.equal(barFill.props.style.width, '20%');
    assert.match(collectText(trigger), /偏少/);
    assert.equal(find(tree, n => n.props?.role === 'dialog'), null);

    // Open popover and verify UsageSummary + refresh action (100% -> 0% remaining + 已用尽).
    trigger.props.onClick();
    tree = await mounted.settle();
    const dialog = find(tree, n => n.props?.role === 'dialog');
    assert.ok(dialog);
    assert.match(collectText(dialog), /Kiro · 额度/);
    assert.match(collectText(dialog), /Kiro Pro/);
    assert.match(collectText(dialog), /20%/);

    const refreshBtn = find(dialog, n => n.props?.className === 'kiro-quota-refresh');
    assert.equal(collectText(refreshBtn), '刷新额度');
    refreshBtn.props.onClick();
    tree = await mounted.settle();
    assert.ok(ops.includes('usage'));
    const updatedFill = find(tree, n => n.props?.className === 'kiro-quota-mini-fill');
    assert.equal(updatedFill.props.style.width, '0%');
    assert.match(collectText(find(tree, n => n.props?.className === 'kiro-quota-trigger')), /已用尽/);

    // Refresh error preserves cached snapshot and displays error notice inside popover.
    usageHandler = async () => { throw new Error('quota backend offline'); };
    find(tree, n => n.props?.className === 'kiro-quota-refresh').props.onClick();
    tree = await mounted.settle();
    const dialogErr = find(tree, n => n.props?.role === 'dialog');
    assert.match(collectText(dialogErr), /quota backend offline/);
    assert.match(collectText(dialogErr), /Kiro Pro/);

    // Unsupported CLI mode displays neutral account-page label and uses op=status to recheck.
    usageHandler = async () => {
      snap = view({ mode: 'cli', usage: { supported: false } });
      return snap;
    };
    find(tree, n => n.props?.className === 'kiro-quota-refresh').props.onClick();
    tree = await mounted.settle();
    const cliTrigger = find(tree, n => n.props?.className === 'kiro-quota-trigger');
    assert.equal(cliTrigger.props['data-short'], 'true');
    assert.match(collectText(cliTrigger), /账户页/);
    const cliDialog = find(tree, n => n.props?.role === 'dialog');
    assert.match(collectText(cliDialog), /打开 Kiro 账户页/);
    const cliRefresh = find(cliDialog, n => n.props?.className === 'kiro-quota-refresh');
    assert.equal(collectText(cliRefresh), '刷新状态');
    const opsBeforeCliRecheck = ops.length;
    cliRefresh.props.onClick();
    tree = await mounted.settle();
    assert.equal(ops[opsBeforeCliRecheck], 'status');

    // Close popover via close button and verify switching provider hides pill.
    find(tree, n => n.props?.className === 'kiro-quota-close').props.onClick();
    tree = mounted.render();
    assert.equal(find(tree, n => n.props?.role === 'dialog'), null);
    currentProvider = 'anthropic';
    assert.equal(mounted.render(), null);
  } finally {
    mounted.unmount();
  }
});

test('context pill renders a flat segmented group matching other plugins without redundant labels', async () => {
  const slots = [];
  const effectDeps = [];
  const cleanups = [];
  let pending = [];
  let cursor = 0;
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const harness = {
    createElement: (type, p, ...children) => {
      const merged = { ...(p ?? {}), children: children.length === 1 ? children[0] : children };
      return typeof type === 'function' ? type(merged) : { type, props: merged };
    },
    useState: init => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef: init => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useCallback: (fn, deps) => {
      const i = cursor++;
      if (!slots[i] || !sameDeps(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useSyncExternalStore: (_sub, get) => get(),
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (!effectDeps[i] || !deps || !sameDeps(effectDeps[i], deps)) {
        effectDeps[i] = deps;
        pending.push([i, fn]);
      }
    },
    Fragment: 'Fragment',
  };
  const step = props => {
    cursor = 0;
    const tree = harness.createElement(KiroContextPill, props);
    const run = pending;
    pending = [];
    for (const [idx, fn] of run) {
      if (cleanups[idx]) { cleanups[idx](); cleanups[idx] = undefined; }
      cleanups[idx] = fn();
    }
    return tree;
  };
  const { KiroContextPill } = factory(() => harness);
  const calls = [];
  let snap = view({
    models: [{ id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', enabled: true, efforts: [], contextWindow: 1_000_000 }],
    modelDefaults: [],
  });
  const directory = {
    store: {
      subscribe: () => () => {},
      getSnapshot: () => ({ current: { provider: 'kiro-native', model: 'claude-sonnet-4.6' } }),
    },
  };
  const props = {
    directory,
    sessionId: 's-ctx',
    call: async req => {
      calls.push(req);
      if (req.op === 'modelContext') {
        snap = { ...snap, modelDefaults: req.contextTier ? [{ id: req.id, contextTier: req.contextTier }] : [] };
      }
      return snap;
    },
  };
  try {
    let tree;
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setImmediate(r));
      tree = step(props);
    }
    assert.equal(tree.props.className, 'kiro-pill');
    assert.equal(tree.props.role, 'group');
    const buttons = tree.props.children.flat();
    assert.deepEqual(buttons.map(b => b.props.className), ['kiro-pill-tier', 'kiro-pill-tier', 'kiro-pill-tier']);
    assert.deepEqual(buttons.map(b => b.props.children), ['256K', '500K', '1M']);
    assert.deepEqual(buttons.map(b => b.props['aria-pressed']), [false, false, true]);

    buttons[0].props.onClick();
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setImmediate(r));
      tree = step(props);
    }
    assert.deepEqual(calls.find(c => c.op === 'modelContext'), { op: 'modelContext', id: 'claude-sonnet-4.6', contextTier: 'standard' });
    assert.deepEqual(tree.props.children.flat().map(b => b.props['aria-pressed']), [true, false, false]);
  } finally {
    for (const cleanup of cleanups) cleanup?.();
  }
});