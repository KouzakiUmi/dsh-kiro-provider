// 额度面板：指标卡 + 严重度状态链 + 活倒计时 + 自动刷新暂停指示。
// 数字只来自 Kiro 响应，不做估算；状态投影是纯函数，可离线测试。
const WINDOW_LABELS = { plan: '套餐额度', overage: '超额用量', trial: '免费试用' };
export const QUOTA_STATUS_LABELS = {
  unsupported: '账户页查看', error: '读取失败', 'need-login': '需要登录', stale: '显示上次成功读数',
  empty: '暂无额度数据', critical: '已用尽', danger: '即将用尽', warn: '用量偏高', good: '正常',
};
const STATUS_TONE = { error: 'danger', critical: 'danger', danger: 'danger', warn: 'warn', stale: 'warn', 'need-login': 'warn', good: 'ok' };

// 优先级链（参考 opendesign quotaStatusView）：error > 需登录 > stale > 无窗口 > 最差窗口。
export function quotaStatusView(usage, { oauthMode = false, connected = false } = {}) {
  if (!usage?.supported) return { kind: 'unsupported', label: QUOTA_STATUS_LABELS.unsupported };
  if (usage.error) return { kind: 'error', label: QUOTA_STATUS_LABELS.error };
  if (oauthMode && !connected) return { kind: 'need-login', label: QUOTA_STATUS_LABELS['need-login'] };
  if (usage.stale && usage.at) return { kind: 'stale', label: QUOTA_STATUS_LABELS.stale };
  const windows = usage.windows ?? [];
  if (!windows.length) return { kind: 'empty', label: QUOTA_STATUS_LABELS.empty };
  const active = windows.filter(w => !w.aside);
  const pool = active.length ? active : windows;
  const worst = Math.max(...pool.map(w => w.percent));
  const kind = worst >= 100 ? 'critical' : worst >= 91 ? 'danger' : worst >= 71 ? 'warn' : 'good';
  return { kind, label: QUOTA_STATUS_LABELS[kind] };
}

const windowName = window => window.kind === 'bonus' ? window.name : WINDOW_LABELS[window.kind] ?? window.name;

export function UsagePanel({ state, store }) {
  const { view, busy } = state;
  const usage = view.usage;
  const [now, setNow] = React.useState(Date.now());

  // 到点重渲染：对准最近的刷新/重置/到期时刻，隐藏页签暂停，可见时立即补一次。
  React.useEffect(() => {
    if (!usage.supported) return undefined;
    let timer = null;
    const deadlines = (usage.windows ?? []).flatMap(w => [w.resetsAt, w.expiresAt]).filter(Boolean).map(Date.parse).filter(Number.isFinite);
    if (usage.nextRefreshAt) deadlines.push(usage.nextRefreshAt);
    const arm = () => {
      if (timer) clearTimeout(timer);
      const next = deadlines.filter(t => t > Date.now()).sort((a, b) => a - b)[0];
      const delay = next ? Math.max(1000, Math.min(next - Date.now(), 60_000)) : 60_000;
      timer = setTimeout(() => { setNow(Date.now()); arm(); }, delay);
    };
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); arm(); } };
    arm();
    document.addEventListener('visibilitychange', onVisible);
    return () => { if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [usage]);

  if (!usage.supported) {
    return h(Section, { title: '额度', summary: '当前连接方式经 Kiro CLI 对话，额度在 Kiro 账户页查看。' },
      h('p', { className: 'kiro-muted' }, h('a', { href: 'https://app.kiro.dev/', target: '_blank', rel: 'noreferrer' }, '打开 Kiro 账户页')));
  }

  const status = quotaStatusView(usage, { oauthMode: view.mode === 'oauth', connected: view.oauthConnected === true });
  const windows = usage.windows ?? [];
  const summary = [usage.plan, usage.user].filter(Boolean).join(' · ') || 'Kiro credits';
  return h(Section, {
    title: '额度', summary,
    actions: h(React.Fragment, null,
      h(Chip, { tone: STATUS_TONE[status.kind] }, status.label),
      button('刷新额度', () => void store.refreshUsage(), Boolean(busy.usage) || Boolean(busy.catalog))),
  },
    usage.autoRefreshPaused && h(Notice, { kind: 'warn' }, '额度自动刷新已暂停（连续读取失败）。点击「刷新额度」恢复。'),
    usage.error && h(Notice, { kind: 'warn' }, usage.error),
    windows.length === 0
      ? h(EmptyState, { emptyText: usage.at ? 'Kiro 未返回额度窗口。' : '尚未读取额度，点击刷新额度。' })
      : h('div', { className: 'kiro-cards' }, windows.map((window, index) => {
        const name = windowName(window);
        const deadline = window.resetsAt ? { at: Date.parse(window.resetsAt), prefix: '重置：' }
          : window.expiresAt ? { at: Date.parse(window.expiresAt), prefix: '到期：' } : null;
        return h('div', { key: `${window.kind}-${index}`, className: 'kiro-card', 'data-aside': window.aside || undefined },
          h('span', { className: 'kiro-card-name' }, name),
          h('span', { className: 'kiro-card-value' }, formatCredits(window.used), ' ', h('small', null, `/ ${formatCredits(window.limit)}`)),
          h(Meter, { percent: window.percent, label: name }),
          deadline && h(RelativeDeadline, { at: deadline.at, prefix: deadline.prefix, now }));
      })),
    h('dl', { className: 'kiro-meta' },
      h('div', null, h('dt', null, '最近更新'), h('dd', null, usage.at ? formatWhen(usage.at, now) : '尚未读取')),
      h('div', null, h('dt', null, '下次自动刷新'), h('dd', null, usage.autoRefreshPaused ? '已暂停' : usage.nextRefreshAt ? h(RelativeDeadline, { at: usage.nextRefreshAt, now }) : '等待调度')),
      h('div', null, h('dt', null, '数据来源'), h('dd', null, 'Kiro 管理面'))));
}