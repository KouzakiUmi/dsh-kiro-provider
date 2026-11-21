// 设计系统原语（kit）：唯一允许拼元素形状的层。
// 纪律：组件不接受任意 className 覆写；一切列表条目都走 Row；面板只提供数据与动作。

export const Section = ({ title, summary, actions, children }) => h('section', { className: 'kiro-section' },
  h('div', { className: 'kiro-section-head' },
    h('div', null,
      h('h3', { className: 'kiro-section-title' }, title),
      summary === undefined || summary === null ? null : h('p', { className: 'kiro-summary' }, summary)),
    actions === undefined || actions === null ? null : h('div', { className: 'kiro-actions' }, actions)),
  children);

export const ListBox = ({ children }) => h('div', { className: 'kiro-list' }, children);

export const Switch = ({ checked, disabled, label, onChange }) => h('button', {
  type: 'button', className: 'kiro-switch', role: 'switch', disabled,
  'aria-checked': checked, 'aria-label': label, onClick: onChange,
}, h('span', { className: 'kiro-switch-knob', 'aria-hidden': 'true' }));

// 列表行：主体（名称 + 徽标 + 副行）| 开关 | 展开明细。
export const Row = ({ name, tags, meta, switchControl, moreLabel, expanded, onToggle, detail, off }) =>
  h('div', { className: 'kiro-row', 'data-off': off ? 'true' : undefined },
    h('div', { className: 'kiro-row-main' },
      h('div', { className: 'kiro-row-copy' },
        h('span', { className: 'kiro-row-head' },
          h('span', { className: 'kiro-row-name', title: name }, name),
          tags),
        meta === undefined ? null : h('span', { className: 'kiro-row-meta' }, meta))),
    switchControl === undefined ? null : switchControl,
    moreLabel === undefined ? null
      : h('button', { type: 'button', className: 'kiro-more', 'aria-expanded': expanded, 'aria-label': `${name} 的更多操作`, onClick: onToggle }, expanded ? '收起' : moreLabel),
    expanded && detail ? h('div', { className: 'kiro-row-detail' }, detail) : null);

export const Chip = ({ tone, title, children }) => h('span', { className: 'kiro-chip', 'data-tone': tone, title }, children);

export const Notice = ({ kind, children }) => h('p', { className: 'kiro-notice', 'data-kind': kind, role: kind === 'error' ? 'alert' : 'status' }, children);

export const EmptyState = ({ loading, failed, onRetry, disabled, emptyText, loadingText }) => {
  if (loading) return h('p', { className: 'kiro-empty' }, loadingText ?? '正在读取…');
  if (failed) return h('div', { className: 'kiro-empty' }, h('span', null, '读取失败。'), ' ', button('重试', onRetry, disabled));
  return h('p', { className: 'kiro-empty' }, emptyText);
};

export const Meter = ({ percent, label }) => h('div', {
  className: 'kiro-meter', role: 'progressbar', 'aria-label': label,
  'aria-valuenow': Math.round(Math.min(100, percent)), 'aria-valuemin': 0, 'aria-valuemax': 100,
}, h('span', { className: 'kiro-meter-fill', 'data-high': percent >= 90 || undefined, 'data-full': percent >= 100 || undefined, style: { width: `${Math.min(100, Math.max(0, percent))}%` } }));

// 活倒计时语义元素：父级提供时钟 now，到点重渲染由面板负责。
export const RelativeDeadline = ({ at, prefix, now = Date.now() }) => {
  if (!Number.isFinite(at)) return null;
  const text = `${prefix ?? ''}${formatWhen(at, now)}`;
  return h('time', { dateTime: new Date(at).toISOString(), title: new Date(at).toLocaleString(), 'aria-label': text }, text);
};

// 数值字段：整数 + 区间校验，错误就地提示（失焦保留草稿，由保存按钮提交）。
export function NumberField({ id, label, value, min, max, disabled, onChange }) {
  const numeric = Number(value);
  const invalid = String(value).trim() !== '' && (!Number.isSafeInteger(numeric) || numeric < min || numeric > max);
  return h('label', { className: 'kiro-field', htmlFor: id }, label,
    h('input', { id, className: 'kiro-input', type: 'number', inputMode: 'numeric', value, min, max, disabled, onChange: event => onChange(event.target.value) }),
    invalid && h('span', { className: 'kiro-field-error', role: 'alert' }, `须为 ${min}–${max} 的整数`));
}

export const numberFieldInvalid = (value, min, max) => {
  const numeric = Number(value);
  return String(value).trim() === '' || !Number.isSafeInteger(numeric) || numeric < min || numeric > max;
};

export const button = (label, onClick, disabled, kind) => h('button', {
  type: 'button', className: `kiro-button${kind ? ` is-${kind}` : ''}`, disabled, onClick,
}, label);

export const EFFORT_LABELS = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' };

export function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1000) return `${Number((n / 1000).toFixed(n >= 100_000 ? 0 : 1))}K`;
  return String(n);
}

export function formatCredits(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// 过去与未来都按相对时间表达；超出两周落到本地日期。
export function formatWhen(ts, now = Date.now()) {
  if (!Number.isFinite(ts)) return '';
  const delta = ts - now;
  const abs = Math.abs(delta);
  const suffix = delta >= 0 ? '后' : '前';
  if (abs < 60_000) return delta >= 0 ? '即将' : '刚刚';
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟${suffix}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} 小时${suffix}`;
  if (abs < 14 * 86_400_000) return `${Math.round(abs / 86_400_000)} 天${suffix}`;
  return new Date(ts).toLocaleDateString();
}