import { join } from 'node:path';
import { profileNames, resolveCli, cliOptions, cliVersion, runKiro, checkRuntimeHome, KiroProblem } from './cli.mjs';
import { apiKey, discoverDirect, discoverSession, sessionCredential } from './direct-http.mjs';

export const ROUTE = 'kiro-native';
export const directMode = mode => mode === 'direct' || mode === 'session' || mode === 'oauth';
const CATALOG_ARGS = ['chat', '--v3', '--list-models', '--format', 'json'];
const VALID_ID = /^[a-z0-9][a-z0-9._:/-]{0,159}$/i;
const positive = n => Number.isSafeInteger(n) && n > 0;
const effortIds = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

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
    if (typeof id !== 'string' || !VALID_ID.test(id) || unique.has(id)) continue;
    unique.add(id);
    const label = row.name ?? row.display_name ?? row.displayName;
    const name = typeof label === 'string' && label.trim() && label.length <= 120 && !/[\x00-\x1f\x7f]/.test(label) ? label.trim() : id;
    const capacity = row.context_window_tokens ?? row.contextWindowTokens;
    const declared = row.reasoning_efforts ?? row.reasoningEfforts;
    const efforts = Array.isArray(declared) ? [...new Set(declared.filter(x => typeof x === 'string' && effortIds.has(x)))] : [];
    models.push(Object.freeze({ id, name, ...(positive(capacity) ? { contextWindow: capacity } : {}), efforts: Object.freeze(efforts) }));
  }
  if (!models.length) throw new KiroProblem('Kiro CLI 没有返回可选模型。');
  return Object.freeze(models);
}

export function createController({ root, settings, readKey, readOAuth, deps = {} }) {
  const resolve = deps.resolve ?? resolveCli;
  const options = deps.options ?? cliOptions;
  const version = deps.version ?? cliVersion;
  const run = deps.run ?? runKiro;
  const check = deps.check ?? checkRuntimeHome;
  const discover = deps.discoverDirect ?? discoverDirect;
  const life = new AbortController();
  let cache;
  let discovery;
  let lastFailure;
  let epoch = 0;
  const signature = s => JSON.stringify([s.mode, directMode(s.mode) ? s.region : s.cliPath, s.keyRef]);
  const signalFor = signal => signal ? AbortSignal.any([signal, life.signal]) : life.signal;

  function snapshot() {
    const current = settings();
    const mode = current.mode === 'gateway' ? 'direct' : current.mode;
    if (!directMode(mode) && !profileNames.includes(mode)) throw new KiroProblem('Kiro 连接方式无效。');
    return Object.freeze({ ...current, mode, disabledModels: [...current.disabledModels] });
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

  function reset() { ++epoch; cache = undefined; discovery = undefined; lastFailure = undefined; }

  async function load(s, signal) {
    if (s.mode === 'direct') return { rows: await discover(await keyFor(s), s.region, signalFor(signal)) };
    if (s.mode === 'session' || s.mode === 'oauth') return { rows: await discoverSession(await sessionFor(s, signal), signalFor(signal)) };
    const selected = await target(s, signal);
    const answer = await run(selected.binary, CATALOG_ARGS, selected.process, { signal: signalFor(signal) });
    if (answer.failure) throw answer.failure;
    if (answer.code !== 0) throw new KiroProblem('Kiro 模型目录不可用；请核对登录或 API Key 后重试。');
    return { rows: parseCatalog(answer.stdout), cli: selected.cli };
  }

  async function getModels(s, { force = false, signal } = {}) {
    const key = signature(s);
    if (signal?.aborted) signal.throwIfAborted();
    if (!force && cache?.key === key && Date.now() < cache.until) return cache.rows;
    if (!signal && discovery?.key === key) return discovery.promise;
    const generation = epoch;
    const promise = (async () => {
      const { rows, cli } = await load(s, signal);
      if (epoch === generation && signature(snapshot()) === key) {
        cache = { key, rows, cli, until: Date.now() + 300_000 };
        lastFailure = undefined;
      }
      return rows;
    })();
    if (!signal) discovery = { key, promise };
    try { return await promise; }
    catch (error) {
      if (!signal?.aborted && !life.signal.aborted && epoch === generation && signature(snapshot()) === key) lastFailure = { key, message: safeProblem(error) };
      throw error;
    }
    finally { if (discovery?.promise === promise) discovery = undefined; }
  }

  function status(s) {
    const current = cache?.key === signature(s) ? cache : undefined;
    return { mode: s.mode, cliVersion: current?.cli ?? null, cliConfigured: Boolean(s.cliPath), keyRef: s.keyRef,
      region: s.region,
      ...(lastFailure?.key === signature(s) ? { modelError: lastFailure.message } : {}),
      ...(s.mode === 'managed' ? { loginHome: join(root, 'managed', 'kiro-home') } : {}),
      models: (current?.rows ?? []).map(row => ({ ...row, enabled: !s.disabledModels.includes(row.id) })) };
  }

  async function detect(s, signal) {
    const models = await getModels(s, { force: true, signal });
    return { cliVersion: status(s).cliVersion, modelCount: models.length,
      mode: s.mode };
  }

  return { snapshot, target, getModels, status, detect, keyFor, sessionFor, reset, signalFor, dispose: () => life.abort() };
}

export function safeProblem(error) {
  if (error instanceof KiroProblem) return error.message;
  return '无法完成 Kiro 设置操作；请检查连接配置后重试。';
}
