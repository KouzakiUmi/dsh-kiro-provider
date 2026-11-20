import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { AcpConnection } from '../src/acp.mjs';
import { generate, promptOf } from '../src/adapter.mjs';
import { AGENT_ID, cliOptions, checkRuntimeHome, classifyCliFailure } from '../src/cli.mjs';
import { createController, parseCatalog } from '../src/controller.mjs';
import { parseRequest } from '../src/remote.mjs';

const msg = (text, role = 'user') => ({ role, content: [{type:'text', text}] });
const request = { messages: [msg('Hello')], model: 'auto' };
const collect = async iterable => { const rows = []; for await (const row of iterable) rows.push(row); return rows; };

test('catalog accepts observed field variants, does not invent missing facts', () => {
  const rows = parseCatalog(JSON.stringify({models:[{id:'auto', display_name:'Auto'},
    {model_id:'claude-sonnet-5', name:'Claude', context_window_tokens:1000000, reasoning_efforts:['low','max','unknown']},
    {id:'auto'}, {id:'--trust-all-tools'}]}));
  assert.deepEqual(rows, [{ id:'auto', name:'Auto', efforts:[] },
    { id:'claude-sonnet-5', name:'Claude', contextWindow:1000000, efforts:['low','max'] }]);
  assert.throws(() => parseCatalog('{shaped wrong'));
});

test('setup separates Kiro homes, filters host secrets, and rejects edited policies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kiro-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = { PATH:'example', OTHER_ACCESS_TOKEN:'not inherited', KIRO_API_KEY:'not inherited' };
  const local = await cliOptions(root, 'local', undefined, source);
  const managed = await cliOptions(root, 'managed', undefined, source);
  const key = await cliOptions(root, 'key', 'ksk_fixture_only', source);
  assert.equal(local.env.KIRO_HOME, undefined);
  assert.equal(local.env.KIRO_API_KEY, undefined);
  assert.notEqual(managed.env.KIRO_HOME, key.env.KIRO_HOME);
  assert.equal(key.env.KIRO_API_KEY, 'ksk_fixture_only');
  assert.equal(key.env.OTHER_ACCESS_TOKEN, undefined);
  assert.match(await readFile(join(key.env.KIRO_HOME,'settings','permissions.yaml'), 'utf8'), /effect: deny/);
  await mkdir(join(key.env.KIRO_HOME,'hooks'));
  await writeFile(join(key.env.KIRO_HOME,'hooks','item.json'), '{}');
  await assert.rejects(checkRuntimeHome(key.env), /Hooks/);
  await writeFile(join(key.env.KIRO_HOME,'settings','permissions.yaml'),'changed');
  await assert.rejects(cliOptions(root, 'key', 'ksk_fixture_only', source), /配置已更改/);
});

test('discovery caches a single account/mode and prevents settings from receiving keys', async () => {
  let current = { mode:'local', cliPath:'', keyRef:'KIRO_API_KEY', disabledModels:[] };
  let probes = 0;
  const c = createController({root:'/fixture', settings:()=>current, readKey: async () => 'ksk_fixture_only', deps: {
    resolve: async () => 'fake-binary', options: async (_root, _mode, key) => ({env: {KIRO_API_KEY:key}}), check:async()=>{}, version:async()=> '3.5.0',
    run: async (_exe, args, opt) => {
      assert.deepEqual(args, ['chat','--v3','--list-models','--format','json']);
      probes++;
      return {code:0,stdout:JSON.stringify([{id:opt.env.KIRO_API_KEY ? 'key-model':'local-model'}])};
    },
  }});
  const rows = await Promise.all([c.getModels(c.snapshot()), c.getModels(c.snapshot())]);
  assert.equal(probes,1);
  assert.equal(rows[0][0].id,'local-model');
  current = {...current, mode:'key'};
  assert.deepEqual(c.status(c.snapshot()).models, []);
  const result = await c.getModels(c.snapshot());
  assert.equal(result[0].id,'key-model');
  assert.doesNotMatch(JSON.stringify(c.status(c.snapshot())), /ksk_fixture_only/);
  c.dispose();
});

test('ACP model/mode confirmation and stream assembly, including replay and other sessions', async () => {
  let listener;
  let closed;
  const connect = () => ({
    async request(method, params) {
      if (method === 'initialize') return {protocolVersion:1,authMethods:[{id:'kiro'}]};
      if (method === 'session/new') {
        assert.equal(params._meta.kiro.modeId,AGENT_ID);
        return { sessionId:'fixture', modes:{currentModeId:AGENT_ID}, configOptions:[{id:'model',currentValue:'auto'}] };
      }
      assert.equal(method,'session/prompt');
      assert.match(params.prompt[0].text, /Hello/);
      const push = (id, sessionUpdate, text, replay) => listener({sessionId:id,update:{sessionUpdate,content:{type:'text',text},_meta:{kiro:{replay}}}});
      push('other','agent_message_chunk','foreign');
      push('fixture','agent_message_chunk','old',true);
      push('fixture','agent_thought_chunk','thinking');
      push('fixture','agent_message_chunk','你好');
      return {stopReason:'max_tokens'};
    }, subscribe(fn) { listener = fn; return () => { listener = undefined; }; }, async close(id) { closed = id; },
  });
  const chunks = await collect(generate({mode:'local',binary:'fake',process:{cwd:'/fixture'}},request,{connect}));
  assert.equal(closed,'fixture');
  assert.deepEqual(chunks.filter(x=>x.type==='block-end').map(x=>x.block.text), ['thinking','你好']);
  assert.deepEqual(chunks.at(-1), {type:'finish',reason:{kind:'max-tokens'}});
});

test('ACP never submits prompts if the restricted mode or model is unconfirmed', async () => {
  for (const missing of ['mode', 'model']) {
    let calls = [];
    const connect = () => ({ async request(method) {
      calls.push(method);
      if (method==='initialize') return {protocolVersion:1};
      return { sessionId:'fixture',modes:{currentModeId:missing==='mode'?'vibe':AGENT_ID},configOptions:[{id:'model',currentValue:missing==='model'?'other':'auto'}] };
    }, async close() { calls.push('close'); } });
    await assert.rejects(collect(generate({mode:'managed',binary:'fake',process:{cwd:'/fixture'}},request,{connect})), /请求未发送/);
    assert.deepEqual(calls,['initialize','session/new','close']);
  }
});

test('headless path sends prompt over stdin, without trust flags or secrets in arguments', async () => {
  const chunks = await collect(generate({mode:'key',binary:'fake',process:{env:{KIRO_API_KEY:'ksk_fixture_only'}}},request,{run:async (_bin,args,_opts,{input}) => {
    assert.ok(args.includes('--no-interactive'));
    assert.ok(!args.some(x=>x.includes('trust')||x.includes('ksk_')||x.includes('Hello')));
    assert.match(input,/Hello/);
    return {code:0,stdout:'\x1b[0mAnswer\r\n'};
  }}));
  assert.equal(chunks[2].block.text,'Answer');
});

test('JSON-RPC refuses ACP permission requests and stops on cancellation', async () => {
  const child = new EventEmitter();
  Object.assign(child,{exitCode:null,signalCode:null,stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.exitCode=0;queueMicrotask(()=>this.emit('close'));}});
  const written = [];
  child.stdin.on('data',chunk=>written.push(JSON.parse(chunk.toString())));
  const abort = new AbortController();
  const connection = new AcpConnection('fake', {}, {spawn: () => child, signal:abort.signal});
  const pending = connection.request('initialize');
  child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'s1',method:'session/request_permission',params:{options:[{kind:'allow_always',optionId:'a'},{kind:'reject_once',optionId:'r'}]}})+'\n');
  assert.deepEqual(written[1].result,{outcome:{outcome:'selected',optionId:'r'}});
  abort.abort();
  await assert.rejects(pending,/已取消/);
  await connection.close();
});

test('request parsing drops extraneous fields and text projection rejects images', () => {
  assert.deepEqual(parseRequest({op:'connection',mode:'key',keyRef:'KIRO_API_KEY',secret:'hidden'}), {op:'connection',mode:'key',keyRef:'KIRO_API_KEY'});
  assert.throws(()=>parseRequest({op:'connection',mode:'override',keyRef:'A'}));
  assert.deepEqual(parseRequest({op:'connection',mode:'local',keyRef:''}), {op:'connection',mode:'local',keyRef:'KIRO_API_KEY'});
  assert.throws(()=>promptOf({messages:[{role:'user',content:[{type:'image'}]}]}),/仅支持文本/);
  assert.match(promptOf({messages:[msg('a','assistant'),msg('b')]}),/"role":"assistant"/);
});

test('diagnostic classification does not disclose upstream strings', () => {
  const failure = classifyCliFailure('Authentication required, ksk_fixture_only');
  assert.equal(failure.code, 'AUTH');
  assert.doesNotMatch(failure.message, /ksk_/);
  assert.match(classifyCliFailure('This version of Kiro is no longer supported').message, /更新官方/);
});
