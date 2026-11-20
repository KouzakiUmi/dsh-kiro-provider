// 会话输入栏的 Kiro 上下文 pill：显示所选模型的上下文窗口，并提供思考档位快捷切换。
// 只读 modelDirectories 的会话选择快照；档位写入走官方 session.selectModel，
// 模型参数经插件的存储视图读取（读不触发上游）。
export function KiroContextPill({ directory, call, sessionId }) {
  // directory 是 ModelDirectory 本体：订阅走它的 store 快照，档位写入走实例的 select。
  const subscribe = React.useCallback(listener => directory.store.subscribe(listener), [directory]);
  const getSnapshot = React.useCallback(() => directory.store.getSnapshot(), [directory]);
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const current = state?.current;
  const modelId = current?.provider === 'kiro-native' ? current.model : null;
  const [row, setRow] = React.useState(null);
  const [error, setError] = React.useState('');
  const selecting = state?.status === 'selecting' || state?.pending != null;

  React.useEffect(() => {
    setRow(null);
    setError('');
    if (!modelId) return undefined;
    let alive = true;
    void call({ op: 'status' }).then(view => {
      if (alive) setRow(view.models.find(model => model.id === modelId) ?? null);
    }, () => { if (alive) setError('读取失败'); });
    return () => { alive = false; };
  }, [call, modelId]);

  if (!modelId || (!row && !error)) return null;
  if (error) return h('span', { className: 'kiro-pill' }, h('span', { className: 'kiro-pill-error', role: 'alert' }, error));
  if (!row) return null;
  const efforts = row.efforts ?? [];
  const active = current?.reasoningEffort;
  const select = async effort => {
    if (selecting || active === effort) return;
    setError('');
    try {
      const result = await directory.select({ provider: 'kiro-native', model: modelId, reasoningEffort: effort });
      if (result && result.ok === false) setError('档位切换失败');
    } catch {
      // 会话不可用等极端态下 select 会拒绝；给出可重试的提示而非未处理拒绝。
      setError('档位切换失败');
    }
  };
  return h('span', { className: 'kiro-pill', 'aria-busy': selecting || undefined },
    row.contextWindow ? h('span', { className: 'kiro-pill-context', title: `${row.contextWindow.toLocaleString('zh-CN')} tokens 上下文` }, formatTokens(row.contextWindow)) : null,
    efforts.length ? h('span', { role: 'group', 'aria-label': '思考档位', className: 'kiro-actions' },
      efforts.map(id => h('button', {
        key: id, type: 'button', className: 'kiro-pill-tier', 'aria-pressed': active === id,
        disabled: selecting, title: `思考档位：${EFFORT_LABELS[id] ?? id}`,
        onClick: () => void select(id),
      }, EFFORT_LABELS[id] ?? id))) : null);
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