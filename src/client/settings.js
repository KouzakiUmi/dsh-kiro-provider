// 设置根组件：持有 store 与生命周期效应，面板只消费快照与动作。
export function Settings({ client }) {
  const store = React.useMemo(() => createKiroStore(client.invoke), [client]);
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
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
  return h('section', { className: 'kiro-settings', 'aria-busy': busyAny || undefined, 'aria-labelledby': `${formId}-title` },
    h('h2', { className: 'kiro-title', id: `${formId}-title` }, 'Kiro Provider'),
    h(LoginPanel, { state, store, formId }),
    h(ConnectionPanel, { state, store, formId }),
    state.notice && h(Notice, { kind: 'ok' }, state.notice),
    state.alert && h(Notice, { kind: 'error' }, state.alert),
    renderUsage(state, store),
    renderModels(state, store),
    h('p', { className: 'kiro-footer' },
      h('a', { href: 'https://kiro.dev/docs/cli/', target: '_blank', rel: 'noreferrer' }, 'Kiro CLI 安装与登录说明'), ' · ',
      h('a', { href: 'https://app.kiro.dev/', target: '_blank', rel: 'noreferrer' }, 'Kiro 账户与额度')));
}