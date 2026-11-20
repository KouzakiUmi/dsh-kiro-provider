import assert from 'node:assert/strict';
import metadata from '../package.json' with { type: 'json' };
import { crc32 } from 'node:zlib';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm';
import { discoverDirect, discoverSession, directModelCatalog, openDirectStream, sessionCredential } from '../src/direct-http.mjs';
import { decodeFrames, messagesResponse } from '../src/direct-stream.mjs';
import { directWire, nameMap } from '../src/direct-wire.mjs';
import * as plugin from '../lib/index.mjs';

const token = 'ksk_fixture_not_real';
const model = 'claude-sonnet-5.5';
const tool = 'mcp__context7__query-docs';
const row = { modelId: model, tokenLimits: { maxInputTokens: 1_000_000, maxOutputTokens: 64_000 },
  supportedInputTypes: ['TEXT', 'IMAGE'], additionalModelRequestFieldsSchema: { properties: {
    thinking: { properties: { type: { enum: ['adaptive'] } } }, output_config: { properties: { effort: { enum: ['low', 'high', 'max'] } } },
  } } };

function awsFrame(kind, payload) {
  const field = (name, value) => Buffer.concat([Buffer.of(Buffer.byteLength(name)), Buffer.from(name), Buffer.of(7, 0, Buffer.byteLength(value)), Buffer.from(value)]);
  const headers = Buffer.concat([field(':message-type', 'event'), field(':event-type', kind)]);
  const json = Buffer.from(JSON.stringify(payload));
  const prelude = Buffer.alloc(12);
  prelude.writeUInt32BE(16 + headers.length + json.length, 0);
  prelude.writeUInt32BE(headers.length, 4);
  prelude.writeUInt32BE(crc32(prelude.subarray(0, 8)), 8);
  const unsigned = Buffer.concat([prelude, headers, json]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(unsigned));
  return Buffer.concat([unsigned, crc]);
}

const describeFrames = (...frames) => new Response(new ReadableStream({ start(c) {
  for (const f of frames) { c.enqueue(f.subarray(0, 7)); c.enqueue(f.subarray(7)); } c.close();
} }), { headers: { 'content-type': 'application/vnd.amazon.eventstream' } });

test('direct catalog is limited to named Kiro hosts and paginates without exposing keys', async () => {
  const requests = [];
  const found = await discoverDirect(token, 'eu-central-1', undefined, async (url, init) => {
    assert.equal(url, 'https://management.eu-central-1.kiro.dev/?origin=KIRO_CLI');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'error');
    const data = JSON.parse(init.body); requests.push(data.nextToken);
    return Response.json(data.nextToken ? { models: [row] } : { nextToken: 'next' });
  });
  assert.deepEqual(requests, [undefined, 'next']);
  assert.deepEqual(found[0].efforts, ['low', 'high', 'max']);
  assert.deepEqual(found[0].inputModalities, ['text', 'image']);
  assert.doesNotMatch(JSON.stringify(found), /ksk_/);
  await assert.rejects(discoverDirect(token, 'wrong-region'), { code: 'INVALID_CONFIG' });
  assert.throws(() => directModelCatalog([{ models: [{ ...row, tokenLimits: {} }] }]), { code: 'INVALID_CATALOG' });
});

test('client rejection stops without trying another identity', async () => {
  let attempts = 0;
  await assert.rejects(openDirectStream({ token, region: 'us-east-1', wire: {}, fetcher: async (_url, init) => {
    assert.equal(init.headers['user-agent'], `${metadata.name}/${metadata.version}`); ++attempts;
    return Response.json({ message: 'This version of Kiro is no longer supported' }, { status: 403 });
  } }), { code: 'CLIENT_UPGRADE_REQUIRED' });
  assert.equal(attempts, 1);
});

test('session discovery binds an unexpired token to the profile region', async () => {
  const session = { accessToken: 'fixture-sso-token', expiresAt: Date.now() + 60_000, method: 'sso',
    profileArn: 'arn:aws:codewhisperer:eu-central-1:012345678901:profile/fixture' };
  const auth = sessionCredential(JSON.stringify(session));
  assert.throws(() => sessionCredential(JSON.stringify({ ...session, expiresAt: Date.now() })), { code: 'AUTH' });
  assert.throws(() => sessionCredential(JSON.stringify({ ...session, profileArn: 'https://example.invalid' })), { code: 'INVALID_CREDENTIAL' });
  const catalog = await discoverSession(auth, undefined, async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://management.eu-central-1.kiro.dev');
    assert.equal(target.pathname, '/List-Available-Models');
    assert.equal(target.searchParams.get('profileArn'), session.profileArn);
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.tokentype, 'SSO_OIDC');
    return Response.json({ models: [row] });
  });
  assert.ok(catalog.some(x => x.id === model));
});

test('known upstream limits and effort fields are included without inventing limits', () => {
  const m = { ...row, additionalModelRequestFieldsSchema: { properties: { ...row.additionalModelRequestFieldsSchema.properties, max_tokens: { type: 'integer', minimum: 8, maximum: 1024 } } } };
  const [known] = directModelCatalog([{ models: [m] }]);
  const request = { model, messages: [{ role: 'user', content: 'test' }] };
  const { wire } = directWire(request, known, { effort: 'low', maxTokens: 12 });
  assert.deepEqual(wire.additionalModelRequestFields, { thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, max_tokens: 12 });
  assert.throws(() => directWire(request, known, { maxTokens: 4 }), { code: 'INVALID_REQUEST' });
  assert.throws(() => directWire(request, { ...known, maxTokenRange: undefined }, { maxTokens: 12 }), { code: 'UNSUPPORTED_OPTION' });
});

test('split AWS frames validate their checksums and reject truncation', async () => {
  const original = awsFrame('assistantResponseEvent', { content: 'hello' });
  for await (const frame of decodeFrames(describeFrames(original).body)) assert.equal(frame.value.content, 'hello');
  for (const breakage of [original.subarray(0, -1), Buffer.from(original).fill(255, original.length - 2)]) {
    await assert.rejects(async () => { for await (const _ of decodeFrames(describeFrames(breakage).body)) { /* consume */ } }, { code: 'MALFORMED_RESPONSE' });
  }
});

test('wire tool aliases handle hyphens, length, collisions and invalid starts', () => {
  const long = `mcp__${'x'.repeat(100)}`;
  const first = nameMap([tool, long, '9name'], []);
  assert.equal(first.reverse.get(first.toWire(tool)), tool);
  assert.notEqual(first.toWire(tool), tool);
  assert.match(first.toWire(long), /^[A-Za-z][A-Za-z0-9_]{0,63}$/);
  const occupied = first.toWire(tool);
  assert.notEqual(nameMap([tool, occupied], []).toWire(tool), occupied);
});

test('binary transport fails instead of making an unknown tool callable', async () => {
  const upstream = describeFrames(awsFrame('toolUseEvent', { toolUseId: 'toolu_demo', name: 'unexpected', input: {} }));
  const reply = messagesResponse(upstream.body, { id: model }, new Map());
  await assert.rejects(reply.text(), { code: 'INVALID_RESPONSE' });
});

test('cancelling the Messages response aborts the underlying binary fetch signal', async () => {
  const upstream = new AbortController();
  const body = new ReadableStream({ start(c) { upstream.signal.addEventListener('abort', () => c.error(upstream.signal.reason), { once: true }); } });
  const reply = messagesResponse(body, { id: model }, new Map(), { signal: upstream.signal, cancel: () => upstream.abort() });
  const reader = reply.body.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  assert.equal(upstream.signal.aborted, true);
});

test('DSH sends only to Kiro and completes native binary tool-result replay', async t => {
  const root = new Context();
  t.after(() => root.fiber.dispose());
  await root.plugin(LlmRuntime);
  await root.plugin(ctx => { ctx.provide('credentials'); ctx.set('credentials', { resolve: async () => ({ value: token }) }); });
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(typeof url, 'string');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    const body = JSON.parse(init.body);
    if (url === 'https://management.us-east-1.kiro.dev/?origin=KIRO_CLI') return Response.json({ models: [row] });
    assert.equal(url, 'https://runtime.us-east-1.kiro.dev/generateAssistantResponse');
    bodies.push(body);
    const context = body.conversationState.currentMessage.userInputMessage.userInputMessageContext;
    const wireName = context.tools[0].toolSpecification.name;
    assert.match(wireName, /^[A-Za-z][A-Za-z0-9_]{0,63}$/);
    return bodies.length === 1 ? describeFrames(
      awsFrame('toolUseEvent', { toolUseId: 'toolu_demo', name: wireName, input: '{"query":' }),
      awsFrame('toolUseEvent', { input: '"alpha"}', stop: true }),
    ) : describeFrames(awsFrame('assistantResponseEvent', { content: 'KIRO_DSH_TOOL_OK' }));
  });
  await root.plugin(plugin, { mode: 'direct' });
  const provider = 'kiro-native';
  const initial = { role: 'user', content: [{ type: 'text', text: 'Test lookup' }] };
  const tools = [{ name: tool, description: 'Test lookup', parameters: { type: 'object' } }];
  async function turn(messages) {
    const events = [];
    for await (const c of root.llm.stream({ provider, model, messages, tools, signal: AbortSignal.timeout(5000) })) events.push(c);
    return { content: events.filter(c => c.type === 'block-end').map(c => c.block), finish: events.at(-1) };
  }
  const a = await turn([initial]);
  assert.equal(a.finish?.reason?.kind, 'tool-calls', JSON.stringify(a.finish));
  const call = a.content.find(c => c.type === 'tool-call');
  assert.equal(call?.name, tool);
  assert.deepEqual(JSON.parse(call.arguments), { query: 'alpha' });
  const prior = createAssistantMessage({ content: a.content, source: { provider, model, replayState: a.finish.replayState } });
  const result = createToolResultMessage({ callId: call.id, content: [{ type: 'text', text: 'KIRO_DSH_TOOL_OK' }], isError: false });
  const b = await turn([initial, prior, result]);
  assert.equal(b.finish?.reason?.kind, 'stop');
  assert.equal(b.content[0]?.text, 'KIRO_DSH_TOOL_OK');
  const state = bodies[1].conversationState;
  assert.equal(state.history.at(-1).assistantResponseMessage.toolUses[0].toolUseId, state.currentMessage.userInputMessage.userInputMessageContext.toolResults[0].toolUseId);
});
