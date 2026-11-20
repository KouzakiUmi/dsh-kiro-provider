import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { LlmAdapter, LlmError, ReasoningEffortId, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createController, directMode, ROUTE, safeProblem } from './controller.mjs';
import { KiroProblem } from './cli.mjs';
import { generate } from './adapter.mjs';
import { kiroRemote, parseRequest, pluginId } from './remote.mjs';
import { directFetch, directProfile } from './direct.mjs';
import { createOAuth } from './oauth.mjs';
import { oauthGrants } from './oauth-grant.mjs';

export const name = pluginId;
export const inject = ['llm'];
export const Config = z.object({
  mode: z.union(['oauth', 'direct', 'session', 'local', 'managed', 'key', 'gateway']).default('oauth').volatile(),
  region: z.union(['us-east-1', 'eu-central-1']).default('us-east-1').volatile(),
  cliPath: z.string().default('').volatile(),
  keyRef: z.string().default('KIRO_API_KEY').volatile(),
  disabledModels: z.array(z.string()).default([]).volatile(),
});

function modelInfo(row) {
  return { provider: ROUTE, id: row.id, name: row.name, inputModalities: row.inputModalities ?? ['text'],
    ...(row.contextWindow ? { context: { contextWindow: row.contextWindow } } : {}),
    ...(row.efforts.length ? { reasoning: { efforts: row.efforts.map(id => ({ id: ReasoningEffortId(id), name: id })) } } : {}) };
}

function adapterFor(controller, ctx) {
  const retryPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, ROUTE);
  const sdk = anthropicMessagesApi();
  const credentials = new InMemoryCredentialStore();
  function nativeAdapter(s, row, tuning, onFailure) {
    const profile = directProfile(row, ROUTE, retryPolicy);
    const fetch = directFetch({ row, tuning, onFailure, credential: async signal => {
      if (s.mode === 'direct') return { region: s.region, token: await controller.keyFor(s) };
      const auth = await controller.sessionFor(s, signal);
      return { region: auth.region, auth };
    } });
    // The Messages SDK only talks to the in-memory transport; the real key never enters its model or headers.
    const sdkKey = 'dsh-kiro-internal';
    profile.piProvider = {
      id: ROUTE, name: profile.displayName, baseUrl: profile.baseURL,
      auth: { apiKey: { name: 'KIRO_DIRECT_TRANSPORT', resolve: async () => ({ auth: { apiKey: sdkKey }, source: 'kiro-direct' }) } },
      getModels: () => profile.models,
      stream: (model, context, options) => sdk.stream(model, context, { ...options, maxRetries: 0, fetch }),
      streamSimple: (model, context, options) => sdk.streamSimple(model, context, { ...options, maxRetries: 0, fetch }),
    };
    const profiles = new Map([[ROUTE, profile]]);
    return new PiAiAdapter({ profiles: () => profiles,
      auth: { credentials, authContext: { env: async () => undefined, fileExists: async () => false } },
      resolveApiKey: async () => sdkKey,
      resolveAttachments: () => ctx.get('attachments', false),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, path => ctx.get('fs', false)?.processPathFromHostPath(path), ref),
    });
  }
  async function* dispatchDirect(s, row, options) {
    const signal = controller.signalFor(options.signal);
    if (options.temperature !== undefined) throw new LlmError('Kiro 直连不支持 temperature 参数。', 'UNSUPPORTED_OPTION');
    let failure;
    const adapter = nativeAdapter(s, row, { effort: options.reasoningEffort, maxTokens: options.maxTokens }, error => { failure = error; });
    for await (const chunk of adapter.stream({ ...options, signal })) {
      if (failure && !signal.aborted && chunk.type === 'finish' && chunk.reason.kind === 'error') {
        yield { ...chunk, reason: { kind: 'error', failure: { code: failure.code, message: failure.message } } };
      } else yield chunk;
    }
  }
  async function exact(s, id, signal) {
    if (s.disabledModels.includes(id)) throw new LlmError('该 Kiro 模型已关闭。', 'MODEL_UNSUPPORTED');
    const row = (await controller.getModels(s, { signal })).find(row => row.id === id);
    if (!row) throw new LlmError('该 Kiro 账号未发布所选模型。', 'UNKNOWN_MODEL');
    return row;
  }
  async function* dispatch(s, row, opts) {
    const signal = controller.signalFor(opts.signal);
    if (opts.reasoningEffort && !row.reasoning?.efforts.some(e => e.id === opts.reasoningEffort)) {
      throw new LlmError('所选 Kiro 模型未发布此思考档位。', 'INVALID_REQUEST');
    }
    try {
      const target = await controller.target(s, signal);
      yield* generate(target, { ...opts, signal });
    } catch (error) {
      if (signal.aborted) throw new LlmError('Kiro 请求已取消。', 'ABORTED');
      if (error instanceof KiroProblem) throw new LlmError(error.message, error.code);
      throw new LlmError(safeProblem(error), 'TRANSPORT');
    }
  }
  return new class extends LlmAdapter {
    providerInfo() { return { id: ROUTE, name: 'Kiro Provider' }; }
    providerRetryPolicy() { return retryPolicy; }
    async listModels() {
      const s = controller.snapshot();
      try { return (await controller.getModels(s)).filter(row => !s.disabledModels.includes(row.id)).map(modelInfo); }
      catch { return []; }
    }
    async resolveModel(provider, id, signal) {
      const s = controller.snapshot();
      const row = await exact(s, id, signal);
      return directMode(s.mode) ? nativeAdapter(s, row).resolveModel(provider, id, signal) : modelInfo(row);
    }
    imageRequestPricing(provider, id) {
      const s = controller.snapshot();
      const row = directMode(s.mode) && controller.status(s).models.find(row => row.id === id && row.enabled);
      return row ? nativeAdapter(s, row).imageRequestPricing(provider, id) : undefined;
    }
    imageRequestTarget(provider, id, image) {
      const s = controller.snapshot();
      const row = directMode(s.mode) && controller.status(s).models.find(row => row.id === id && row.enabled);
      return row ? nativeAdapter(s, row).imageRequestTarget(provider, id, image) : super.imageRequestTarget(provider, id, image);
    }
    async prepareCall(_provider, id, signal) {
      const s = controller.snapshot();
      const row = await exact(s, id, signal);
      if (directMode(s.mode)) {
        const model = await nativeAdapter(s, row).resolveModel(ROUTE, id, signal);
        return { model, stream: options => dispatchDirect(s, row, options) };
      }
      const model = modelInfo(row);
      return { model, stream: options => dispatch(s, model, options) };
    }
    async *stream(options) { yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options); }
  }();
}

export function apply(ctx, config) {
  const entry = ctx.fiber.entry;
  const root = dshHomePath('storages', name);
  const grants = oauthGrants(() => ctx.get('credentials'));
  const controller = createController({ root,
    settings: () => ({ mode: config.mode.get(), region: config.region.get(), cliPath: config.cliPath.get(), keyRef: config.keyRef.get(), disabledModels: config.disabledModels.get() }),
    readKey: async ref => (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value,
    readOAuth: grants.auth,
  });
  ctx.effect(() => ctx.llm.registerAdapter([ROUTE], adapterFor(controller, ctx)));
  ctx.effect(() => ctx.llm.registerConfigurableProviders([{ provider: ROUTE, displayName: 'Kiro Provider', settingsNs: name, settingsPath: [] }]));
  ctx.on('dispose', controller.dispose);
  ctx.on('credentials/reference-updated', controller.reset);

  async function edit(update) {
    const editor = ctx.get('configEditor');
    if (!entry || !editor) throw new KiroProblem('此 Profile 无法保存插件设置。');
    await editor.edit(entry, update);
  }

  function modelsChanged() { controller.reset(); ctx.emit('llm/adapters-updated'); }

  const oauth = createOAuth({ async save(grant, signal) {
    if (controller.snapshot().mode !== 'oauth') await edit(current => ({ ...current, mode: 'oauth' }));
    await grants.save(grant, signal);
    modelsChanged();
  } });
  ctx.on('dispose', oauth.dispose);

  class KiroService extends TypertRemoteService {
    constructor(scope) { super(scope, 'kiroProvider'); }
    async invoke(value) {
      try {
        const r = parseRequest(value);
        if (r.op === 'loginStart') {
          grants.checkWritable();
          if (controller.snapshot().mode !== 'oauth' && (!entry || !ctx.get('configEditor'))) throw new KiroProblem('此 Profile 无法切换到浏览器登录。');
          return { ok: true, value: await oauth.start(r) };
        }
        if (r.op === 'loginStatus') return { ok: true, value: oauth.status() };
        if (r.op === 'loginCancel') return { ok: true, value: oauth.cancel() };
        if (r.op === 'logout') {
          if (oauth.pending()) throw new KiroProblem('请先结束正在进行的 Kiro 登录。');
          await grants.forget();
          oauth.clear();
          modelsChanged();
          return { ok: true, value: { phase: 'idle' } };
        }
        const s = controller.snapshot();
        if (r.op === 'detect') return { ok: true, value: await controller.detect(s) };
        if (r.op === 'refresh') await controller.getModels(s, { force: true });
        if (r.op === 'connection') {
          if (oauth.pending()) throw new KiroProblem('请先结束正在进行的 Kiro 登录。');
          await edit(current => ({ ...current, mode: r.mode, keyRef: r.keyRef, ...(r.region ? { region: r.region } : {}) }));
          modelsChanged();
        }
        if (r.op === 'model') {
          if (!(await controller.getModels(s)).some(row => row.id === r.id)) throw new Error('当前账号没有此 Kiro 模型。');
          await edit(current => {
            const disabled = new Set(current.disabledModels ?? []);
            if (r.enabled) disabled.delete(r.id); else disabled.add(r.id);
            return { ...current, disabledModels: [...disabled] };
          });
        }
        return { ok: true, value: { ...controller.status(controller.snapshot()), oauthConnected: await grants.connected() } };
      } catch (error) {
        // Only return bounded errors authored by this plugin, not provider output or paths.
        return { ok: false, error: { message: safeProblem(error) } };
      }
    }
  }

  ctx.inject(['typert'], scope => scope.effect(() => scope.typert.register({
    package: kiroRemote.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: kiroRemote.descriptors,
  })));
  ctx.plugin(KiroService);
}
