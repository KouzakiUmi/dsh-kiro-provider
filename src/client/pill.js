// 会话输入框右侧药丸：上下文窗口档位药丸 + Kiro 额度监测药丸。
// 上下文药丸按模型持久化到插件配置，以原生窗口封顶；只调整广告给 DSH 的上下文预算，不改上游请求。
// 额度药丸轮询缓存状态并支持弹窗详情 + 手动刷新（op: 'usage'）。

const QUOTA_MINI_HEIGHTS = [6, 5, 4, 3];

const QUOTA_PILL_TONES = {
  error: { tone: 'danger', tinted: true, badge: '失败' },
  critical: { tone: 'danger', tinted: true, badge: '已用尽' },
  danger: { tone: 'danger', tinted: true, badge: '紧张' },
  stale: { tone: 'warn', tinted: true, badge: '缓存' },
  'need-login': { tone: 'warn', tinted: true, badge: '需登录' },
  empty: { tone: 'neutral', tinted: false, badge: '暂无' },
  unsupported: { tone: 'neutral', tinted: false, badge: '账户页' },
  good: { tone: 'ok', tinted: false, badge: '' },
};

function useDirectoryState(directory) {
  const subscribe = React.useCallback(listener => (directory?.store ? directory.store.subscribe(listener) : () => {}), [directory]);
  const getSnapshot = React.useCallback(() => directory?.store?.getSnapshot() ?? null, [directory]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function registerInputSlot(ctx, call, { id, order, label, component }) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['modelDirectories'], scope => {
    scope.effect(() => scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right', id, order,
      inject: sessionId => ({ directory: scope.modelDirectories.directoryFor(sessionId), call, sessionId }),
    }, component)), label);
  });
}

function quotaPillView(view, rpcError) {
  if (!view) {
    return rpcError
      ? { kind: 'error', tone: 'danger', tinted: true, badge: '失败', stale: false, bars: [], label: 'Kiro 额度读取失败' }
      : { kind: 'loading', tone: 'neutral', tinted: false, badge: '…', stale: false, bars: [], label: '正在读取 Kiro 额度' };
  }
  const usage = view.usage;
  const status = quotaStatusView(usage, { oauthMode: view.mode === 'oauth', connected: view.oauthConnected === true });
  const windows = usage?.windows ?? [];
  const active = windows.filter(w => !w.aside);
  const pool = active.length ? active : windows;
  const bars = usage?.supported ? pool.slice(0, 4) : [];
  const worst = bars.length ? Math.max(...bars.map(w => w.percent ?? 0)) : 0;
  const tone = status.kind === 'warn'
    ? { tone: worst >= 85 ? 'tight' : 'warn', tinted: true, badge: '偏少' }
    : QUOTA_PILL_TONES[status.kind] ?? QUOTA_PILL_TONES.good;
  const barSummary = bars.map(w => `${windowName(w)} 剩余 ${Math.max(0, Math.min(100, Math.round(100 - (w.percent ?? 0))))}%`).join(' · ');
  const label = barSummary
    ? `Kiro 额度：${barSummary}${status.kind !== 'good' ? `（${status.label}）` : ''}`
    : `Kiro 额度：${status.label}`;
  return { kind: status.kind, tone: tone.tone, tinted: tone.tinted, badge: tone.badge, stale: status.kind === 'stale', bars, label };
}

function MiniBars({ windows }) {
  return h('span', { className: 'kiro-quota-mini', 'aria-hidden': 'true' },
    windows.map((window, i) => {
      const leftPct = Math.max(0, Math.min(100, Math.round(100 - (window.percent ?? 0))));
      return h('span', {
        key: `${window.kind}-${i}`,
        className: 'kiro-quota-mini-track',
        style: { height: `${QUOTA_MINI_HEIGHTS[i] ?? 3}px` },
      }, h('span', {
        className: 'kiro-quota-mini-fill',
        'data-tone': remainingTone(window.percent ?? 0),
        style: { width: `${leftPct}%` },
      }));
    }));
}

export function KiroContextPill({ directory, call, sessionId }) {
  const state = useDirectoryState(directory);
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
    return h('span', { className: 'kiro-pill', 'data-error': 'true' },
      h('span', { className: 'kiro-pill-error', role: 'alert' }, error),
      h('button', { type: 'button', className: 'kiro-pill-tier', disabled: busy, onClick: () => { setError(''); setAttempt(n => n + 1); } }, '重试'));
  }
  const native = view?.row?.contextWindow;
  if (!native) return null;
  const tier = view.defaults?.contextTier ?? '';
  const effective = effectiveContextWindow(native, tier);
  const options = contextTierOptions(native);
  const nativeLabel = formatTokens(native) || '默认';

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

  const summary = `当前上下文窗口 ${formatTokens(effective)}（${effective.toLocaleString('zh-CN')} tokens · 原生 ${nativeLabel}）`;
  if (!options.length) {
    return h('span', { className: 'kiro-pill', 'data-readonly': 'true', title: summary }, nativeLabel);
  }
  return h('span', {
    className: 'kiro-pill',
    role: 'group',
    'aria-label': '上下文窗口',
    'aria-busy': busy || undefined,
    title: summary,
  },
  ...options.map(id => h('button', {
    key: id, type: 'button', className: 'kiro-pill-tier', 'aria-pressed': tier === id, disabled: busy,
    title: `${CONTEXT_TIERS[id].toLocaleString('zh-CN')} tokens`, onClick: () => void select(id),
  }, formatTokens(CONTEXT_TIERS[id]))),
  h('button', {
    key: 'default', type: 'button', className: 'kiro-pill-tier', 'aria-pressed': tier === '', disabled: busy,
    title: `原生默认 ${nativeLabel}（${native.toLocaleString('zh-CN')} tokens）`, onClick: () => void select(''),
  }, nativeLabel));
}

export function KiroUsagePill({ directory, call, sessionId }) {
  const state = useDirectoryState(directory);
  const enabled = state?.current?.provider === 'kiro-native';
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState(null);
  const [rpcError, setRpcError] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const wrapRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const popRef = React.useRef(null);
  const mountedRef = React.useRef(true);
  const refreshingRef = React.useRef(false);
  const reqSeqRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  React.useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const loadStatus = React.useCallback(async () => {
    if (!enabled || refreshingRef.current) return;
    const seq = ++reqSeqRef.current;
    try {
      const value = await call({ op: 'status' });
      if (!mountedRef.current || seq !== reqSeqRef.current) return;
      setView(value);
      setRpcError('');
      setNow(Date.now());
    } catch (err) {
      if (!mountedRef.current || seq !== reqSeqRef.current) return;
      setRpcError(err?.message || '读取额度失败');
    }
  }, [call, enabled]);

  React.useEffect(() => {
    if (!enabled) return undefined;
    void loadStatus();
    if (typeof document === 'undefined') return undefined;
    const timer = setInterval(() => { if (!document.hidden) void loadStatus(); }, READ_POLL_MS);
    const onVisible = () => { if (!document.hidden) void loadStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, loadStatus]);

  React.useEffect(() => {
    if (enabled && open) void loadStatus();
  }, [enabled, open, loadStatus]);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const onPointerDown = event => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const pop = popRef.current;
    if (!pop) return undefined;
    const resetStyles = () => {
      pop.style.position = '';
      pop.style.left = '';
      pop.style.top = '';
      pop.style.right = '';
      pop.style.bottom = '';
    };
    resetStyles();
    const isGoIslandPanel = document.documentElement?.hasAttribute('data-dsh-go-island')
      && document.documentElement.getAttribute('data-dsh-go-island-form') === 'panel';
    if (!isGoIslandPanel && typeof pop.getBoundingClientRect === 'function') {
      const rect = pop.getBoundingClientRect();
      const vw = document.documentElement?.clientWidth || window.innerWidth || 0;
      const vh = window.innerHeight || 0;
      if (vw > 0 && vh > 0 && (rect.left < 12 || rect.right > vw - 12 || rect.top < 12 || rect.bottom > vh - 12)) {
        const left = Math.max(12, Math.min(rect.left, vw - rect.width - 12));
        const top = Math.max(12, Math.min(rect.top, vh - rect.height - 12));
        pop.style.position = 'fixed';
        pop.style.left = `${left}px`;
        pop.style.top = `${top}px`;
        pop.style.right = 'auto';
        pop.style.bottom = 'auto';
      }
    }
    return resetStyles;
  }, [open, view, rpcError]);

  React.useEffect(() => {
    if (!open || !view?.usage?.supported || typeof document === 'undefined') return undefined;
    const timer = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 60_000);
    return () => clearInterval(timer);
  }, [open, view?.usage?.supported]);

  const refresh = React.useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRpcError('');
    const seq = ++reqSeqRef.current;
    const op = view?.usage?.supported === false ? 'status' : 'usage';
    try {
      const value = await call({ op });
      if (!mountedRef.current || seq !== reqSeqRef.current) return;
      setView(value);
      setNow(Date.now());
    } catch (err) {
      if (!mountedRef.current || seq !== reqSeqRef.current) return;
      setRpcError(err?.message || '刷新额度失败');
    } finally {
      refreshingRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [call, view?.usage?.supported]);

  if (!enabled) return null;

  const pill = quotaPillView(view, rpcError);
  const hasBars = pill.bars.length > 0;
  const usage = view?.usage;
  const unsupported = Boolean(view && !usage?.supported);
  const footText = !view
    ? (rpcError ? '读取失败' : '正在读取…')
    : unsupported
      ? 'CLI 模式'
      : usage?.at ? `更新于 ${formatWhen(usage.at, now)}` : '尚未读取';

  return h('div', { ref: wrapRef, className: 'kiro-quota-pill' },
    h('button', {
      ref: triggerRef,
      type: 'button',
      className: 'kiro-quota-trigger',
      'data-tone': pill.tone,
      'data-tinted': pill.tinted ? 'true' : undefined,
      'data-stale': pill.stale ? 'true' : undefined,
      'data-short': !hasBars ? 'true' : undefined,
      'aria-expanded': open,
      'aria-haspopup': 'dialog',
      'aria-label': pill.label,
      title: pill.label,
      onClick: () => setOpen(v => !v),
    },
      hasBars
        ? h(React.Fragment, null,
          h(MiniBars, { windows: pill.bars }),
          pill.badge ? h('span', { className: 'kiro-quota-badge' }, pill.badge) : null)
        : h(React.Fragment, null,
          h('span', { className: 'kiro-quota-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'kiro-quota-label' }, pill.badge || 'Kiro'))),
    open && h('div', {
      ref: popRef,
      className: 'kiro-quota-popover',
      role: 'dialog',
      'aria-label': 'Kiro 额度详情',
    },
      h('div', { className: 'kiro-quota-head' },
        h('span', { className: 'kiro-quota-title' }, 'Kiro · 额度'),
        usage?.plan ? h(Chip, { tone: 'accent' }, usage.plan) : null,
        h('button', {
          type: 'button',
          className: 'kiro-quota-close',
          'aria-label': '关闭额度详情',
          onClick: () => setOpen(false),
        }, '×')),
      h('div', { className: 'kiro-quota-body' },
        !view
          ? (rpcError
            ? h(Notice, { kind: 'error' }, rpcError)
            : h(EmptyState, { loading: true, loadingText: '正在读取额度…' }))
          : h(React.Fragment, null,
            rpcError ? h(Notice, { kind: 'error' }, rpcError) : null,
            h(UsageSummary, { view, now }))),
      h('div', { className: 'kiro-quota-foot' },
        h('span', null, footText),
        h('button', {
          type: 'button',
          className: 'kiro-quota-refresh',
          disabled: refreshing,
          onClick: () => void refresh(),
        }, refreshing ? '刷新中…' : unsupported ? '刷新状态' : '刷新额度'))));
}

export function registerContextPill(ctx, call) {
  registerInputSlot(ctx, call, {
    id: 'kiro-provider-context',
    order: 9,
    label: 'kiro-provider: context pill',
    component: KiroContextPill,
  });
}

export function registerUsagePill(ctx, call) {
  registerInputSlot(ctx, call, {
    id: 'kiro-provider-quota',
    order: 1002,
    label: 'kiro-provider: quota pill',
    component: KiroUsagePill,
  });
}