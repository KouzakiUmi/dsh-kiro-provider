import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { KiroProblem } from './cli.mjs';
import { beginAws, finishAws, finishSocial, makePkce, organizationIssuer, portalUrl } from './oauth-wire.mjs';

const PORTS = [3128, 4649, 6588, 8008, 9091, 49153, 50153, 51153, 52153, 53153];
const ACTIVE = new Set(['starting', 'waiting', 'authorizing']);
const METHOD = new Map([['builderid', 'builder'], ['awsidc', 'organization'], ['internal', 'organization']]);
const authError = message => new KiroProblem(message, 'AUTH');

async function listen(ports, handler) {
  for (const port of ports) {
    const server = createServer({ requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 8192 }, handler);
    server.maxConnections = 12;
    const started = await new Promise((resolve, reject) => {
      const error = e => { if (e.code === 'EADDRINUSE') resolve(false); else reject(e); };
      server.once('error', error);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', error); resolve(true); });
    });
    if (started) return server;
  }
  throw authError('Kiro 本机回调端口正被占用。请结束其他登录后重试。');
}

function sameState(supplied, expected) {
  return typeof supplied === 'string' && /^[A-Za-z0-9_-]{43}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function answer(res, status, text, location) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", connection: 'close', ...(location ? { location } : {}) });
  res.end(text);
}

export function createOAuth({ save, fetcher = fetch, timeoutMs = 600_000, portalPorts = PORTS, awsPorts = [0] }) {
  let current;
  let disposed = false;
  const status = () => current ? { ...current.public } : { phase: 'idle' };
  const alive = job => current === job && !disposed && !job.controller.signal.aborted;
  function finish(job, phase, message) {
    if (!alive(job)) return;
    job.public = { phase, ...(message ? { message } : {}) };
    job.controller.abort();
    clearTimeout(job.timer);
    job.server?.close();
    job.stage = undefined;
  }

  async function awsStage(job, method, startUrl, region) {
    const proof = makePkce();
    const redirect = `http://127.0.0.1:${job.port}/oauth/callback`;
    const started = await beginAws({ method, startUrl, region, redirect, proof, fetcher, signal: job.controller.signal });
    if (!alive(job)) throw authError('Kiro 登录已结束。');
    job.stage = { mode: 'aws', method, proof, redirect, aws: started.aws };
    return started.url;
  }

  async function onCallback(job, req, res) {
    const validHost = new Set([`127.0.0.1:${job.port}`, `localhost:${job.port}`]);
    if (!alive(job) || req.method !== 'GET' || !validHost.has(req.headers.host) || !req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 8192) return answer(res, 404, '没有等待此回调的登录。');
    const origin = `http://127.0.0.1:${job.port}`;
    const callback = new URL(req.url, origin);
    if (callback.origin !== origin) return answer(res, 404, '这个回调不属于当前登录。');
    const stage = job.stage;
    const q = callback.searchParams;
    const paths = stage?.mode === 'aws' ? ['/oauth/callback'] : ['/oauth/callback', '/signin/callback'];
    if (!stage || !paths.includes(callback.pathname) || q.getAll('state').length !== 1 || !sameState(q.get('state'), stage.proof.state)) return answer(res, 404, '这个回调不属于当前登录。');
    if (job.public.phase !== 'waiting') return answer(res, 409, '当前登录正在处理。');
    job.public = { phase: 'authorizing' };
    try {
      if (q.has('error')) throw authError('授权未完成，请返回 DSH 重新登录。');
      const choice = q.get('login_option');
      if (stage.mode === 'portal' && METHOD.has(choice)) {
        const method = METHOD.get(choice);
        const url = await awsStage(job, method, q.get('issuer_url'), q.get('idc_region') || 'us-east-1');
        job.public = { phase: 'waiting' };
        return answer(res, 302, '前往 AWS 登录。', url);
      }
      if (stage.mode === 'portal' && choice === 'external_idp') throw authError('此组织使用外部身份提供商，请选择「复用本机 Kiro CLI 登录」。');
      const code = q.get('code');
      if (q.getAll('code').length !== 1 || !/^[\x21-\x7e]{1,4096}$/.test(code ?? '')) throw authError('登录服务没有返回有效授权码。');
      const exchange = { ...stage, code, fetcher, signal: job.controller.signal };
      const grant = stage.mode === 'aws' ? await finishAws(exchange)
        : ['google', 'github'].includes(choice) ? await finishSocial({ ...exchange, choice, callbackPath: callback.pathname }) : null;
      if (!grant) throw authError('Kiro 返回了此插件尚未接入的登录方式。');
      if (!alive(job)) return answer(res, 410, 'Kiro 登录已结束。');
      job.committing = true;
      await save(grant, job.controller.signal);
      answer(res, 200, 'Kiro 登录成功。请返回 DeepSeek Harness。');
      finish(job, 'succeeded');
    } catch (error) {
      if (!alive(job)) return answer(res, 410, 'Kiro 登录已结束。');
      answer(res, 400, 'Kiro 登录未完成。请返回 DeepSeek Harness 查看详情。');
      finish(job, 'failed', error instanceof KiroProblem ? error.message : '无法完成 Kiro 登录，请重试。');
    }
  }

  async function start({ method, startUrl, awsRegion }) {
    if (disposed || ACTIVE.has(current?.public.phase)) throw authError('已有登录正在进行，请完成或取消后再试。');
    const region = method === 'builder' ? 'us-east-1' : awsRegion;
    if (method === 'organization') organizationIssuer(startUrl, region);
    else if (method !== 'portal' && method !== 'builder') throw authError('Kiro 登录方式无效。');
    const job = { public: { phase: 'starting' }, controller: new AbortController() };
    current = job;
    job.timer = setTimeout(() => { if (!job.committing) finish(job, 'failed', '登录已超时，请重新开始。'); }, timeoutMs);
    job.timer.unref?.();
    try {
      job.server = await listen(method === 'portal' ? portalPorts : awsPorts, (req, res) => {
        void onCallback(job, req, res).catch(() => { if (!res.headersSent) answer(res, 400, '无效的登录回调。'); });
      });
      if (!alive(job)) { job.server.close(); throw authError('Kiro 登录已结束。'); }
      job.port = job.server.address().port;
      let url;
      if (method === 'portal') {
        job.stage = { mode: 'portal', redirect: `http://localhost:${job.port}`, proof: makePkce() };
        url = portalUrl(job.stage.redirect, job.stage.proof);
      } else url = await awsStage(job, method, startUrl, region);
      job.public = { phase: 'waiting' };
      return { phase: 'waiting', url };
    } catch (error) {
      const failure = error instanceof KiroProblem ? error : authError('无法启动 Kiro 登录，请重试。');
      finish(job, 'failed', failure.message);
      throw failure;
    }
  }
  function cancel() {
    if (ACTIVE.has(current?.public.phase) && !current.committing) finish(current, 'cancelled');
    return status();
  }
  function clear() { if (!ACTIVE.has(current?.public.phase)) current = undefined; }
  function dispose() {
    if (ACTIVE.has(current?.public.phase)) finish(current, 'cancelled');
    disposed = true;
  }
  return { start, status, cancel, clear, dispose, pending: () => ACTIVE.has(current?.public.phase) };
}
