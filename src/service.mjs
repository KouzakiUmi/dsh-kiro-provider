import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { KiroProblem, safeProblem } from './cli.mjs';
import { parseRequest } from './remote.mjs';
import { openBrowser } from './browser-open.mjs';

// Single-descriptor RPC with an op whitelist. Reads short-circuit to the store;
// writes go through the Config Editor and never carry secrets.
export function createInvoker({ controller, oauth, grants, edit, modelsChanged, notifyModels, canEdit }) {
  return async function invoke(value) {
    try {
      const r = parseRequest(value);
      if (r.op === 'loginStart') {
        grants.checkWritable();
        if (controller.snapshot().mode !== 'oauth' && !canEdit()) throw new KiroProblem('此 Profile 无法切换到浏览器登录。');
        const started = await oauth.start(r);
        // 本地发起的登录自动打开一次默认浏览器（可在高级设置关闭）；URL 已经白名单校验，失败时设置页链接仍可点击。
        if (controller.snapshot().autoOpenBrowser !== false) openBrowser(started.url);
        return { ok: true, value: started };
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
      if (r.op === 'refresh') await controller.refresh(s, { force: true });
      if (r.op === 'usage') await controller.refreshUsage(s, { force: true });
      if (r.op === 'advanced') {
        await edit(current => ({ ...current, autoOpenBrowser: r.autoOpenBrowser, quotaRefreshSeconds: r.quotaRefreshSeconds, streamIdleTimeoutMs: r.streamIdleTimeoutMs, maxRequestImageBytes: r.maxRequestImageBytes }));
        // 刷新间隔立即重排；暂停态保持到手动刷新成功。流超时与图片上限随下次请求构建生效。
        controller.reschedule();
      }
      if (r.op === 'connection') {
        if (oauth.pending()) throw new KiroProblem('请先结束正在进行的 Kiro 登录。');
        await edit(current => ({ ...current, mode: r.mode, keyRef: r.keyRef, ...(r.region ? { region: r.region } : {}) }));
        modelsChanged();
      }
      if (r.op === 'model') {
        if (!(await controller.ensure(s)).some(row => row.id === r.id)) throw new KiroProblem('当前账号没有此 Kiro 模型。');
        await edit(current => {
          const disabled = new Set(current.disabledModels ?? []);
          const enabled = new Set(current.enabledModels ?? []);
          if (r.enabled) { disabled.delete(r.id); enabled.add(r.id); }
          else { enabled.delete(r.id); disabled.add(r.id); }
          return { ...current, disabledModels: [...disabled], enabledModels: [...enabled] };
        });
      }
      if (r.op === 'recommend') {
        // 恢复推荐：清除全部手动开关，回到「旧版默认关闭」的推荐列表。
        await edit(current => ({ ...current, disabledModels: [], enabledModels: [] }));
      }
      if (r.op === 'modelContext') {
        if (!(await controller.ensure(s)).some(row => row.id === r.id)) throw new KiroProblem('当前账号没有此 Kiro 模型。');
        // 字段级合并：只动 contextTier，保留该模型已有的 effort/maxTokens（药丸快照可能陈旧）。
        await edit(current => {
          const rows = current.modelDefaults ?? [];
          const prev = rows.find(d => d?.id === r.id);
          const rest = rows.filter(d => d?.id !== r.id);
          const next = { id: r.id, ...(prev?.effort ? { effort: prev.effort } : {}), ...(prev?.maxTokens ? { maxTokens: prev.maxTokens } : {}),
            ...(r.contextTier ? { contextTier: r.contextTier } : {}) };
          return { ...current, modelDefaults: next.effort || next.maxTokens || next.contextTier ? [...rest, next] : rest };
        });
        notifyModels?.();
      }
      if (r.op === 'modelSettings') {
        const row = (await controller.ensure(s)).find(row => row.id === r.id);
        if (!row) throw new KiroProblem('当前账号没有此 Kiro 模型。');
        if (r.effort && !row.efforts.includes(r.effort)) throw new KiroProblem('该模型未发布此思考档位。');
        if (r.maxTokens && (!row.maxTokenRange || r.maxTokens < row.maxTokenRange.min || r.maxTokens > row.maxTokenRange.max)) {
          throw new KiroProblem('输出长度上限超出该模型公布的范围。');
        }
        await edit(current => {
          const rest = (current.modelDefaults ?? []).filter(d => d?.id !== r.id);
          const next = { id: r.id, ...(r.effort ? { effort: r.effort } : {}), ...(r.maxTokens ? { maxTokens: r.maxTokens } : {}),
            ...(r.contextTier ? { contextTier: r.contextTier } : {}) };
          return { ...current, modelDefaults: next.effort || next.maxTokens || next.contextTier ? [...rest, next] : rest };
        });
        // 上下文字段改变广告窗口：通知选择器目录刷新，但不失效持久化快照。
        notifyModels?.();
      }
      await controller.ready;
      // 轻量读顺带触发后台补采（陈旧时），视图本身立即从存储返回，不等待上游。
      if (r.op === 'status' || r.op === 'connection') controller.revalidate(controller.snapshot());
      return { ok: true, value: { ...controller.status(controller.snapshot()), oauthConnected: await grants.connected() } };
    } catch (error) {
      // Only bounded errors authored by this plugin, never provider output or paths.
      return { ok: false, error: { message: safeProblem(error) } };
    }
  };
}

export function serviceClass(invoke) {
  return class KiroService extends TypertRemoteService {
    constructor(scope) { super(scope, 'kiroProvider'); }
    invoke(value) { return invoke(value); }
  };
}