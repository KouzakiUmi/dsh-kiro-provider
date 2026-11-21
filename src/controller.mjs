import { join } from 'node:path';
import { profileNames, resolveCli, cliOptions, cliVersion, runKiro, checkRuntimeHome, KiroProblem } from './cli.mjs';
import { apiKey, discoverDirect, discoverSession, sessionCredential, usageDirect, usageSession } from './direct-http.mjs';
import { createCatalog, parseCatalog, validateCatalog, MODEL_ID, effortIds } from './catalog.mjs';
import { createUsage, parseUsage, validateUsage } from './usage.mjs';
import { createUsageScheduler } from './usage-scheduler.mjs';
import { normalizeAdvanced } from './remote.mjs';

export const ROUTE = 'kiro-native';
export const directMode = mode => mode === 'direct' || mode === 'session' || mode === 'oauth';
const CATALOG_ARGS = ['chat', '--v3', '--list-models', '--format', 'json'];

export const snapshotValidators = { catalog: validateCatalog, usage: validateUsage };

function normalizeDefaults(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.id !== 'string' || !MODEL_ID.test(row.id) || seen.has(row.id)) continue;
    const effort = effortIds.has(row.effort) ? row.effort : undefined;
    const maxTokens = Number.isSafeInteger(row.maxTokens) && row.maxTokens > 0 ? row.maxTokens : undefined;
    if (!effort && !maxTokens) continue;
    seen.add(row.id);
    out.push({ id: row.id, ...(effort ? { effort } : {}), ...(maxTokens ? { maxTokens } : {}) });
  }
  return out;
}

export function createController({ root, store, settings, readKey, readOAuth, onUpdate, deps = {} }) {
  const resolve = deps.resolve ?? resolveCli;
  const options = deps.options ?? cliOptions;
  const version = deps.version ?? cliVersion;
  const run = deps.run ?? runKiro;
  const check = deps.check ?? checkRuntimeHome;
  const discover = deps.discoverDirect ?? discoverDirect;
  const discoverSess = deps.discoverSession ?? discoverSession;
  const usageKey = deps.usageDirect ?? usageDirect;
  const usageSess = deps.usageSession ?? usageSession;
  const life = new AbortController();
  const signature = s => JSON.stringify([s.mode, directMode(s.mode) ? s.region : s.cliPath, s.keyRef]);
  const signalFor = signal => signal ? AbortSignal.any([signal, life.signal]) : life.signal;

  function snapshot() {
    const current = settings();
    const mode = current.mode === 'gateway' ? 'direct' : current.mode;
    if (!directMode(mode) && !profileNames.includes(mode)) throw new KiroProblem('Kiro 连接方式无效。');
    return Object.freeze({ ...current, mode, disabledModels: [...current.disabledModels], modelDefaults: normalizeDefaults(current.modelDefaults), advanced: normalizeAdvanced(current) });
  }

  const keyFor = async s => apiKey(await readKey(s.keyRef));
  const sessionFor = async (s, signal) => s.mode === 'oauth' ? readOAuth(signalFor(signal)) : sessionCredential(await readKey(s.keyRef));

  async function target(s, signal) {
    signal = signalFor(signal);
    signal.throwIfAborted();
    const binary = await resolve(s.cliPath);
    let key;
    if (s.mode === 'key') key = await keyFor(s);
    const process = await options(root, s.mode, key);
    await check(process.env);
    const cli = await version(binary, process, signal);
    signal.throwIfAborted();
    return { mode: s.mode, binary, process, cli };
  }

  async function fetchCatalog(s, signal) {
    signal = signalFor(signal);
    if (s.mode === 'direct') return { rows: await discover(await keyFor(s), s.region, signal), cli: null };
    if (s.mode === 'session' || s.mode === 'oauth') return { rows: await discoverSess(await sessionFor(s, signal), signal), cli: null };
    const selected = await target(s, signal);
    const answer = await run(selected.binary, CATALOG_ARGS, selected.process, { signal });
    if (answer.failure) throw answer.failure;
    if (answer.code !== 0) throw new KiroProblem('Kiro 模型目录不可用；请核对登录或 API Key 后重试。');
    return { rows: parseCatalog(answer.stdout), cli: selected.cli };
  }

  async function fetchUsage(s, signal) {
    signal = signalFor(signal);
    const raw = s.mode === 'direct' ? await usageKey(await keyFor(s), s.region, signal) : await usageSess(await sessionFor(s, signal), signal);
    return parseUsage(raw);
  }

  const catalog = createCatalog({ store, keyOf: signature, fetch: fetchCatalog, onUpdate });
  const usage = createUsage({ store, keyOf: signature, fetch: fetchUsage });
  const ready = store.load().catch(() => {});
  const modeOf = () => { const mode = settings().mode; return mode === 'gateway' ? 'direct' : mode; };
  const scheduler = createUsageScheduler({
    refresh: () => usage.refresh(snapshot(), {}),
    intervalSeconds: () => normalizeAdvanced(settings()).quotaRefreshSeconds,
    enabled: () => directMode(modeOf()),
  });
  void ready.then(() => scheduler.schedule());

  // Read paths never touch the upstream; they serve memory, then the persisted snapshot.
  function read(s) {
    const view = catalog.read(s);
    return { rows: view.value?.rows ?? [], cli: view.value?.cli ?? null, at: view.at ?? null, source: view.source, stale: view.stale, ...(view.error ? { error: view.error } : {}) };
  }

  function usageRead(s) {
    if (!directMode(s.mode)) return { supported: false };
    const view = usage.read(s);
    return { supported: true, ...(view.value ?? {}), at: view.at ?? null, stale: view.stale, ...(view.error ? { error: view.error } : {}), ...scheduler.state() };
  }

  function status(s) {
    const current = read(s);
    return { mode: s.mode, cliVersion: current.cli, cliConfigured: Boolean(s.cliPath), keyRef: s.keyRef, region: s.region,
      ...(s.mode === 'managed' ? { loginHome: join(root, 'managed', 'kiro-home') } : {}),
      models: current.rows.map(row => ({ ...row, enabled: !s.disabledModels.includes(row.id) })),
      catalogAt: current.at, catalogSource: current.source, ...(current.error ? { modelError: current.error } : {}),
      usage: usageRead(s), modelDefaults: s.modelDefaults, advanced: s.advanced };
  }

  async function refresh(s, { force = false, signal } = {}) {
    await ready;
    const value = await catalog.refresh(s, { force, signal });
    if (directMode(s.mode)) await usage.refresh(s, { force, signal }).catch(() => {});
    return value;
  }

  async function refreshUsage(s, { force = false, signal } = {}) {
    await ready;
    if (!directMode(s.mode)) throw new KiroProblem('当前连接方式不支持读取 Kiro 额度；请在 Kiro 账户页查看。', 'UNSUPPORTED_OPTION');
    return scheduler.manual(usage.refresh(s, { force, signal }));
  }

  function revalidate(s) {
    void ready.then(() => {
      catalog.revalidate(s);
      if (directMode(s.mode)) usage.revalidate(s);
    });
  }

  // Model calls use the persisted rows when present; only a cold start waits for a fetch.
  async function ensure(s, signal) {
    await ready;
    const current = read(s);
    if (current.rows.length) return current.rows;
    return (await catalog.refresh(s, { signal: signalFor(signal) })).rows;
  }

  async function detect(s, signal) {
    await ready;
    const value = await catalog.refresh(s, { force: true, signal: signalFor(signal) });
    return { cliVersion: value.cli, modelCount: value.rows.length, mode: s.mode };
  }

  function reset() {
    catalog.reset();
    usage.reset();
    const key = signature(snapshot());
    store.invalidate('catalog', key);
    store.invalidate('usage', key);
    scheduler.reset();
  }

  return { ready, snapshot, target, read, status, refresh, refreshUsage, revalidate, ensure, detect, keyFor, sessionFor, reset, signalFor,
    reschedule: () => scheduler.schedule(),
    dispose: () => { scheduler.dispose(); life.abort(); } };
}