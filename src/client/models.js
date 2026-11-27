// 模型面板：搜索 + 启用计数 + 默认 6 条折叠 + 每模型默认设置编辑器。
// 显示名清理 ID 格式（请求 ID 保留在副行）；倍率只由徽标表达；旧版挂「旧版」标记。
export const sortModelsByEnabled = models => [...models].sort((a, b) => Number(b.enabled) - Number(a.enabled));
export const filterModels = (models, query) => {
  const q = String(query ?? '').trim().toLowerCase();
  return q ? models.filter(m => `${m.id} ${m.name ?? ''} ${readableModelName(m.id, m.name)}`.toLowerCase().includes(q)) : models;
};
const PAGE_SIZE = 6;
const RATE_TONE = { success: 'ok', info: 'accent', warning: 'warn' };

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
      button('恢复推荐', () => void store.restoreRecommended(), Boolean(busy.catalog), 'quiet'),
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
        key: model.id, model, rows: view.models, defaults: defaults.get(model.id), store,
        busy: Boolean(busy[`model:${model.id}`]) || Boolean(busy.catalog),
      }))),
    filtered.length > PAGE_SIZE
      && button(expanded ? '收起' : `展开全部 ${filtered.length} 个模型`, () => setExpanded(value => !value), false, 'quiet'));
}

function ModelRow({ model, rows, defaults, busy, store }) {
  const [open, setOpen] = React.useState(false);
  const [effort, setEffort] = React.useState(defaults?.effort ?? '');
  const [maxTokens, setMaxTokens] = React.useState(defaults?.maxTokens ? String(defaults.maxTokens) : '');
  const [contextTier, setContextTier] = React.useState(defaults?.contextTier ?? '');

  React.useEffect(() => {
    setEffort(defaults?.effort ?? '');
    setMaxTokens(defaults?.maxTokens ? String(defaults.maxTokens) : '');
    setContextTier(defaults?.contextTier ?? '');
  }, [defaults?.effort, defaults?.maxTokens, defaults?.contextTier]);

  const range = model.maxTokenRange;
  const tokens = maxTokens.trim() === '' ? 0 : Number(maxTokens);
  const tokensValid = Number.isSafeInteger(tokens) && tokens >= 0 && (!tokens || (range && tokens >= range.min && tokens <= range.max));
  const unchanged = effort === (defaults?.effort ?? '') && tokens === (defaults?.maxTokens ?? 0) && contextTier === (defaults?.contextTier ?? '');
  const displayName = readableModelName(model.id, model.name);
  const badge = modelRateBadge(model.creditRate);
  const successor = model.legacy ? legacySuccessor(rows, model.id) : null;
  const tags = [
    model.contextWindow ? h(Chip, { key: 'ctx' }, `${formatTokens(model.contextWindow)} 上下文`) : null,
    badge ? h(Chip, { key: 'rate', tone: RATE_TONE[badge.tone], title: `扣费倍率：每请求消耗 ${badge.multiplier}× credits` }, badge.label) : null,
    model.legacy ? h(Chip, { key: 'legacy', tone: 'warn', title: successor ? `已由 ${successor} 替代` : '同家族已有更新版本' }, '旧版') : null,
    model.inputModalities?.includes('image') ? h(Chip, { key: 'img' }, '图片') : null,
  ].filter(Boolean);

  return h(Row, {
    name: displayName, tags, meta: model.id, off: !model.enabled,
    switchControl: h(Switch, { checked: model.enabled, disabled: busy, label: `启用 ${displayName}`, onChange: () => void store.toggleModel(model.id, !model.enabled) }),
    moreLabel: '默认设置', expanded: open, onToggle: () => setOpen(value => !value),
    detail: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('div', { className: 'kiro-detail-grid' },
        h('label', { className: 'kiro-field' }, '上下文容量',
          h('select', { className: 'kiro-select', value: contextTier, disabled: busy || !model.contextWindow, onChange: event => setContextTier(event.target.value) },
            h('option', { value: '' }, `默认${model.contextWindow ? `（${formatTokens(model.contextWindow)}）` : ''}`),
            contextTierOptions(model.contextWindow ?? 0).map(id => h('option', { key: id, value: id }, formatTokens(CONTEXT_TIERS[id]))))),
        h('label', { className: 'kiro-field' }, '默认思考档位',
          h('select', { className: 'kiro-select', value: effort, disabled: busy || !model.efforts?.length, onChange: event => setEffort(event.target.value) },
            h('option', { value: '' }, '未设置'),
            (model.efforts ?? []).map(id => h('option', { key: id, value: id }, EFFORT_LABELS[id] ?? id)))),
        h('label', { className: 'kiro-field' }, '默认输出上限',
          h('input', {
            className: 'kiro-input', type: 'number', inputMode: 'numeric', value: maxTokens, disabled: busy || !range,
            min: range?.min, max: range?.max, placeholder: range ? `${range.min}–${range.max}，留空不设` : '未公布范围',
            onChange: event => setMaxTokens(event.target.value),
          }))),
      h('div', { className: 'kiro-actions', style: { justifyContent: 'space-between' } },
        h('span', { className: 'kiro-muted' }, '默认参数仅在未显式指定时生效；上下文容量仅影响 DSH 压缩预算。'),
        button('保存默认设置', () => void store.saveModelSettings(model.id, effort, tokens, contextTier), busy || unchanged || !tokensValid, 'primary'))),
  });
}