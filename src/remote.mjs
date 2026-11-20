export const pluginId = 'dsh-kiro-provider';
const remoteService = 'kiroProvider';
const modes = ['oauth', 'direct', 'session', 'local', 'managed', 'key'];
const phases = ['idle', 'starting', 'waiting', 'authorizing', 'succeeded', 'cancelled', 'failed'];
const idPattern = /^[a-z0-9][a-z0-9._:/-]{0,159}$/i;
const refPattern = /^[A-Za-z_][A-Za-z0-9_]{0,95}$/;
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function organizationInput(startUrl, awsRegion) {
  const region = typeof awsRegion === 'string' ? awsRegion.trim() : '';
  const invalid = '请输入组织提供的 AWS HTTPS Start URL 和商业区 Region，例如 us-east-1。';
  const candidate = typeof startUrl === 'string' && startUrl.length <= 700 ? startUrl.trim() : '';
  let url;
  try { url = new URL(candidate); } catch { return { error: invalid }; }
  const awsApps = /^[a-z0-9-]+\.awsapps\.com$/.test(url.hostname) && /^\/start\/?$/.test(url.pathname);
  const awsIssuer = url.hostname === 'identitycenter.amazonaws.com' && /^\/ssoins-[a-z0-9]+\/?$/i.test(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !(awsApps || awsIssuer)
    || !/^(?!cn-|us-gov-|us-iso|eusc-)[a-z]{2}-[a-z]+(?:-[a-z]+)*-[1-9]\d?$/.test(region)) return { error: invalid };
  return { startUrl: url.href, awsRegion: region };
}

export function parseRequest(value) {
  if (!record(value) || typeof value.op !== 'string') throw new Error('Kiro 设置请求无效。');
  if (['status', 'detect', 'refresh', 'loginStatus', 'loginCancel', 'logout'].includes(value.op)) return { op: value.op };
  if (value.op === 'loginStart') {
    const { method, startUrl, awsRegion } = value;
    if (method === 'builder' || method === 'portal') return { op: value.op, method };
    if (method === 'organization' && typeof startUrl === 'string' && startUrl.length <= 700 && typeof awsRegion === 'string' && awsRegion.length <= 40) {
      return { op: value.op, method, startUrl: startUrl.trim(), awsRegion: awsRegion.trim() };
    }
  }
  if (value.op === 'connection' && modes.includes(value.mode)) {
    const valid = typeof value.keyRef === 'string' && refPattern.test(value.keyRef);
    const direct = value.mode === 'direct';
    const region = value.region;
    if (direct && !['us-east-1', 'eu-central-1'].includes(region)) throw new Error('Kiro 区域无效。');
    if (valid || (!direct && !['session', 'key'].includes(value.mode))) return { op: value.op, mode: value.mode, keyRef: valid ? value.keyRef : 'KIRO_API_KEY', ...(direct ? { region } : {}) };
  }
  if (value.op === 'model' && typeof value.id === 'string' && idPattern.test(value.id) && typeof value.enabled === 'boolean') {
    return { op: value.op, id: value.id, enabled: value.enabled };
  }
  throw new Error('Kiro 设置请求无效。');
}

function codec(type, parse) {
  return { mode: 'strict', typeSymbol: `${pluginId}#${type}`, schema: { parse }, create: () => ({ parse }) };
}

export function readSettingsReply(reply, op) {
  const malformed = () => new Error('收到的 Kiro 设置数据不完整，请重试。');
  if (!record(reply) || typeof reply.ok !== 'boolean') throw malformed();
  if (!reply.ok) throw new Error('无法连接 Kiro 设置服务，请重试。');

  // Typert wraps the Host method's own outcome in a transport RemoteResult.
  const outcome = reply.value;
  if (!record(outcome) || typeof outcome.ok !== 'boolean') throw malformed();
  if (!outcome.ok) throw new Error(typeof outcome.error?.message === 'string' ? outcome.error.message : 'Kiro 设置请求失败。');
  const data = outcome.value;
  if (['loginStart', 'loginStatus', 'loginCancel', 'logout'].includes(op)) {
    if (!record(data) || !phases.includes(data.phase) || (data.message !== undefined && typeof data.message !== 'string')) throw malformed();
    if (op === 'loginStart') {
      if (data.phase !== 'waiting' || typeof data.url !== 'string' || data.url.length > 4096) throw malformed();
      let url;
      try { url = new URL(data.url); } catch { throw malformed(); }
      const fromPortal = url.hostname === 'app.kiro.dev' && url.pathname === '/signin';
      const fromAws = /^oidc\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname) && url.pathname === '/authorize';
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !(fromPortal || fromAws)) throw malformed();
      return { phase: data.phase, url: url.href };
    }
    return { phase: data.phase, ...(data.message ? { message: data.message } : {}) };
  }
  if (!record(data) || !modes.includes(data.mode)) throw malformed();
  if (op === 'detect') {
    if (!Number.isSafeInteger(data.modelCount) || data.modelCount < 0 || !(data.cliVersion === null || typeof data.cliVersion === 'string')) throw malformed();
    return data;
  }
  if (typeof data.oauthConnected !== 'boolean' || typeof data.keyRef !== 'string' || !['us-east-1', 'eu-central-1'].includes(data.region) || !Array.isArray(data.models)
    || !data.models.every(model => record(model) && typeof model.id === 'string' && typeof model.name === 'string' && typeof model.enabled === 'boolean')) throw malformed();
  return data;
}

export const kiroRemote = {
  package: pluginId,
  descriptors: [{
    id: `${pluginId}#${remoteService}/invoke`, service: remoteService, namespace: remoteService,
    method: 'invoke', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec('Request', parseRequest) }],
    result: codec('Response', value => {
      if (!record(value) || typeof value.ok !== 'boolean') throw new Error('Kiro 设置响应无效。');
      return value;
    }),
  }],
};
