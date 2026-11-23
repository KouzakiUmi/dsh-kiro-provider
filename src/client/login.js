// 登录面板：三种浏览器登录入口 + 组织 Start URL 表单 + 登录进度。
// 组织表单的草稿是面板本地状态；登录任务状态来自 store 快照。
export function LoginPanel({ state, store, formId }) {
  const [orgForm, setOrgForm] = React.useState(false);
  const [orgUrl, setOrgUrl] = React.useState('');
  const [orgRegion, setOrgRegion] = React.useState('us-east-1');
  const { view, login, busy } = state;
  const logging = LOGIN_ACTIVE.includes(login.phase);
  const disabled = Boolean(busy.login) || logging;
  const connected = view.oauthConnected === true;
  const oauthMode = view.mode === 'oauth';

  React.useEffect(() => { if (login.phase === 'succeeded') setOrgForm(false); }, [login.phase]);

  const summary = connected
    ? (oauthMode ? '已保存 Kiro 浏览器授权。如需重新登录，可从下方选择登录方式。' : `已保存 Kiro 浏览器授权，当前使用「${MODE_LABELS[view.mode] ?? view.mode}」。`)
    : (oauthMode ? '尚未完成浏览器登录，请选择方式开始。' : '推荐使用浏览器登录；当前使用其他连接方式，可在下方折叠区修改。');

  return h(Section, {
    title: '浏览器登录（OAuth）',
    actions: connected ? button('断开浏览器登录', () => void store.logout(), disabled, 'quiet') : null,
  },
    h(StatusBanner, {
      tone: connected ? 'ok' : oauthMode ? 'warn' : 'neutral',
      icon: connected ? '✓' : '!',
      title: connected ? '已保存浏览器登录授权' : oauthMode ? '尚未完成浏览器登录' : '浏览器登录（推荐）',
      subtitle: summary,
    }),
    h(ListBox, null,
      h(Row, {
        name: 'Kiro 登录页',
        tags: h(Chip, { tone: 'accent' }, '推荐'),
        meta: '使用个人 Kiro / Social 账号直接授权登录。',
        control: button('Kiro 登录页', () => void store.startLogin('portal'), disabled, 'primary'),
      }),
      h(Row, {
        name: 'AWS Builder ID',
        meta: '使用个人 AWS Builder ID 账户登录。',
        control: button('AWS Builder ID', () => void store.startLogin('builder'), disabled),
      }),
      h(Row, {
        name: 'IAM Identity Center（组织 Start URL）',
        meta: '企业或组织 SSO 登录，需填写 Start URL 与 AWS 区域。',
        control: button('IAM Identity Center（组织 Start URL）', () => setOrgForm(value => !value), disabled),
        expanded: orgForm,
        detail: h('form', {
          onSubmit: event => { event.preventDefault(); void store.startLogin('organization', { url: orgUrl, region: orgRegion }); },
        },
          h('div', { className: 'kiro-detail-grid' },
            h('label', { className: 'kiro-field', htmlFor: `${formId}-org-url` }, '组织 Start URL',
              h('input', { id: `${formId}-org-url`, className: 'kiro-input', type: 'url', required: true, maxLength: 700, value: orgUrl, placeholder: 'https://your-org.awsapps.com/start', disabled, onChange: event => setOrgUrl(event.target.value) })),
            h('label', { className: 'kiro-field', htmlFor: `${formId}-org-region` }, 'AWS 区域',
              h('input', { id: `${formId}-org-region`, className: 'kiro-input', type: 'text', required: true, value: orgRegion, placeholder: 'us-east-1', pattern: '[a-z]{2}(-[a-z]+)+-[0-9]+', title: '例如 us-east-1', disabled, onChange: event => setOrgRegion(event.target.value) }))),
          h('div', { className: 'kiro-actions', style: { marginTop: '10px' } },
            h('button', { type: 'submit', className: 'kiro-button is-primary', disabled }, '开始登录'),
            button('收起', () => setOrgForm(false), Boolean(busy.login), 'quiet'))),
      })),
    (login.phase !== 'idle' || login.message) && h('div', { className: 'kiro-login-state', role: 'status' },
      login.phase !== 'idle' && h('p', null, LOGIN_PHASE_TEXT[login.phase] ?? login.phase),
      login.url && h('p', null, h('a', { href: login.url, target: '_blank', rel: 'noopener noreferrer' }, '打开浏览器完成授权'), '，然后返回 DSH。'),
      !login.url && login.phase === 'waiting' && h('p', null, '请在浏览器页面完成授权；若页面已关闭，请取消后重新发起。'),
      login.message && h('p', null, login.message),
      h('div', { className: 'kiro-actions' },
        logging && button('取消登录', () => void store.cancelLogin(), Boolean(busy.login)),
        ['failed', 'cancelled'].includes(login.phase) && login.method
          && button('重试', () => void store.startLogin(login.method, { url: orgUrl, region: orgRegion }), disabled))));
}