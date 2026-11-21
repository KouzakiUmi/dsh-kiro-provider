import z from '@deepseek-ai/schemastery';
import { join } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { createController, ROUTE, snapshotValidators } from './controller.mjs';
import { createStore } from './store.mjs';
import { adapterFor } from './llm-adapter.mjs';
import { createInvoker, serviceClass } from './service.mjs';
import { kiroRemote, pluginId } from './remote.mjs';
import { createOAuth } from './oauth.mjs';
import { oauthGrants } from './oauth-grant.mjs';
import { KiroProblem } from './cli.mjs';

export const name = pluginId;
export const inject = ['llm'];
export const Config = z.object({
  mode: z.union(['oauth', 'direct', 'session', 'local', 'managed', 'key', 'gateway']).default('oauth').volatile(),
  region: z.union(['us-east-1', 'eu-central-1']).default('us-east-1').volatile(),
  cliPath: z.string().default('').volatile(),
  keyRef: z.string().default('KIRO_API_KEY').volatile(),
  disabledModels: z.array(z.string()).default([]).volatile(),
  enabledModels: z.array(z.string()).default([]).volatile(),
  modelDefaults: z.array(z.object({ id: z.string(), effort: z.string().default(''), maxTokens: z.number().default(0), contextTier: z.string().default('') })).default([]).volatile(),
  quotaRefreshSeconds: z.number().default(60).volatile(),
  streamIdleTimeoutMs: z.number().default(180_000).volatile(),
  maxRequestImageBytes: z.number().default(10_000_000).volatile(),
  autoOpenBrowser: z.boolean().default(true).volatile(),
  statePath: z.string().default('').volatile(),
});

export function apply(ctx, config) {
  const entry = ctx.fiber.entry;
  const root = dshHomePath('storages', name);
  const store = createStore({
    file: config.statePath.get() || join(root, 'state.json'),
    validate: (kind, value) => snapshotValidators[kind]?.(value),
  });
  const grants = oauthGrants(() => ctx.get('credentials'));
  const controller = createController({ root, store,
    settings: () => ({ mode: config.mode.get(), region: config.region.get(), cliPath: config.cliPath.get(), keyRef: config.keyRef.get(),
      disabledModels: config.disabledModels.get(), enabledModels: config.enabledModels.get(), modelDefaults: config.modelDefaults.get(),
      quotaRefreshSeconds: config.quotaRefreshSeconds.get(), streamIdleTimeoutMs: config.streamIdleTimeoutMs.get(), maxRequestImageBytes: config.maxRequestImageBytes.get(),
      autoOpenBrowser: config.autoOpenBrowser.get() }),
    readKey: async ref => (await ctx.get('credentials')?.resolve(credentialRef(ref)))?.value,
    readOAuth: grants.auth,
    onUpdate: () => ctx.emit('llm/adapters-updated'),
  });
  ctx.effect(() => ctx.llm.registerAdapter([ROUTE], adapterFor(controller, ctx)));
  ctx.effect(() => ctx.llm.registerConfigurableProviders([{ provider: ROUTE, displayName: 'Kiro Provider', settingsNs: name, settingsPath: [] }]));
  ctx.on('dispose', () => { controller.dispose(); store.dispose(); });
  ctx.on('credentials/reference-updated', controller.reset);

  async function edit(update) {
    const editor = ctx.get('configEditor');
    if (!entry || !editor) throw new KiroProblem('此 Profile 无法保存插件设置。');
    await editor.edit(entry, update);
  }

  // Writes only invalidate; the read path revalidates lazily and the UI refreshes explicitly.
  function modelsChanged() {
    controller.reset();
    ctx.emit('llm/adapters-updated');
  }

  const oauth = createOAuth({ async save(grant, signal) {
    if (controller.snapshot().mode !== 'oauth') await edit(current => ({ ...current, mode: 'oauth' }));
    await grants.save(grant, signal);
    modelsChanged();
  } });
  ctx.on('dispose', oauth.dispose);

  const invoke = createInvoker({ controller, oauth, grants, edit, modelsChanged, notifyModels: () => ctx.emit('llm/adapters-updated'), canEdit: () => Boolean(entry && ctx.get('configEditor')) });
  ctx.inject(['typert'], scope => scope.effect(() => scope.typert.register({
    package: kiroRemote.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: kiroRemote.descriptors,
  })));
  ctx.plugin(serviceClass(invoke));
}