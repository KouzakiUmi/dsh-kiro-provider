const React = require('react');
const h = React.createElement;
const stack = { display: 'grid', gap: '0.75rem', maxWidth: '44rem' };
const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' };
const control = { color: 'inherit', font: 'inherit', padding: '0.35rem 0.6rem', borderRadius: '0.4rem', border: '1px solid var(--dsw-alias-border-default, currentColor)', background: 'var(--dsw-alias-surface-default, transparent)' };
const emphasis = { ...control, fontWeight: 600 };
const modeLabels = { oauth: '浏览器登录（OAuth）', direct: 'Kiro API Key 直连', session: 'Kiro 会话凭据直连', local: '复用本机 Kiro CLI 登录', managed: 'Kiro CLI 独立登录', key: 'Kiro API Key（CLI）' };
const loginActive = ['starting', 'waiting', 'authorizing'];
const loginPollMs = 1000;
const loginPhaseText = { starting: '正在启动登录…', waiting: '等待浏览器授权…', authorizing: '正在确认授权…', succeeded: '登录成功。', cancelled: '登录已取消。', failed: '登录失败。' };

// 登录状态只保留 Host 返回的 phase/url/message；不记录 token、state 或地址内容。
function normalizeLogin(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    phase: typeof source.phase === 'string' ? source.phase : 'idle',
    url: typeof source.url === 'string' && /^https:\/\//.test(source.url) ? source.url : null,
    message: typeof source.message === 'string' ? source.message : '',
  };
}

function errorText(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Settings({ client }) {
  const [data, setData] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [alert, setAlert] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [login, setLogin] = React.useState({ phase: 'idle', url: null, message: '', method: null });
  const [orgUrl, setOrgUrl] = React.useState('');
  const [orgRegion, setOrgRegion] = React.useState('us-east-1');
  const [orgForm, setOrgForm] = React.useState(false);
  const [otherChoice, setOtherChoice] = React.useState(null);
  const revision = React.useRef(0);
  const running = React.useRef(false);
  const lastMode = React.useRef('');
  const formId = React.useId();

  function applyView(result, syncDraft) {
    if (result.mode !== lastMode.current) { lastMode.current = result.mode; setOtherChoice(null); }
    setData(result);
    if (syncDraft) setDraft({ mode: result.mode, keyRef: result.keyRef, region: result.region });
  }

  async function perform(request) {
    if (running.current) return;
    running.current = true;
    const mark = ++revision.current;
    setBusy(request.op); setNotice(''); setAlert('');
    try {
      const result = await client.invoke(request);
      if (mark !== revision.current) return;
      if (request.op === 'detect') setNotice(`${['direct', 'session', 'oauth'].includes(result.mode) ? '已连接 Kiro' : `Kiro CLI ${result.cliVersion}`} · 可见模型 ${result.modelCount} 个`);
      else {
        applyView(result, request.op === 'status' || request.op === 'connection' || request.op === 'refresh');
        if (request.op === 'connection') setNotice('连接方式已保存。可检测连接或刷新模型。');
      }
      return true;
    } catch (error) { if (mark === revision.current) setAlert(errorText(error, 'Kiro 设置请求失败，请重试。')); return false; }
    finally { if (mark === revision.current) { running.current = false; setBusy(''); } }
  }

  // 登录相关调用与连接表单共用互斥锁，但返回的是 { phase, url?, message? }，不进入连接视图。
  async function loginInvoke(request) {
    if (running.current) return null;
    running.current = true;
    const mark = ++revision.current;
    setBusy(request.op); setNotice(''); setAlert('');
    try {
      const result = await client.invoke(request);
      if (mark !== revision.current) return null;
      return result;
    } catch (error) {
      if (mark === revision.current) {
        const message = errorText(error, 'Kiro 登录请求失败，请重试。');
        if (request.op === 'loginStart') setLogin(previous => ({ ...previous, phase: 'failed', url: null, message }));
        else setAlert(message);
      }
      return null;
    } finally { if (mark === revision.current) { running.current = false; setBusy(''); } }
  }

  async function startLogin(method) {
    const request = { op: 'loginStart', method };
    if (method === 'organization') {
      const input = organizationInput(orgUrl, orgRegion);
      if (input.error) { setLogin(previous => ({ ...previous, phase: 'failed', url: null, message: input.error, method })); return; }
      request.startUrl = input.startUrl; request.awsRegion = input.awsRegion;
    }
    const result = await loginInvoke(request);
    if (result) setLogin({ ...normalizeLogin(result), method });
    else setLogin(previous => ({ ...previous, method: previous.method ?? method }));
  }

  async function cancelLogin() {
    const result = await loginInvoke({ op: 'loginCancel' });
    if (result) setLogin(previous => ({ ...normalizeLogin(result), method: previous.method }));
  }

  async function logout() {
    const result = await loginInvoke({ op: 'logout' });
    if (!result) return;
    setLogin(previous => ({ ...normalizeLogin(result), method: previous.method }));
    setNotice('已断开浏览器登录。');
    // 断开可能改变连接方式与 oauthConnected，重新读取一次视图。
    if (await perform({ op: 'status' })) setNotice('已断开浏览器登录。');
  }

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      await perform({ op: 'status' });
      try {
        const result = await client.invoke({ op: 'loginStatus' });
        if (alive) setLogin(previous => ({ ...normalizeLogin(result), method: previous.method }));
      } catch { /* 服务未就绪时保持未登录状态 */ }
    })();
    return () => { alive = false; ++revision.current; running.current = false; };
  }, [client]);

  // 登录进行中每秒轮询一次状态；进入终态或卸载时清理定时器。
  React.useEffect(() => {
    if (!loginActive.includes(login.phase)) return undefined;
    let alive = true;
    let timer = null;
    let failures = 0;
    const poll = async () => {
      try {
        const value = await client.invoke({ op: 'loginStatus' });
        if (!alive) return;
        const next = normalizeLogin(value);
        failures = 0;
        setLogin(previous => ({ ...next, url: next.phase === 'waiting' ? next.url ?? previous.url : null, method: previous.method }));
        if (loginActive.includes(next.phase)) timer = setTimeout(poll, loginPollMs);
      } catch (error) {
        if (!alive) return;
        // 传输失败不代表 Host 登录已停止：保留取消入口并按退避重试。
        setLogin(previous => ({ ...previous, message: `暂时无法查询登录进度：${errorText(error, '进度查询失败')}。将自动重试，仍可取消登录。` }));
        timer = setTimeout(poll, Math.min(10000, ++failures * 2000));
      }
    };
    timer = setTimeout(poll, loginPollMs);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [client, login.phase]);

  // 登录成功后 Host 已切为 oauth，重新读取状态并刷新模型。
  React.useEffect(() => {
    if (login.phase !== 'succeeded') return undefined;
    setOrgForm(false);
    let alive = true;
    void (async () => {
      if (!await perform({ op: 'status' }) || !alive) return;
      if (await perform({ op: 'refresh' }) && alive) setNotice('Kiro 登录成功，模型已刷新。');
    })();
    return () => { alive = false; };
  }, [client, login.phase]);

  const button = (label, op, fields = {}) => h('button', { type: 'button', style: control, disabled: Boolean(busy), onClick: () => void perform({ op, ...fields }) }, label);
  if (!data || !draft) return h('section', { style: stack },
    h('h2', null, 'Kiro Provider'), h('p', { role: alert ? 'alert' : 'status' }, alert || '正在读取连接设置…'),
    alert && button('重试', 'status'));

  const logging = loginActive.includes(login.phase);
  const connected = data.oauthConnected === true;
  const oauthMode = data.mode === 'oauth';
  const otherOpen = otherChoice ?? false;
  const unchanged = draft.mode === data.mode && draft.keyRef === data.keyRef && (draft.mode !== 'direct' || draft.region === data.region);
  return h('section', { style: stack, 'aria-busy': Boolean(busy), 'aria-labelledby': `${formId}-title` },
    h('h2', { id: `${formId}-title` }, 'Kiro Provider'),
    h('section', { style: { display: 'grid', gap: '0.5rem' }, 'aria-labelledby': `${formId}-oauth` },
       h('h3', { id: `${formId}-oauth` }, '选择登录方式'),
      h('p', null, connected
         ? (oauthMode ? '已保存 Kiro 浏览器授权。如需重新登录，可从下方选择登录方式。' : `已保存 Kiro 浏览器授权，当前使用「${modeLabels[data.mode] ?? data.mode}」。`)
        : (oauthMode ? '尚未完成浏览器登录，请选择方式开始。' : '推荐使用浏览器登录；当前使用其他连接方式，可在下方折叠区修改。')),
      connected
         && h('div', { style: row },
             h('button', { type: 'button', style: control, disabled: Boolean(busy) || logging, onClick: () => void logout() }, '断开浏览器登录')),
       h('div', { style: row },
            h('button', { type: 'button', style: emphasis, disabled: Boolean(busy) || logging, onClick: () => setOrgForm(value => !value) }, 'IAM Identity Center（组织 Start URL）'),
            h('button', { type: 'button', style: emphasis, disabled: Boolean(busy) || logging, onClick: () => void startLogin('builder') }, 'AWS Builder ID'),
            h('button', { type: 'button', style: emphasis, disabled: Boolean(busy) || logging, onClick: () => void startLogin('portal') }, 'Kiro 登录页')),
       orgForm && h('form', { style: { display: 'grid', gap: '0.5rem' }, onSubmit: event => { event.preventDefault(); void startLogin('organization'); } },
        h('label', { htmlFor: `${formId}-org-url`, style: row }, '组织 Start URL',
           h('input', { id: `${formId}-org-url`, type: 'url', required: true, maxLength: 700, value: orgUrl, placeholder: 'https://your-org.awsapps.com/start', style: { ...control, width: 'min(100%, 26rem)' }, disabled: Boolean(busy) || logging, onChange: event => setOrgUrl(event.target.value) })),
        h('label', { htmlFor: `${formId}-org-region`, style: row }, 'AWS 区域',
          h('input', { id: `${formId}-org-region`, type: 'text', required: true, value: orgRegion, placeholder: 'us-east-1', pattern: '[a-z]{2}(-[a-z]+)+-[0-9]+', title: '例如 us-east-1', style: control, disabled: Boolean(busy) || logging, onChange: event => setOrgRegion(event.target.value) })),
        h('div', { style: row },
          h('button', { type: 'submit', style: control, disabled: Boolean(busy) || logging }, '开始登录'),
          h('button', { type: 'button', style: control, disabled: Boolean(busy), onClick: () => setOrgForm(false) }, '收起'))),
      (login.phase !== 'idle' || login.message) && h('div', { role: 'status', style: { display: 'grid', gap: '0.35rem' } },
        login.phase !== 'idle' && h('p', null, loginPhaseText[login.phase] ?? login.phase),
         login.url && h('p', null, h('a', { href: login.url, target: '_blank', rel: 'noopener noreferrer' }, '打开浏览器完成授权'), '，然后返回 DSH。'),
        !login.url && login.phase === 'waiting' && h('p', null, '请在浏览器页面完成授权；若页面已关闭，请取消后重新发起。'),
        login.message && h('p', null, login.message),
        h('div', { style: row },
          logging && h('button', { type: 'button', style: control, disabled: Boolean(busy), onClick: () => void cancelLogin() }, '取消登录'),
          ['failed', 'cancelled'].includes(login.phase) && login.method && h('button', { type: 'button', style: control, disabled: Boolean(busy), onClick: () => void startLogin(login.method) }, '重试')))),
    h('details', { open: otherOpen, onToggle: event => setOtherChoice(event.currentTarget.open) },
       h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '其他登录方式'),
      h('form', { style: { ...stack, marginTop: '0.75rem' }, onSubmit: event => { event.preventDefault(); void perform({ op: 'connection', ...draft }); } },
        h('label', { htmlFor: `${formId}-mode`, style: row }, '连接方式', h('select', { id: `${formId}-mode`, value: draft.mode, style: control, disabled: Boolean(busy), onChange: e => {
          const mode = e.target.value;
          const keyRef = mode === 'session' && draft.keyRef === 'KIRO_API_KEY' ? 'KIRO_SESSION' : mode !== 'session' && draft.keyRef === 'KIRO_SESSION' ? 'KIRO_API_KEY' : draft.keyRef;
          setDraft({ ...draft, mode, keyRef });
        } },
          ...Object.entries(modeLabels).map(([mode, label]) => h('option', { key: mode, value: mode }, label)))),
        draft.mode === 'direct' && h('label', { htmlFor: `${formId}-region`, style: row }, 'Kiro 区域', h('select', { id: `${formId}-region`, value: draft.region, style: control, disabled: Boolean(busy), onChange: e => setDraft({ ...draft, region: e.target.value }) },
          h('option', { value: 'us-east-1' }, '美国东部 · us-east-1'), h('option', { value: 'eu-central-1' }, '欧洲中部 · eu-central-1'))),
        ['key', 'direct', 'session'].includes(draft.mode) && h('label', { htmlFor: `${formId}-key`, style: row }, '凭据引用名', h('input', { id: `${formId}-key`, type: 'text', value: draft.keyRef, style: control, pattern: '[A-Za-z_][A-Za-z0-9_]{0,95}', title: '输入 DSH 凭据名称', required: true, disabled: Boolean(busy), onChange: e => setDraft({ ...draft, keyRef: e.target.value }) })),
        draft.mode === 'oauth' && h('p', null, '使用上方浏览器登录入口完成授权，授权成功后连接方式自动切换。'),
        draft.mode === 'direct' && h('p', null, '在 Kiro 账户页生成 API Key，保存在 DSH 凭据中，然后刷新模型。'),
        draft.mode === 'session' && h('p', null, '使用 DSH 中已配置的 Kiro 会话凭据，区域取自账号资料。会话过期后需要更新凭据。'),
        draft.mode === 'local' && h('p', null, '在官方 Kiro CLI 中运行 ', h('code', null, 'kiro-cli login'), '，然后返回这里检测。已有 Hooks 或全局 MCP 时，请使用独立登录。'),
        draft.mode === 'managed' && h('p', null, data.loginHome
          ? h(React.Fragment, null, '在终端把 ', h('code', null, 'KIRO_HOME'), ' 设为 ', h('code', { style: { overflowWrap: 'anywhere' } }, data.loginHome), '，再运行 ', h('code', null, 'kiro-cli login'), '。')
          : '保存后显示独立登录目录。'),
         h('div', { style: row }, h('button', { type: 'submit', style: control, disabled: Boolean(busy) || logging || unchanged }, '保存连接方式')))),
    h('div', { role: 'status' }, notice || (busy ? '正在处理…' : data.cliVersion ? `Kiro CLI ${data.cliVersion}` : '尚未刷新模型')),
    alert && h('p', { role: 'alert' }, alert),
    h('h3', null, '模型目录'),
    !logging && (!oauthMode || connected) && h('div', { style: row }, button('检测连接', 'detect'), button('刷新模型', 'refresh')),
    data.modelError && data.modelError !== alert && h('p', { role: 'status' }, data.modelError),
    data.models.length === 0 ? h('p', null, '还没有读取到模型。完成登录后点击刷新模型。') :
      h('ul', null, ...data.models.map(model => h('li', { key: model.id }, h('label', { title: model.id },
        h('input', { type: 'checkbox', checked: model.enabled, disabled: Boolean(busy), onChange: event => void perform({ op: 'model', id: model.id, enabled: event.target.checked }) }),
        ' ', model.name, model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} 上下文` : '')))),
    h('p', null, h('a', { href: 'https://kiro.dev/docs/cli/', target: '_blank', rel: 'noreferrer' }, 'Kiro CLI 安装与登录说明'), ' · ',
      h('a', { href: 'https://app.kiro.dev/', target: '_blank', rel: 'noreferrer' }, 'Kiro 账户与额度')));
}

export const name = pluginId;
export const inject = ['slots', 'remote'];
export function apply(ctx) {
  let service;
  let unmount;
  let disposed = false;
  Promise.resolve(ctx.remote.$mount(kiroRemote)).then(dispose => { if (disposed) dispose?.(); else unmount = dispose; }, () => {});
  ctx.inject(['remote.kiroProvider'], scope => scope.effect(() => {
    service = scope.get('remote.kiroProvider');
    return () => { service = undefined; };
  }));
  const client = { async invoke(req) {
    const remote = service ?? ctx.get('remote.kiroProvider');
    if (disposed || !remote) throw new Error('Kiro 设置服务未就绪，请重试。');
    return readSettingsReply(await remote.invoke(req), req.op);
  } };
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'kiro-provider', order: 26,
    label: () => 'Kiro Provider', inject: () => ({ client }),
  }, Settings));
  ctx.effect(() => () => { disposed = true; unmount?.(); });
}
