// 连接方式面板：折叠区承载 OAuth 之外的五种连接。草稿本地持有，保存经 Config Editor。
export function ConnectionPanel({ state, store, formId }) {
  const { view, busy } = state;
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ mode: view.mode, keyRef: view.keyRef, region: view.region });

  React.useEffect(() => {
    setDraft({ mode: view.mode, keyRef: view.keyRef, region: view.region });
  }, [view.mode, view.keyRef, view.region]);

  const unchanged = draft.mode === view.mode && draft.keyRef === view.keyRef && (draft.mode !== 'direct' || draft.region === view.region);
  const setMode = mode => {
    const keyRef = mode === 'session' && draft.keyRef === 'KIRO_API_KEY' ? 'KIRO_SESSION'
      : mode !== 'session' && draft.keyRef === 'KIRO_SESSION' ? 'KIRO_API_KEY' : draft.keyRef;
    setDraft({ ...draft, mode, keyRef });
  };
  const hints = {
    oauth: '使用上方浏览器登录入口完成授权，授权成功后连接方式自动切换。',
    direct: '在 Kiro 账户页生成 API Key，保存在 DSH 凭据中，然后刷新模型。',
    session: '使用 DSH 中已配置的 Kiro 会话凭据，区域取自账号资料。会话过期后需要更新凭据。',
    local: h(React.Fragment, null, '在官方 Kiro CLI 中运行 ', h('code', null, 'kiro-cli login'), '，然后返回这里检测。已有 Hooks 或全局 MCP 时，请使用独立登录。'),
    managed: view.loginHome
      ? h(React.Fragment, null, '在终端把 ', h('code', null, 'KIRO_HOME'), ' 设为 ', h('code', { style: { overflowWrap: 'anywhere' } }, view.loginHome), '，再运行 ', h('code', null, 'kiro-cli login'), '。')
      : '保存后显示独立登录目录。',
    key: '在 DSH 凭据中保存 Kiro API Key，这里只填写引用名；Key 经子进程环境传给官方 CLI。',
  };

  return h('details', { className: 'kiro-details', open, onToggle: event => setOpen(event.currentTarget.open) },
    h('summary', null, `其他连接方式（API Key / 会话 / CLI） · 当前：${MODE_LABELS[view.mode] ?? view.mode}`),
    h('form', {
      onSubmit: event => { event.preventDefault(); void store.saveConnection(draft); },
    },
      h(ListBox, null,
        h(Row, {
          name: '连接方式',
          meta: hints[draft.mode],
          control: h('select', { id: `${formId}-mode`, className: 'kiro-select', value: draft.mode, disabled: Boolean(busy.connection), onChange: event => setMode(event.target.value) },
            Object.entries(MODE_LABELS).map(([mode, label]) => h('option', { key: mode, value: mode }, label))),
        }),
        draft.mode === 'direct' && h(Row, {
          name: 'Kiro 区域',
          meta: 'API Key 直连服务区域',
          control: h('select', { id: `${formId}-region`, className: 'kiro-select', value: draft.region, disabled: Boolean(busy.connection), onChange: event => setDraft({ ...draft, region: event.target.value }) },
            h('option', { value: 'us-east-1' }, '美国东部 · us-east-1'),
            h('option', { value: 'eu-central-1' }, '欧洲中部 · eu-central-1')),
        }),
        ['key', 'direct', 'session'].includes(draft.mode) && h(Row, {
          name: '凭据引用名',
          meta: '在 DSH 凭据管理中保存对应凭据后的键名',
          control: h('input', { id: `${formId}-key`, className: 'kiro-input kiro-input-sm', type: 'text', value: draft.keyRef, pattern: '[A-Za-z_][A-Za-z0-9_]{0,95}', title: '输入 DSH 凭据名称', required: true, disabled: Boolean(busy.connection), onChange: event => setDraft({ ...draft, keyRef: event.target.value }) }),
        })),
      h('div', { className: 'kiro-actions', style: { marginTop: '10px', justifyContent: 'flex-end' } },
        h('button', { type: 'submit', className: 'kiro-button is-primary', disabled: Boolean(busy.connection) || Boolean(busy.login) || unchanged }, '保存连接方式'))));
}