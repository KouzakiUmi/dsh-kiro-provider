// 设置根组件：四 tab（概览/模型/连接与登录/高级），持有 store 与生命周期效应。
const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'models', label: '模型' },
  { id: 'connection', label: '连接与登录' },
  { id: 'advanced', label: '高级' },
];

export function tabAfter(key, current) {
  const index = TABS.findIndex(tab => tab.id === current);
  if (index < 0) return null;
  if (key === 'Home') return TABS[0].id;
  if (key === 'End') return TABS[TABS.length - 1].id;
  if (key === 'ArrowRight') return TABS[(index + 1) % TABS.length].id;
  if (key === 'ArrowLeft') return TABS[(index - 1 + TABS.length) % TABS.length].id;
  return null;
}

function Overview({ state, onNavigate }) {
  const { view } = state;
  const enabledCount = (view.models ?? []).filter(m => m.enabled).length;
  const needAuth = view.mode === 'oauth' && !view.oauthConnected;
  return h(Section, { title: '连接摘要' },
    h(ListBox, null,
      h(Row, {
        name: '连接模式',
        meta: MODE_LABELS[view.mode] ?? view.mode,
        tags: h(Chip, { tone: needAuth ? 'warn' : 'ok' }, needAuth ? '待登录' : '已配置'),
        control: button(needAuth ? '前往登录' : '修改连接', () => onNavigate('connection'), false, needAuth ? 'primary' : 'sm'),
      }),
      h(Row, {
        name: '浏览器授权',
        meta: view.cliVersion ? `已检测 Kiro CLI ${view.cliVersion}` : 'OAuth / Token 管理',
        tags: h(Chip, { tone: view.oauthConnected ? 'ok' : undefined }, view.oauthConnected ? '已保存浏览器登录' : '未保存浏览器登录'),
      }),
      h(Row, {
        name: '模型目录',
        meta: view.catalogAt ? `目录更新于 ${formatWhen(view.catalogAt)}` : '目录尚未读取',
        tags: h(Chip, { tone: enabledCount ? 'accent' : undefined }, `已启用 ${enabledCount}/${view.models?.length ?? 0}`),
        control: button('管理模型', () => onNavigate('models'), false, 'sm'),
      })));
}

export function Settings({ client }) {
  const store = React.useMemo(() => createKiroStore(client.invoke), [client]);
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [tab, setTab] = React.useState('overview');
  const formId = React.useId();

  React.useEffect(() => () => store.dispose(), [store]);
  React.useEffect(() => { void store.load(); }, [store]);

  // 登录进行中每秒轮询；传输失败按退避重试，进入终态或卸载时清理。
  React.useEffect(() => {
    if (!LOGIN_ACTIVE.includes(state.login.phase)) return undefined;
    let alive = true;
    let timer = null;
    let failures = 0;
    const poll = async () => {
      const result = await store.pollLogin();
      if (!alive) return;
      if (result.ok) {
        failures = 0;
        if (LOGIN_ACTIVE.includes(result.phase)) timer = setTimeout(poll, LOGIN_POLL_MS);
      } else {
        failures += 1;
        timer = setTimeout(poll, Math.min(10_000, failures * 2000));
      }
    };
    timer = setTimeout(poll, LOGIN_POLL_MS);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [store, state.login.phase]);

  // 登录成功后 Host 已切为 oauth：重读视图并显式刷新模型。
  React.useEffect(() => {
    if (state.login.phase !== 'succeeded') return undefined;
    let alive = true;
    void (async () => {
      if (!await store.retry() || !alive) return;
      if (await store.refresh() && alive) store.setNotice('Kiro 登录成功，模型已刷新。');
    })();
    return () => { alive = false; };
  }, [store, state.login.phase]);

  // 页面可见时每 30 秒静默读一次存储视图；读操作不触发上游。
  React.useEffect(() => {
    let timer = null;
    const schedule = () => { if (!timer) timer = setTimeout(tick, READ_POLL_MS); };
    const tick = () => {
      timer = null;
      if (!document.hidden) void store.pollRead();
      schedule();
    };
    const onVisible = () => { if (!document.hidden) { void store.pollRead(); schedule(); } };
    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => { if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [store]);

  if (!state.view) {
    return h('section', { className: 'kiro-settings' },
      h('h2', { className: 'kiro-title' }, 'Kiro Provider'),
      state.alert
        ? h(Notice, { kind: 'error' }, state.alert)
        : h('p', { className: 'kiro-empty', role: 'status' }, '正在读取连接设置…'),
      state.alert && button('重试', () => void store.retry(), false));
  }

  const busyAny = Object.keys(state.busy).length > 0;
  const onTabKey = event => {
    const next = tabAfter(event.key, tab);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`${formId}-tab-${next}`)?.focus();
  };
  const modeLabel = MODE_LABELS[state.view.mode] ?? state.view.mode;
  const enabledCount = (state.view.models ?? []).filter(m => m.enabled).length;
  const ready = state.view.mode !== 'oauth' || state.view.oauthConnected;

  return h('section', { className: 'kiro-settings', 'aria-busy': busyAny || undefined, 'aria-labelledby': `${formId}-title` },
    h('div', { className: 'kiro-header' },
      h('div', { className: 'kiro-header-main' },
        h('h2', { className: 'kiro-title', id: `${formId}-title` }, 'Kiro Provider'),
        h('div', { className: 'kiro-subtitle' },
          h('span', { className: 'kiro-dot', 'data-tone': ready ? 'ok' : 'warn' }),
          h('span', null, modeLabel),
          h('span', null, `· 已启用 ${enabledCount} 个模型`))),
      !ready && tab !== 'connection' && button('前往登录', () => setTab('connection'), false, 'primary')),
    h('div', { className: 'kiro-tabs', role: 'tablist', 'aria-label': 'Kiro 设置分区', onKeyDown: onTabKey },
      TABS.map(item => h('button', {
        key: item.id, type: 'button', role: 'tab', id: `${formId}-tab-${item.id}`,
        className: 'kiro-tab', 'aria-selected': tab === item.id, 'aria-controls': `${formId}-panel-${item.id}`,
        tabIndex: tab === item.id ? 0 : -1, onClick: () => setTab(item.id),
      }, item.label))),
    h('div', { className: 'kiro-panel', role: 'tabpanel', id: `${formId}-panel-${tab}`, 'aria-labelledby': `${formId}-tab-${tab}` },
      state.notice && h(Notice, { kind: 'ok' }, state.notice),
      state.alert && h(Notice, { kind: 'error' }, state.alert),
      tab === 'overview' && h(React.Fragment, null, h(Overview, { state, onNavigate: setTab }), h(UsagePanel, { state, store })),
      tab === 'models' && h(ModelsPanel, { state, store }),
      tab === 'connection' && h(React.Fragment, null, h(LoginPanel, { state, store, formId }), h(ConnectionPanel, { state, store, formId })),
      tab === 'advanced' && h(AdvancedPanel, { state, store, formId })),
    h('p', { className: 'kiro-footer' },
      h('a', { href: 'https://kiro.dev/docs/cli/', target: '_blank', rel: 'noreferrer' }, 'Kiro CLI 安装与登录说明'), ' · ',
      h('a', { href: 'https://app.kiro.dev/', target: '_blank', rel: 'noreferrer' }, 'Kiro 账户与额度')));
}