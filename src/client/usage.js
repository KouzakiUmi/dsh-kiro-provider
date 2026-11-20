// 额度面板：Kiro credits 窗口（套餐/超额/赠送/试用）。数字只来自 Kiro 响应，不做估算。
const WINDOW_LABELS = { plan: '套餐额度', overage: '超额用量', trial: '免费试用' };

export function renderUsage(state, store) {
  const { view, busy } = state;
  const usage = view.usage;
  if (!usage.supported) {
    return h(Section, { title: '额度', summary: '当前连接方式经 Kiro CLI 对话，额度在 Kiro 账户页查看。' },
      h('p', { className: 'kiro-muted' }, h('a', { href: 'https://app.kiro.dev/', target: '_blank', rel: 'noreferrer' }, '打开 Kiro 账户页')));
  }
  const windows = usage.windows ?? [];
  const summary = [usage.plan, usage.user].filter(Boolean).join(' · ') || 'Kiro credits';
  return h(Section, {
    title: '额度', summary,
    actions: button('刷新额度', () => void store.refreshUsage(), Boolean(busy.usage) || Boolean(busy.catalog)),
  },
    usage.error && h(Notice, { kind: 'warn' }, usage.error),
    windows.length === 0
      ? h(EmptyState, { emptyText: usage.at ? 'Kiro 未返回额度窗口。' : '尚未读取额度，点击刷新额度。' })
      : h(ListBox, null, windows.map((window, index) => {
        const name = window.kind === 'bonus' ? window.name : WINDOW_LABELS[window.kind] ?? window.name;
        const when = window.resetsAt ? `${formatWhen(Date.parse(window.resetsAt))}重置`
          : window.expiresAt ? `${formatWhen(Date.parse(window.expiresAt))}到期` : null;
        return h('div', { key: `${window.kind}-${index}`, className: 'kiro-window', 'data-aside': window.aside || undefined },
          h('div', { className: 'kiro-window-head' },
            h('span', { className: 'kiro-window-name' }, name),
            h('span', { className: 'kiro-window-count' }, `${formatCredits(window.used)} / ${formatCredits(window.limit)}`)),
          h(Meter, { percent: window.percent, label: name }),
          when && h('span', { className: 'kiro-window-reset' }, when));
      })));
}