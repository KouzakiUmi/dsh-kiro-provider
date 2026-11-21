// 上下文窗口调整药丸（参考 kxyai modelContextTiers 语义）：快捷档 256K/500K/1M + 默认，
// 按模型持久化到插件配置，以原生窗口封顶；只调整广告给 DSH 的上下文预算，不改上游请求。
// 当前模型来自 modelDirectories 会话选择快照；写入走 modelContext 字段级合并 op，
// 只动 contextTier，不回填可能陈旧的 effort/maxTokens。
export function KiroContextPill({ directory, call, sessionId }) {
  const subscribe = React.useCallback(listener => directory.store.subscribe(listener), [directory]);
  const getSnapshot = React.useCallback(() => directory.store.getSnapshot(), [directory]);
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const current = state?.current;
  const modelId = current?.provider === 'kiro-native' ? current.model : null;
  const [view, setView] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    setView(null);
    setError('');
    if (!modelId) return undefined;
    let alive = true;
    void call({ op: 'status' }).then(value => {
      if (!alive) return;
      const row = value.models.find(model => model.id === modelId);
      setView(row ? { row, defaults: value.modelDefaults.find(d => d.id === modelId) } : null);
    }, () => { if (alive) setError('读取失败'); });
    return () => { alive = false; };
  }, [call, modelId, attempt]);

  if (!modelId) return null;
  if (error) {
    return h('span', { className: 'kiro-pill' },
      h('span', { className: 'kiro-pill-error', role: 'alert' }, error),
      h('button', { type: 'button', className: 'kiro-pill-tier', disabled: busy, onClick: () => { setError(''); setAttempt(n => n + 1); } }, '重试'));
  }
  const native = view?.row?.contextWindow;
  if (!native) return null;
  const tier = view.defaults?.contextTier ?? '';
  const effective = effectiveContextWindow(native, tier);
  const options = contextTierOptions(native);

  const select = async next => {
    if (busy || next === tier) return;
    setBusy(true);
    setError('');
    try {
      const value = await call({ op: 'modelContext', id: modelId, contextTier: next });
      const row = value.models.find(model => model.id === modelId);
      setView(row ? { row, defaults: value.modelDefaults.find(d => d.id === modelId) } : null);
    } catch {
      setError('保存失败');
    } finally {
      setBusy(false);
    }
  };

  return h('span', { className: 'kiro-pill', 'aria-busy': busy || undefined },
    h('span', {
      className: 'kiro-pill-context',
      title: `上下文窗口 ${effective.toLocaleString('zh-CN')} tokens（原生 ${native.toLocaleString('zh-CN')}）`,
    }, formatTokens(effective)),
    options.length ? h('span', { role: 'group', 'aria-label': '上下文窗口', className: 'kiro-actions' },
      options.map(id => h('button', {
        key: id, type: 'button', className: 'kiro-pill-tier', 'aria-pressed': tier === id, disabled: busy,
        title: `${CONTEXT_TIERS[id].toLocaleString('zh-CN')} tokens`, onClick: () => void select(id),
      }, formatTokens(CONTEXT_TIERS[id]))),
      h('button', {
        key: 'default', type: 'button', className: 'kiro-pill-tier', 'aria-pressed': tier === '', disabled: busy,
        title: `恢复原生 ${native.toLocaleString('zh-CN')} tokens`, onClick: () => void select(''),
      }, '默认')) : null);
}

export function registerContextPill(ctx, call) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['modelDirectories'], scope => {
    scope.effect(() => scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id: 'kiro-provider-context', order: 9,
      inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId), call, sessionId }),
    }, KiroContextPill)), 'kiro-provider: context pill');
  });
}