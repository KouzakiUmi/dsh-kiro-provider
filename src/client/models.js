// 模型面板：搜索 + 启用计数 + 默认 6 条折叠 + 每模型默认设置编辑器。
export const sortModelsByEnabled = models => [...models].sort((a, b) => Number(b.enabled) - Number(a.enabled));
export const filterModels = (models, query) => {
  const q = String(query ?? '').trim().toLowerCase();
  return q ? models.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : models;
};
const PAGE_SIZE = 6;

export function ModelsPanel({ state, store }) {
  const { view, busy } = state;
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);
  const logging = LOGIN_ACTIVE.includes(state.login.phase);
  const canFetch = !logging && (view.mode !== 'oauth' || view.oauthConnected);
  const defaults = new Map(view.modelDefaults.map(row => [row.id, row]));
  const sorted = sortModelsByEnabled(view.models);
  const filtered = filterModels(sorted, query);
  const visible = expanded ? filtered : filtered.slice(0, PAGE_SIZE);
  const enabledCount = view.models.filter(m => m.enabled).length;
  const summary = `已启用 ${enabledCount}/${view.models.length} · ${view.catalogAt ? `更新于 ${formatWhen(view.catalogAt)}${view.catalogSource === 'disk' ? ' · 本地快照' : ''}` : '尚未读取模型'}`;

  return h(Section, {
    title: '模型目录', summary,
    actions: canFetch ? h(React.Fragment, null,
      button('检测连接', () => void store.detect(), Boolean(busy.catalog)),
      button('刷新模型', () => void store.refresh(), Boolean(busy.catalog), 'primary')) : null,
  },
    h('input', {
      className: 'kiro-search', type: 'search', value: query, placeholder: '搜索模型名称或 ID…',
      'aria-label': '搜索模型', onChange: event => setQuery(event.target.value),
    }),
    view.modelError && h(Notice, { kind: 'warn' }, view.modelError),
    filtered.length === 0
      ? h(EmptyState, { emptyText: query ? '没有匹配的模型。' : '还没有读取到模型。完成登录或保存连接后点击刷新模型。' })
      : h(ListBox, null, visible.map(model => h(ModelRow, {
        key: model.id, model, defaults: defaults.get(model.id), store,
        busy: Boolean(busy[`model:${model.id}`]) || Boolean(busy.catalog),
      }))),
    filtered.length > PAGE_SIZE
      && button(expanded ? '收起' : `展开全部 ${filtered.length} 个模型`, () => setExpanded(value => !value), false, 'quiet'));
}

function ModelRow({ model, defaults, busy, store }) {
  const [open, setOpen] = React.useState(false);
  const [effort, setEffort] = React.useState(defaults?.effort ?? '');
  const [maxTokens, setMaxTokens] = React.useState(defaults?.maxTokens ? String(defaults.maxTokens) : '');

  React.useEffect(() => {
    setEffort(defaults?.effort ?? '');
    setMaxTokens(defaults?.maxTokens ? String(defaults.maxTokens) : '');
  }, [defaults?.effort, defaults?.maxTokens]);

  const range = model.maxTokenRange;
  const tokens = maxTokens.trim() === '' ? 0 : Number(maxTokens);
  const tokensValid = Number.isSafeInteger(tokens) && tokens >= 0 && (!tokens || (range && tokens >= range.min && tokens <= range.max));
  const unchanged = effort === (defaults?.effort ?? '') && tokens === (defaults?.maxTokens ?? 0);
  const tags = [
    model.contextWindow ? h(Chip, { key: 'ctx' }, `${formatTokens(model.contextWindow)} 上下文`) : null,
    model.creditRate ? h(Chip, { key: 'rate', tone: 'accent' }, `${model.creditRate}× credits`) : null,
    model.inputModalities?.includes('image') ? h(Chip, { key: 'img' }, '图片') : null,
  ].filter(Boolean);

  return h(Row, {
    name: model.name, tags, meta: model.id, off: !model.enabled,
    switchControl: h(Switch, { checked: model.enabled, disabled: busy, label: `启用 ${model.name}`, onChange: () => void store.toggleModel(model.id, !model.enabled) }),
    moreLabel: '默认设置', expanded: open, onToggle: () => setOpen(value => !value),
    detail: h('div', { className: 'kiro-form' },
      h('label', { className: 'kiro-field' }, '默认思考档位',
        h('select', { className: 'kiro-select', value: effort, disabled: busy || !model.efforts?.length, onChange: event => setEffort(event.target.value) },
          h('option', { value: '' }, '未设置'),
          (model.efforts ?? []).map(id => h('option', { key: id, value: id }, EFFORT_LABELS[id] ?? id)))),
      h('label', { className: 'kiro-field' }, '默认输出上限',
        h('input', {
          className: 'kiro-input', type: 'number', inputMode: 'numeric', value: maxTokens, disabled: busy || !range,
          min: range?.min, max: range?.max, placeholder: range ? `${range.min}–${range.max}，留空为未设置` : '该模型未公布可调范围',
          onChange: event => setMaxTokens(event.target.value),
        })),
      h('div', { className: 'kiro-actions' },
        button('保存默认设置', () => void store.saveModelSettings(model.id, effort, tokens), busy || unchanged || !tokensValid, 'primary')),
      h('p', { className: 'kiro-muted' }, '默认设置只填充调用时未显式指定的参数；CLI 连接不支持输出上限。')),
  });
}