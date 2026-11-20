import { createHash, randomBytes } from 'node:crypto';
import { KiroProblem } from './cli.mjs';
import { CLIENT, regions, sessionCredential } from './direct-http.mjs';
import { organizationInput } from './remote.mjs';

const PORTAL = 'https://app.kiro.dev/signin';
const AUTH = 'https://prod.us-east-1.auth.desktop.kiro.dev';
const builderStart = 'https://view.awsapps.com/start';
// Builder ID subscriptions share this Kiro service profile. Organization profiles are discovered per login.
const builderProfile = 'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX';
const scopes = ['completions', 'analysis', 'conversations', 'transformations', 'taskassist'].map(scope => `codewhisperer:${scope}`);
const validAwsRegion = /^([a-z]{2})-(?!gov-|iso[a-z]?-)[a-z]+(?:-[a-z]+)*-[1-9]\d?$/;
const secret = v => typeof v === 'string' && /^[\x21-\x7e]{1,24576}$/.test(v);
const authProblem = message => new KiroProblem(message, 'AUTH');

export function makePkce() {
  const verifier = randomBytes(48).toString('base64url');
  return { state: randomBytes(32).toString('base64url'), verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function portalUrl(redirect, proof) {
  const url = new URL(PORTAL);
  url.search = new URLSearchParams({ state: proof.state, code_challenge: proof.challenge, code_challenge_method: 'S256', redirect_uri: redirect, redirect_from: 'KiroIDE' });
  return url.href;
}

export function organizationIssuer(value, region) {
  const parsed = organizationInput(value, region);
  if (parsed.error) throw authProblem(parsed.error);
  return parsed.startUrl;
}

function oidc(region) {
  if (!validAwsRegion.test(region ?? '') || /^(cn|us-iso|eusc)-/.test(region)) throw authProblem('AWS 登录区域无效。');
  return `https://oidc.${region}.amazonaws.com`;
}

export async function oauthJson(fetcher, url, signal, body, extra = {}) {
  const deadline = AbortSignal.timeout(20_000);
  try {
    const res = await fetcher(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { accept: 'application/json', 'user-agent': CLIENT, ...extra, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) { await res.body?.cancel(); throw authProblem(`Kiro 或 AWS 拒绝了登录请求（HTTP ${res.status}）。`); }
    const chunks = []; let bytes = 0;
    for await (const chunk of res.body ?? []) {
      bytes += chunk.length;
      if (bytes > 512_000) throw authProblem('登录服务返回的数据超过大小限制。');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof KiroProblem) throw error;
    throw authProblem(deadline.aborted ? '等待登录服务超时，请重试。' : '无法读取登录服务的响应。');
  }
}

export async function beginAws({ method, startUrl, region, redirect, proof, fetcher, signal }) {
  const issuerUrl = method === 'builder' ? builderStart : organizationIssuer(startUrl, region);
  const root = oidc(region);
  const registration = await oauthJson(fetcher, `${root}/client/register`, signal, {
    clientName: 'DeepSeek Harness Kiro Provider', clientType: 'public', scopes, issuerUrl,
    grantTypes: ['authorization_code', 'refresh_token'], redirectUris: ['http://127.0.0.1/oauth/callback'],
  });
  if (!secret(registration?.clientId) || !secret(registration?.clientSecret)) throw authProblem('AWS 没有返回可用的登录客户端。');
  const aws = { clientId: registration.clientId, clientSecret: registration.clientSecret, awsRegion: region };
  const authorize = new URL(`${root}/authorize`);
  authorize.search = new URLSearchParams({ response_type: 'code', client_id: aws.clientId, redirect_uri: redirect, scopes: scopes.join(','),
    state: proof.state, code_challenge: proof.challenge, code_challenge_method: 'S256' });
  return { aws, url: authorize.href };
}

async function findOrganizationProfile(accessToken, awsRegion, fetcher, signal) {
  const preferred = awsRegion.startsWith('eu-') ? [...regions].reverse() : regions;
  let failure;
  for (const region of preferred) {
    try {
      const result = await oauthJson(fetcher, `https://management.${region}.kiro.dev/List-Available-Profiles`, signal, {}, { authorization: `Bearer ${accessToken}` });
      const match = Array.isArray(result?.profiles) && result.profiles.find(p => typeof p?.arn === 'string' && p.arn.startsWith(`arn:aws:codewhisperer:${region}:`));
      if (match) return match.arn;
    } catch (error) { if (signal?.aborted) signal.throwIfAborted(); failure = error; }
  }
  throw failure ?? authProblem('此组织账号没有可用的 Kiro Profile。');
}

function grantFrom(token, base) {
  if (!secret(token?.accessToken) || (!secret(token.refreshToken) && !secret(base.refreshToken))) throw authProblem('登录服务没有返回完整的 Kiro 凭据。');
  if (token.expiresIn !== undefined && (!Number.isFinite(token.expiresIn) || token.expiresIn <= 15)) throw authProblem('登录服务返回的凭据已过期，请重新登录。');
  const expiresIn = Math.min(token.expiresIn ?? 3600, 86400);
  const grant = { ...base, accessToken: token.accessToken, refreshToken: secret(token.refreshToken) ? token.refreshToken : base.refreshToken,
    expiresAt: Date.now() + Math.trunc(expiresIn * 1000), profileArn: token.profileArn ?? base.profileArn };
  validateGrantSession(grant);
  return grant;
}

export function validateGrantSession({ accessToken, profileArn, expiresAt, method }) {
  return sessionCredential(JSON.stringify({ accessToken, profileArn, expiresAt, method }));
}

export async function finishAws({ method, aws, code, redirect, proof, fetcher, signal }) {
  const { clientId, clientSecret, awsRegion } = aws;
  const token = await oauthJson(fetcher, `${oidc(awsRegion)}/token`, signal, {
    clientId, clientSecret, grantType: 'authorization_code', code, redirectUri: redirect, codeVerifier: proof.verifier,
  });
  if (!secret(token?.accessToken)) throw authProblem('AWS 没有返回 Kiro 访问令牌。');
  const profileArn = method === 'builder' ? builderProfile : await findOrganizationProfile(token.accessToken, awsRegion, fetcher, signal);
  return grantFrom(token, { version: 1, method: 'sso', profileArn, ...aws });
}

export async function finishSocial({ code, choice, callbackPath, redirect, proof, fetcher, signal }) {
  const token = await oauthJson(fetcher, `${AUTH}/oauth/token`, signal, { code, code_verifier: proof.verifier,
    redirect_uri: `${redirect}${callbackPath}?login_option=${choice}` });
  if (!secret(token?.accessToken)) throw authProblem('Kiro 没有返回可用的访问令牌。');
  const profileArn = token.profileArn || await findOrganizationProfile(token.accessToken, 'us-east-1', fetcher, signal);
  return grantFrom({ ...token, profileArn }, { version: 1, method: 'social' });
}

export async function refreshGrant(grant, { fetcher = fetch, signal } = {}) {
  if (grant?.version !== 1 || !secret(grant.refreshToken)) throw authProblem('Kiro 登录已失效，请重新登录。');
  if (grant.method === 'social') return grantFrom(await oauthJson(fetcher, `${AUTH}/refreshToken`, signal, { refreshToken: grant.refreshToken }), grant);
  if (grant.method !== 'sso' || !secret(grant.clientId) || !secret(grant.clientSecret)) throw authProblem('Kiro 登录已失效，请重新登录。');
  const { awsRegion, clientId, clientSecret, refreshToken } = grant;
  const token = await oauthJson(fetcher, `${oidc(awsRegion)}/token`, signal, { clientId, clientSecret, refreshToken, grantType: 'refresh_token' });
  return grantFrom(token, grant);
}
