import { LlmAdapter, LlmError, ReasoningEffortId, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm';
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { KiroProblem, safeProblem } from './cli.mjs';
import { generate } from './adapter.mjs';
import { directFetch, directProfile } from './direct.mjs';
import { ROUTE, directMode } from './controller.mjs';
import { readableModelName } from './model-name.mjs';

function modelInfo(row) {
  return { provider: ROUTE, id: row.id, name: readableModelName(row.id, row.name), inputModalities: row.inputModalities ?? ['text'],
    ...(row.contextWindow ? { context: { contextWindow: row.contextWindow } } : {}),
    ...(row.efforts.length ? { reasoning: { efforts: row.efforts.map(id => ({ id: ReasoningEffortId(id), name: id })) } } : {}) };
}

export function adapterFor(controller, ctx) {
  const retryPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, ROUTE);
  const sdk = anthropicMessagesApi();
  const credentials = new InMemoryCredentialStore();
  function nativeAdapter(s, row, tuning, onFailure) {
    const profile = directProfile(row, ROUTE, retryPolicy, s.advanced);
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
    if (!controller.modelEnabled(s, id)) throw new LlmError('该 Kiro 模型已关闭。', 'MODEL_UNSUPPORTED');
    const row = (await controller.ensure(s, signal)).find(row => row.id === id);
    if (!row) throw new LlmError('该 Kiro 账号未发布所选模型。', 'UNKNOWN_MODEL');
    return row;
  }
  // Per-model defaults fill only unset options; explicit request options always win.
  function withDefaults(s, row, options) {
    const defaults = s.modelDefaults.find(d => d.id === row.id);
    const effort = options.reasoningEffort ?? (defaults?.effort && row.efforts.includes(defaults.effort) ? defaults.effort : undefined);
    const range = row.maxTokenRange;
    const maxTokens = options.maxTokens ?? (directMode(s.mode) && defaults?.maxTokens && range
      && defaults.maxTokens >= range.min && defaults.maxTokens <= range.max ? defaults.maxTokens : undefined);
    return { effort, maxTokens };
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
      await controller.ready;
      const view = controller.read(s);
      controller.revalidate(s);
      return view.rows.filter(row => controller.modelEnabled(s, row.id)).map(modelInfo);
    }
    async resolveModel(provider, id, signal) {
      const s = controller.snapshot();
      const row = await exact(s, id, signal);
      return directMode(s.mode) ? nativeAdapter(s, row).resolveModel(provider, id, signal) : modelInfo(row);
    }
    imageRequestPricing(provider, id) {
      const s = controller.snapshot();
      const row = directMode(s.mode) && controller.read(s).rows.find(row => row.id === id && controller.modelEnabled(s, row.id));
      return row ? nativeAdapter(s, row).imageRequestPricing(provider, id) : undefined;
    }
    imageRequestTarget(provider, id, image) {
      const s = controller.snapshot();
      const row = directMode(s.mode) && controller.read(s).rows.find(row => row.id === id && controller.modelEnabled(s, row.id));
      return row ? nativeAdapter(s, row).imageRequestTarget(provider, id, image) : super.imageRequestTarget(provider, id, image);
    }
    async prepareCall(_provider, id, signal) {
      const s = controller.snapshot();
      const row = await exact(s, id, signal);
      if (directMode(s.mode)) {
        const model = await nativeAdapter(s, row).resolveModel(ROUTE, id, signal);
        return { model, stream: options => {
          const { effort, maxTokens } = withDefaults(s, row, options);
          return dispatchDirect(s, row, { ...options, reasoningEffort: effort, maxTokens });
        } };
      }
      const model = modelInfo(row);
      return { model, stream: options => {
        const { effort } = withDefaults(s, row, options);
        return dispatch(s, model, { ...options, reasoningEffort: effort });
      } };
    }
    async *stream(options) { yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options); }
  }();
}