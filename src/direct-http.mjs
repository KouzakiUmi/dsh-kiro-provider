import { KiroProblem } from './cli.mjs';
import metadata from '../package.json' with { type: 'json' };

export const regions = ['us-east-1', 'eu-central-1'];
export const CLIENT = `${metadata.name}/${metadata.version}`;
const allowedEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,150}$/;
const profilePattern = /^arn:aws:codewhisperer:(us-east-1|eu-central-1):\d{12}:profile\/[A-Za-z0-9_-]{1,160}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const entries = x => Array.isArray(x) ? x : [];

export function kiroFailure(status, detail = '') {
  if (/no longer supported|client.upgrade|required.client.version|update to the latest version/i.test(detail)) return new KiroProblem('Kiro 拒绝了当前直连客户端版本。', 'CLIENT_UPGRADE_REQUIRED');
  if (/context.window.exceeded|input.is.too.long/i.test(detail)) return new KiroProblem('请求超过 Kiro 模型的上下文窗口。', 'CONTEXT_WINDOW_EXCEEDED');
  if (/usage.limit|monthly.limit|quota.exceeded|credit.*exhausted/i.test(detail)) return new KiroProblem('Kiro 账号额度已耗尽。', 'QUOTA');
  if (status === 401 || status === 403) return new KiroProblem('Kiro 拒绝了凭据或账号权限。', 'AUTH');
  if (status === 429 || /throttl|rate.exceeded/i.test(detail)) return new KiroProblem('Kiro 正在限流。', 'RATE_LIMIT');
  if (status >= 500) return new KiroProblem('Kiro 服务暂时不可用。', 'SERVER');
  return new KiroProblem(status ? `Kiro 拒绝了直连请求（HTTP ${status}）。` : 'Kiro 返回了流式错误事件。', 'INVALID_RESPONSE');
}

export function directModelCatalog(pages) {
  const records = new Map();
  for (const page of pages) for (const row of entries(page?.models)) {
    const id = row?.modelId;
    if (typeof id !== 'string' || !modelIdPattern.test(id) || records.has(id)) continue;
    const { maxInputTokens, maxOutputTokens } = row.tokenLimits ?? {};
    if (!positive(maxInputTokens) || !positive(maxOutputTokens)) continue;
    const fields = row.additionalModelRequestFieldsSchema?.properties;
    const adaptive = entries(fields?.thinking?.properties?.type?.enum).includes('adaptive');
    const routing = ['output_config', 'reasoning'].find(path => (adaptive || path === 'reasoning') && entries(fields?.[path]?.properties?.effort?.enum).length);
    const efforts = routing ? allowedEfforts.filter(x => fields[routing].properties.effort.enum.includes(x)) : [];
    const limit = fields?.max_tokens;
    const limitMin = limit?.minimum ?? 1;
    const limitMax = Math.min(limit?.maximum, maxOutputTokens);
    const maxTokenRange = limit?.type === 'integer' && positive(limit.maximum) && positive(limitMin) && limitMin <= limitMax ? Object.freeze({ min: limitMin, max: limitMax }) : undefined;
    const name = typeof row.modelName === 'string' && row.modelName.trim() && row.modelName.length <= 120 && !/[\x00-\x1f\x7f]/.test(row.modelName) ? row.modelName.trim() : id;
    records.set(id, Object.freeze({ id, name, contextWindow: maxInputTokens, maxTokens: maxOutputTokens,
      inputModalities: Object.freeze(entries(row.supportedInputTypes).some(v => /^image$/i.test(v)) ? ['text', 'image'] : ['text']),
      efforts: Object.freeze(efforts), effortField: routing, adaptive, maxTokenRange,
    }));
  }
  if (!records.size) throw new KiroProblem('Kiro 没有返回包含模型参数的目录。', 'INVALID_CATALOG');
  const preferred = pages.find(p => p?.defaultModel?.modelId)?.defaultModel?.modelId;
  return Object.freeze([...records.values()].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred)));
}

async function readLimited(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > limit) throw new KiroProblem('Kiro 返回的数据超过大小限制。', 'INVALID_RESPONSE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function apiKey(value) {
  if (typeof value !== 'string' || !/^ksk_[\x21-\x7e]{8,512}$/.test(value)) throw new KiroProblem('请在 DSH 凭据中配置 Kiro API Key，再刷新模型。', 'MISSING_CREDENTIAL');
  return value;
}

export function sessionCredential(value) {
  if (typeof value !== 'string' || value.length > 32_768) throw new KiroProblem('请在 DSH 凭据中配置 Kiro 会话凭据。', 'MISSING_CREDENTIAL');
  let session;
  try { session = JSON.parse(value); } catch { throw new KiroProblem('Kiro 会话凭据格式错误。', 'INVALID_CREDENTIAL'); }
  const region = typeof session?.profileArn === 'string' ? profilePattern.exec(session.profileArn)?.[1] : undefined;
  if (!region || typeof session.accessToken !== 'string' || !/^[\x21-\x7e]{12,24576}$/.test(session.accessToken)
    || !['social', 'sso'].includes(session.method) || !Number.isSafeInteger(session.expiresAt)) {
    throw new KiroProblem('Kiro 会话凭据缺少访问令牌、账号资料、登录类型或过期时间。', 'INVALID_CREDENTIAL');
  }
  if (session.expiresAt <= Date.now() + 15_000) throw new KiroProblem('Kiro 会话凭据已过期，请更新后重试。', 'AUTH');
  return { token: session.accessToken, region, profileArn: session.profileArn, ...(session.method === 'sso' ? { tokenType: 'SSO_OIDC' } : {}) };
}

const host = (kind, region) => {
  if (!regions.includes(region)) throw new KiroProblem('Kiro 区域配置无效。', 'INVALID_CONFIG');
  return `https://${kind}.${region}.kiro.dev`;
};
const headers = token => ({ authorization: `Bearer ${token}`, tokentype: 'API_KEY', 'user-agent': CLIENT });
const bearerHeaders = auth => ({ authorization: `Bearer ${auth.token}`, 'user-agent': CLIENT, ...(auth.tokenType ? { tokentype: auth.tokenType } : {}) });

async function request(fetcher, url, signal, init, timeoutMs, headersOnly = false) {
  const deadline = headersOnly ? new AbortController() : undefined;
  const timer = deadline ? setTimeout(() => deadline.abort(), timeoutMs) : undefined;
  timer?.unref();
  const timeout = deadline?.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    return await fetcher(url, { method: 'POST', ...init, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof KiroProblem) throw error;
    if (timeout.aborted) throw new KiroProblem('等待 Kiro 响应超时。', 'TIMEOUT');
    throw new KiroProblem('无法连接 Kiro 服务。', 'TRANSPORT');
  } finally { if (timer) clearTimeout(timer); }
}

async function control(fetcher, token, region, operation, body, signal) {
  const response = await request(fetcher, `${host('management', region)}/?origin=KIRO_CLI`, signal, {
    headers: { ...headers(token), 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': `KiroControlPlaneBearerService.${operation}` },
    body: JSON.stringify(body),
  }, 12_000);
  if (!response.ok) throw kiroFailure(response.status, await readLimited(response, 16_384));
  try { return JSON.parse(await readLimited(response, 2_000_000)); } catch (error) {
    if (error instanceof KiroProblem) throw error;
    throw new KiroProblem('Kiro 模型目录不是有效 JSON。', 'INVALID_CATALOG');
  }
}

async function listSession(fetcher, auth, nextToken, signal) {
  const query = new URLSearchParams({ origin: 'KIRO_CLI', profileArn: auth.profileArn, ...(nextToken ? { nextToken } : {}) });
  const response = await request(fetcher, `${host('management', auth.region)}/List-Available-Models?${query}`, signal, {
    method: 'GET', headers: { ...bearerHeaders(auth), accept: 'application/json' },
  }, 12_000);
  if (!response.ok) throw kiroFailure(response.status, await readLimited(response, 16_384));
  try { return JSON.parse(await readLimited(response, 2_000_000)); } catch (error) {
    if (error instanceof KiroProblem) throw error;
    throw new KiroProblem('Kiro 模型目录不是有效 JSON。', 'INVALID_CATALOG');
  }
}

async function paginate(nextPage) {
  const pages = [];
  const seen = new Set();
  let nextToken;
  do {
    const page = await nextPage(nextToken);
    pages.push(page);
    nextToken = page?.nextToken;
    if (nextToken && (typeof nextToken !== 'string' || nextToken.length > 4096 || seen.has(nextToken) || pages.length >= 12)) throw new KiroProblem('Kiro 返回了无效的分页目录。', 'INVALID_CATALOG');
    seen.add(nextToken);
  } while (nextToken);
  return directModelCatalog(pages);
}

export const discoverDirect = (token, region, signal, fetcher = fetch) => paginate(nextToken => control(fetcher, apiKey(token), region, 'ListAvailableModels', { origin: 'KIRO_CLI', ...(nextToken ? { nextToken } : {}) }, signal));
export const discoverSession = (auth, signal, fetcher = fetch) => paginate(nextToken => listSession(fetcher, auth, nextToken, signal));

export async function openDirectStream({ token, region, wire, signal, fetcher = fetch, auth }) {
  const response = await request(fetcher, `${host('runtime', region)}/generateAssistantResponse`, signal, {
    headers: { ...(auth ? bearerHeaders(auth) : headers(apiKey(token))), 'content-type': 'application/json', accept: 'application/vnd.amazon.eventstream', 'x-amzn-codewhisperer-optout': 'true', 'x-amzn-kiro-agent-mode': 'vibe' },
    body: JSON.stringify(auth ? { ...wire, profileArn: auth.profileArn } : wire),
  }, 35_000, true);
  if (!response.ok) throw kiroFailure(response.status, await readLimited(response, 16_384));
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('application/vnd.amazon.eventstream')) {
    await response.body?.cancel();
    throw new KiroProblem('Kiro 没有返回 AWS 事件流。', 'INVALID_RESPONSE');
  }
  return response.body;
}
