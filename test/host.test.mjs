import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import * as plugin from '../lib/index.mjs';
import { parseRequest, readSettingsReply } from '../lib/remote.mjs';

const tempState = async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-kiro-host-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state.json');
};

const view = overrides => ({
  mode: 'direct', keyRef: 'KIRO_API_KEY', region: 'us-east-1', oauthConnected: false,
  models: [{ id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', enabled: true, efforts: ['low', 'max'], contextWindow: 200000, creditRate: 1.3 }],
  catalogAt: 1700000000000, catalogSource: 'disk',
  usage: { supported: true, plan: 'Kiro Pro', windows: [{ kind: 'plan', name: 'Credits', used: 10, limit: 100, percent: 10 }], at: 1700000000000 },
  modelDefaults: [{ id: 'claude-sonnet-5.5', effort: 'max' }],
  ...overrides,
});

test('target DSH core registers the independent provider and removes it on unload', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  await root.plugin(LlmRuntime);
  await root.plugin(ctx => { ctx.provide('credentials'); ctx.set('credentials', {
    readRecord: async () => undefined, describeRecord: async () => ({ configured: false }),
    modifyRecord: async () => assert.fail('missing credentials should not write'),
  }); });
  const installed = root.plugin(plugin, { statePath: await tempState(t) });
  await installed;
  assert.deepEqual(await root.llm.listProviders(), [{ id: 'kiro-native', name: 'Kiro Provider' }]);
  assert.equal(root.llm.providerRetryPolicy('kiro-native').maxRetries, 0);
  const service = root.get('kiroProvider');
  const result = await service.invoke({ op: 'status' });
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, 'oauth');
  assert.deepEqual(result.value.models, []);
  assert.equal(result.value.catalogSource, 'none');
  assert.equal(result.value.catalogAt, null);
  // The browser sees the RemoteResult envelope outside the Host result.
  const status = readSettingsReply({ ok: true, value: result }, 'status');
  assert.equal(status.keyRef, 'KIRO_API_KEY');
  assert.deepEqual(status.models, []);
  assert.deepEqual(status.modelDefaults, []);
  const refresh = await service.invoke({ op: 'refresh' });
  assert.throws(() => readSettingsReply({ ok: true, value: refresh }, 'refresh'), /浏览器登录/);
  await installed.dispose();
  assert.deepEqual(await root.llm.listProviders(), []);
  assert.equal(root.get('kiroProvider'), undefined);
});

test('settings responses validate the full view and distinguish connection checks', () => {
  const wrap = value => ({ ok: true, value: { ok: true, value } });
  assert.throws(() => readSettingsReply(wrap({ mode: 'direct', keyRef: 'KIRO_API_KEY', region: 'us-east-1', oauthConnected: false }), 'status'), /设置数据不完整/);
  assert.deepEqual(readSettingsReply(wrap(view()), 'status').models[0].creditRate, 1.3);
  assert.deepEqual(readSettingsReply(wrap(view()), 'refresh').usage.plan, 'Kiro Pro');
  assert.throws(() => readSettingsReply(wrap(view({ catalogSource: 'cloud' })), 'status'), /设置数据不完整/);
  assert.throws(() => readSettingsReply(wrap(view({ usage: { supported: 'yes' } })), 'status'), /设置数据不完整/);
  assert.throws(() => readSettingsReply(wrap(view({ modelDefaults: [{ id: 'm', effort: 'ultra' }] })), 'status'), /设置数据不完整/);
  assert.throws(() => readSettingsReply(wrap(view({ models: [{ id: 'm', name: 'M', enabled: true, creditRate: -1 }] })), 'status'), /设置数据不完整/);
  const detected = { mode: 'direct', cliVersion: null, modelCount: 2 };
  assert.deepEqual(readSettingsReply(wrap(detected), 'detect'), detected);
  assert.throws(() => readSettingsReply({ ok: false }, 'status'), /无法连接/);
});

test('request parsing covers usage and per-model settings within bounds', () => {
  assert.deepEqual(parseRequest({ op: 'usage' }), { op: 'usage' });
  assert.deepEqual(parseRequest({ op: 'modelSettings', id: 'claude-sonnet-5.5', effort: 'high', maxTokens: 4096 }),
    { op: 'modelSettings', id: 'claude-sonnet-5.5', effort: 'high', maxTokens: 4096 });
  assert.deepEqual(parseRequest({ op: 'modelSettings', id: 'm' }), { op: 'modelSettings', id: 'm', effort: '', maxTokens: 0 });
  assert.throws(() => parseRequest({ op: 'modelSettings', id: 'm', effort: 'ultra' }));
  assert.throws(() => parseRequest({ op: 'modelSettings', id: 'm', maxTokens: 2_000_000 }));
  assert.throws(() => parseRequest({ op: 'modelSettings', id: '--bad' }));
});

test('alpha.2 gateway configuration migrates to direct mode without contacting a loopback URL', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  await root.plugin(LlmRuntime);
  const before = globalThis.fetch;
  const seen = [];
  t.mock.method(globalThis, 'fetch', (...args) => { seen.push(args[0]); return before(...args); });
  await root.plugin(plugin, { mode: 'gateway', gatewayOrigin: 'http://127.0.0.1:3425', statePath: await tempState(t) });
  const service = root.get('kiroProvider');
  assert.equal((await service.invoke({ op: 'status' })).value.mode, 'direct');
  const refresh = await service.invoke({ op: 'refresh' });
  assert.equal(refresh.ok, false);
  assert.match(refresh.error.message, /API Key/);
  assert.deepEqual(seen, []);
});