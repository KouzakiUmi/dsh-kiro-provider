import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { createOAuth } from '../lib/oauth.mjs';
import { oauthGrants } from '../lib/oauth-grant.mjs';
import { organizationInput, readSettingsReply } from '../lib/remote.mjs';
import * as plugin from '../lib/index.mjs';

const profileArn = 'arn:aws:codewhisperer:eu-central-1:012345678901:profile/example';
const fakeToken = { accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token', expiresIn: 1200 };
const sha = value => createHash('sha256').update(value).digest('base64url');

function localCallback(authorize, path, params = {}) {
  const url = new URL(authorize.searchParams.get('redirect_uri'));
  url.hostname = '127.0.0.1';
  if (path) url.pathname = path;
  url.search = new URLSearchParams({ state: authorize.searchParams.get('state'), ...params });
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
}

test('the Kiro login page uses fresh PKCE; wrong state does not consume the attempt', async t => {
  let grant, exchanged;
  const oauth = createOAuth({ portalPorts: [0], save: value => { grant = value; }, fetcher: async (url, init) => {
    exchanged = JSON.parse(init.body);
    assert.equal(url, 'https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token');
    return Response.json({ ...fakeToken, profileArn });
  } });
  t.after(oauth.dispose);
  const start = await oauth.start({ method: 'portal' });
  const authorize = new URL(start.url);
  assert.equal(authorize.origin, 'https://app.kiro.dev');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  const incorrect = await localCallback(authorize, '/signin/callback', { login_option: 'github', code: 'fixture', state: 'wrong' });
  assert.equal(incorrect.status, 404); await incorrect.text();
  assert.deepEqual(oauth.status(), { phase: 'waiting' });
  const verified = await localCallback(authorize, '/signin/callback', { login_option: 'github', code: 'fixture' });
  assert.equal(verified.status, 200); await verified.text();
  assert.equal(sha(exchanged.code_verifier), authorize.searchParams.get('code_challenge'));
  assert.equal(oauth.status().phase, 'succeeded');
  assert.equal(grant.profileArn, profileArn);
  assert.equal(grant.method, 'social');
  assert.doesNotMatch(JSON.stringify(oauth.status()), /token|verifier|https/);
});

for (const method of ['builder', 'organization']) test(`${method} registers the DSH client and exchanges an AWS PKCE callback`, async t => {
  let grant, authorize;
  const awsRegion = method === 'organization' ? 'eu-west-1' : 'us-east-1';
  const calls = [];
  const oauth = createOAuth({ save: value => { grant = value; }, fetcher: async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    assert.equal(init.redirect, 'error');
    if (url === `https://oidc.${awsRegion}.amazonaws.com/client/register`) {
      assert.equal(body.clientName, 'DeepSeek Harness Kiro Provider');
      assert.equal(body.issuerUrl, method === 'builder' ? 'https://view.awsapps.com/start' : 'https://example.awsapps.com/start');
      return Response.json({ clientId: 'fixture-id', clientSecret: 'fixture-secret' });
    }
    if (url === `https://oidc.${awsRegion}.amazonaws.com/token`) {
      assert.equal(sha(body.codeVerifier), authorize.searchParams.get('code_challenge'));
      return Response.json(fakeToken);
    }
    assert.equal(url, 'https://management.eu-central-1.kiro.dev/List-Available-Profiles');
    return Response.json({ profiles: [{ arn: profileArn }] });
  } });
  t.after(oauth.dispose);
  await assert.rejects(oauth.start({ method: 'organization', startUrl: 'https://example.net/start', awsRegion }), /Start URL/);
  const start = await oauth.start({ method, startUrl: 'https://example.awsapps.com/start', awsRegion });
  authorize = new URL(start.url);
  assert.equal(authorize.hostname, `oidc.${awsRegion}.amazonaws.com`);
  const result = await localCallback(authorize, undefined, { code: 'fixture' });
  assert.equal(result.status, 200); await result.text();
  assert.equal(grant.method, 'sso');
  assert.equal(grant.awsRegion, awsRegion);
  if (method === 'organization') assert.equal(grant.profileArn, profileArn);
  assert.equal(calls.length, method === 'organization' ? 3 : 2);
});

test('cancelling closes the temporary listener and drops the authorization URL', async t => {
  const oauth = createOAuth({ portalPorts: [0], save: () => assert.fail('not authorized') });
  t.after(oauth.dispose);
  const started = await oauth.start({ method: 'portal' });
  assert.equal(oauth.cancel().phase, 'cancelled');
  assert.equal(oauth.status().url, undefined);
  await assert.rejects(localCallback(new URL(started.url), '/signin/callback', { code: 'fixture' }));
});

test('portal Builder ID uses a second state and rejects replay of the portal proof', async t => {
  let grant;
  const oauth = createOAuth({ portalPorts: [0], save: value => { grant = value; }, fetcher: async url => {
    if (url.endsWith('/client/register')) return Response.json({ clientId: 'fixture-id', clientSecret: 'fixture-secret' });
    assert.equal(url, 'https://oidc.us-east-1.amazonaws.com/token');
    return Response.json(fakeToken);
  } });
  t.after(oauth.dispose);
  const portal = new URL((await oauth.start({ method: 'portal' })).url);
  const first = await localCallback(portal, '/signin/callback', { login_option: 'builderid' });
  assert.equal(first.status, 302);
  const aws = new URL(first.headers.get('location')); await first.text();
  assert.notEqual(aws.searchParams.get('state'), portal.searchParams.get('state'));
  const replay = await localCallback(portal, '/signin/callback', { login_option: 'builderid' });
  assert.equal(replay.status, 404); await replay.text();
  const done = await localCallback(aws, undefined, { code: 'fixture' });
  assert.equal(done.status, 200); await done.text();
  assert.equal(grant.method, 'sso');
});

test('DSH credential lock serializes concurrent OAuth refresh and stores the rotated grant', async () => {
  let value, lock = Promise.resolve(), renewed = 0;
  const service = {
    readRecord: async () => value,
    describeRecord: async () => ({ kind: value?.kind }),
    deleteRecord: async () => { value = undefined; },
    modifyRecord(key, fn) {
      assert.equal(key, 'dsh-kiro-provider/oauth');
      const next = lock.then(async () => { value = await fn(value) ?? value; return value; });
      lock = next.catch(() => {}); return next;
    },
  };
  const grants = oauthGrants(() => service, async old => { renewed++; return { ...old, accessToken: 'fixture-new-access', expiresAt: Date.now() + 60_000 }; });
  assert.equal(await grants.connected(), false);
  await grants.save({ version: 1, method: 'social', ...fakeToken, expiresAt: Date.now() - 200, profileArn });
  const auth = await Promise.all([grants.auth(), grants.auth()]);
  assert.equal(renewed, 1);
  assert.ok(auth.every(x => x.token === 'fixture-new-access' && x.region === 'eu-central-1'));
  await grants.forget();
  assert.equal(await grants.connected(), false);
});

test('settings and Host share validation of organization login inputs', () => {
  assert.deepEqual(organizationInput(' https://example.awsapps.com/start ', ' eu-west-1 '), { startUrl: 'https://example.awsapps.com/start', awsRegion: 'eu-west-1' });
  for (const url of ['https://example.com/start', 'https://example.awsapps.com/profile', 'https://example.awsapps.com.evil.example/start', 'http://example.awsapps.com/start']) {
    assert.match(organizationInput(url, 'us-east-1').error, /Start URL/);
  }
  assert.match(organizationInput('https://example.awsapps.com/start', 'us-gov-west-1').error, /Region/);
});

test('login RPC only accepts Kiro or AWS authorization URLs', () => {
  const reply = value => ({ ok: true, value: { ok: true, value } });
  assert.throws(() => readSettingsReply(reply({ phase: 'waiting', url: 'https://app.kiro.dev.evil.example/signin' }), 'loginStart'));
  assert.deepEqual(readSettingsReply(reply({ phase: 'waiting', url: 'https://app.kiro.dev/signin' }), 'loginStart'), { phase: 'waiting', url: 'https://app.kiro.dev/signin' });
  assert.deepEqual(readSettingsReply(reply({ phase: 'waiting', url: 'https://app.kiro.dev/signin' }), 'loginStatus'), { phase: 'waiting' });
});

test('DSH settings login binds the grant, loads the Kiro catalog, and disconnects', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  let record;
  const network = globalThis.fetch;
  const upstream = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return network(input, init);
    upstream.push(url.host);
    if (url.pathname === '/client/register') return Response.json({ clientId: 'fixture-id', clientSecret: 'fixture-secret' });
    if (url.pathname === '/token') return Response.json(fakeToken);
    assert.equal(url.pathname, '/List-Available-Models');
    assert.equal(init.headers.authorization, `Bearer ${fakeToken.accessToken}`);
    return Response.json({ models: [{ modelId: 'claude-sonnet-5.5', tokenLimits: { maxInputTokens: 200000, maxOutputTokens: 64000 } }] });
  });
  await root.plugin(LlmRuntime);
  await root.plugin(ctx => { ctx.provide('credentials'); ctx.set('credentials', {
    readRecord: async () => record,
    describeRecord: async () => ({ configured: !!record, kind: record?.kind, writable: true }),
    modifyRecord: async (_key, mutate) => { record = await mutate(record) ?? record; return record; },
    deleteRecord: async () => { record = undefined; },
  }); });
  await root.plugin(plugin, {});
  const remote = root.get('kiroProvider');
  const invoke = async request => readSettingsReply({ ok: true, value: await remote.invoke(request) }, request.op);
  assert.equal((await invoke({ op: 'status' })).oauthConnected, false);
  const start = await invoke({ op: 'loginStart', method: 'builder' });
  const callback = await localCallback(new URL(start.url), undefined, { code: 'example' });
  assert.equal(callback.status, 200); await callback.text();
  assert.equal((await invoke({ op: 'loginStatus' })).phase, 'succeeded');
  const refreshed = await invoke({ op: 'refresh' });
  assert.equal(refreshed.oauthConnected, true);
  assert.equal(refreshed.models[0].id, 'claude-sonnet-5.5');
  assert.doesNotMatch(JSON.stringify(refreshed), /fixture-access|fixture-secret/);
  assert.deepEqual(upstream, ['oidc.us-east-1.amazonaws.com', 'oidc.us-east-1.amazonaws.com', 'management.us-east-1.kiro.dev']);
  await invoke({ op: 'logout' });
  assert.equal((await invoke({ op: 'status' })).oauthConnected, false);
  assert.equal((await invoke({ op: 'loginStatus' })).phase, 'idle');
  assert.deepEqual(await root.llm.listModels('kiro-native'), []);
});
