import assert from 'node:assert/strict';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import * as plugin from '../lib/index.mjs';
import { readSettingsReply } from '../lib/remote.mjs';

test('target DSH core registers the independent provider and removes it on unload', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  await root.plugin(LlmRuntime);
  await root.plugin(ctx => { ctx.provide('credentials'); ctx.set('credentials', {
    readRecord: async () => undefined, describeRecord: async () => ({ configured: false }),
    modifyRecord: async () => assert.fail('missing credentials should not write'),
  }); });
  const installed = root.plugin(plugin, {});
  await installed;
  assert.deepEqual(await root.llm.listProviders(), [{ id: 'kiro-native', name: 'Kiro Provider' }]);
  assert.equal(root.llm.providerRetryPolicy('kiro-native').maxRetries, 0);
  const service = root.get('kiroProvider');
  const result = await service.invoke({ op: 'status' });
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, 'oauth');
  assert.deepEqual(result.value.models, []);
  // The browser sees the RemoteResult envelope outside the Host result.
  const status = readSettingsReply({ ok: true, value: result }, 'status');
  assert.equal(status.keyRef, 'KIRO_API_KEY');
  assert.deepEqual(status.models, []);
  const refresh = await service.invoke({ op: 'refresh' });
  assert.throws(() => readSettingsReply({ ok: true, value: refresh }, 'refresh'), /浏览器登录/);
  await installed.dispose();
  assert.deepEqual(await root.llm.listProviders(), []);
  assert.equal(root.get('kiroProvider'), undefined);
});

test('settings responses reject missing models and distinguish connection checks', () => {
  const wrap = value => ({ ok: true, value: { ok: true, value } });
  const status = { mode: 'direct', keyRef: 'KIRO_API_KEY', region: 'us-east-1', oauthConnected: false };
  assert.throws(() => readSettingsReply(wrap(status), 'status'), /设置数据不完整/);
  const models = [{ id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', enabled: true }];
  assert.deepEqual(readSettingsReply(wrap({ ...status, models }), 'refresh').models, models);
  const detected = { mode: 'direct', cliVersion: null, modelCount: 2 };
  assert.deepEqual(readSettingsReply(wrap(detected), 'detect'), detected);
  assert.throws(() => readSettingsReply({ ok: false }, 'status'), /无法连接/);
});

test('alpha.2 gateway configuration migrates to direct mode without contacting a loopback URL', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  await root.plugin(LlmRuntime);
  const before = globalThis.fetch;
  const seen = [];
  t.mock.method(globalThis, 'fetch', (...args) => { seen.push(args[0]); return before(...args); });
  await root.plugin(plugin, { mode: 'gateway', gatewayOrigin: 'http://127.0.0.1:3425' });
  const service = root.get('kiroProvider');
  assert.equal((await service.invoke({ op: 'status' })).value.mode, 'direct');
  const refresh = await service.invoke({ op: 'refresh' });
  assert.equal(refresh.ok, false);
  assert.match(refresh.error.message, /API Key/);
  assert.deepEqual(seen, []);
});
