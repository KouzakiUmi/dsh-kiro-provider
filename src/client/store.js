// Client 状态中间件：设置视图的唯一真源。面板从快照渲染，全部 RPC 经 perform/loginInvoke
// 的分域单飞锁与序号票，过期响应不会覆盖新状态；读操作永不触发上游（Host 负责补采）。
export const LOGIN_ACTIVE = ['starting', 'waiting', 'authorizing'];
export const LOGIN_POLL_MS = 1000;
export const READ_POLL_MS = 30_000;
export const MODE_LABELS = {
  oauth: '浏览器登录（OAuth）', direct: 'Kiro API Key 直连', session: 'Kiro 会话凭据直连',
  local: '复用本机 Kiro CLI 登录', managed: 'Kiro CLI 独立登录', key: 'Kiro API Key（CLI）',
};
export const LOGIN_PHASE_TEXT = {
  starting: '正在启动登录…', waiting: '等待浏览器授权…', authorizing: '正在确认授权…',
  succeeded: '登录成功。', cancelled: '登录已取消。', failed: '登录失败。',
};

// 登录状态只保留 Host 返回的 phase/url/message；不记录 token、state 或地址内容。
export function normalizeLogin(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    phase: typeof source.phase === 'string' ? source.phase : 'idle',
    url: typeof source.url === 'string' && /^https:\/\//.test(source.url) ? source.url : null,
    message: typeof source.message === 'string' ? source.message : '',
  };
}

// 鸭子类型取错误文案：跨 realm 的 Error 实例 instanceof 会失效，message 字符串才是可靠信号。
const errorText = (error, fallback) => error && typeof error.message === 'string' && error.message ? error.message : fallback;

// 写操作的乐观投影：立即反映到视图，失败时回滚到写前快照。
const WRITE_PROJECT = {
  connection: (view, r) => ({ ...view, mode: r.mode, keyRef: r.keyRef, ...(r.region ? { region: r.region } : {}) }),
  model: (view, r) => ({ ...view, models: view.models.map(m => m.id === r.id ? { ...m, enabled: r.enabled } : m) }),
  modelSettings: (view, r) => ({
    ...view,
    modelDefaults: [...view.modelDefaults.filter(d => d.id !== r.id),
      ...(r.effort || r.maxTokens || r.contextTier ? [{ id: r.id, ...(r.effort ? { effort: r.effort } : {}), ...(r.maxTokens ? { maxTokens: r.maxTokens } : {}),
        ...(r.contextTier ? { contextTier: r.contextTier } : {}) }] : [])],
  }),
  modelContext: (view, r) => ({
    ...view,
    modelDefaults: [...view.modelDefaults.filter(d => d.id !== r.id),
      ...(() => {
        const prev = view.modelDefaults.find(d => d.id === r.id);
        const next = { id: r.id, ...(prev?.effort ? { effort: prev.effort } : {}), ...(prev?.maxTokens ? { maxTokens: prev.maxTokens } : {}),
          ...(r.contextTier ? { contextTier: r.contextTier } : {}) };
        return next.effort || next.maxTokens || next.contextTier ? [next] : [];
      })()],
  }),
  advanced: (view, r) => ({ ...view, advanced: { quotaRefreshSeconds: r.quotaRefreshSeconds, streamIdleTimeoutMs: r.streamIdleTimeoutMs, maxRequestImageBytes: r.maxRequestImageBytes, autoOpenBrowser: r.autoOpenBrowser } }),
  recommend: view => {
    const legacy = new Set(legacyModelIds(view.models));
    return { ...view, models: view.models.map(m => ({ ...m, enabled: !legacy.has(m.id) })) };
  },
};

export function createKiroStore(call) {
  let state = {
    view: null,
    login: { phase: 'idle', url: null, message: '', method: null },
    busy: {}, notice: '', alert: '',
  };
  const listeners = new Set();
  let viewTicket = 0;
  let loginTicket = 0;
  let viewEpoch = 0;
  let disposed = false;

  const publish = patch => {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const getSnapshot = () => state;
  const isBusy = scope => Boolean(state.busy[scope]);
  const release = scope => { const busy = { ...state.busy }; delete busy[scope]; publish({ busy }); };

  async function perform(request, scope = 'global') {
    if (disposed || isBusy(scope)) return false;
    const mark = ++viewTicket;
    const baseView = state.view;
    const project = WRITE_PROJECT[request.op];
    const optimistic = project && baseView ? project(baseView, request) : null;
    publish({ busy: { ...state.busy, [scope]: request.op }, notice: '', alert: '', ...(optimistic ? { view: optimistic } : {}) });
    try {
      const result = await call(request);
      if (disposed || mark !== viewTicket) return false;
      if (request.op === 'detect') {
        publish({ notice: `${['direct', 'session', 'oauth'].includes(result.mode) ? '已连接 Kiro' : `Kiro CLI ${result.cliVersion}`} · 可见模型 ${result.modelCount} 个` });
      } else {
        viewEpoch += 1;
        publish({ view: result });
        if (project) publish({ notice: '设置已保存。' });
        if (request.op === 'usage') publish({ notice: '额度已刷新。' });
      }
      return true;
    } catch (error) {
      if (!disposed && mark === viewTicket) {
        publish({
          alert: errorText(error, 'Kiro 设置请求失败，请重试。'),
          ...(optimistic && baseView ? { view: baseView, notice: '设置未保存，已恢复原值，请重试。' } : {}),
        });
      }
      return false;
    } finally {
      // busy 按域释放，与序号票无关：新操作作废旧响应时不能泄漏旧操作的锁。
      if (!disposed) {
        release(scope);
        // 写操作结算后向 Host 视图对齐：跨域并发下被序号票丢弃的响应由此补正。
        if (project) void pollRead();
      }
    }
  }

  // 登录调用与连接表单分域互斥；返回 { phase, url?, message? }，不进入连接视图。
  async function loginInvoke(request) {
    if (disposed || isBusy('login')) return null;
    const mark = ++loginTicket;
    publish({ busy: { ...state.busy, login: request.op }, alert: '' });
    try {
      const result = await call(request);
      if (disposed || mark !== loginTicket) return null;
      return result;
    } catch (error) {
      if (!disposed && mark === loginTicket) {
        const message = errorText(error, 'Kiro 登录请求失败，请重试。');
        if (request.op === 'loginStart') publish({ login: { ...state.login, phase: 'failed', url: null, message } });
        else publish({ alert: message });
      }
      return null;
    } finally {
      if (!disposed) release('login');
    }
  }

  async function startLogin(method, org) {
    const request = { op: 'loginStart', method };
    if (method === 'organization') {
      const input = organizationInput(org?.url, org?.region);
      if (input.error) { publish({ login: { ...state.login, phase: 'failed', url: null, message: input.error, method } }); return; }
      request.startUrl = input.startUrl;
      request.awsRegion = input.awsRegion;
    }
    const result = await loginInvoke(request);
    if (result) publish({ login: { ...normalizeLogin(result), method } });
    else publish({ login: { ...state.login, method: state.login.method ?? method } });
  }

  async function cancelLogin() {
    const result = await loginInvoke({ op: 'loginCancel' });
    if (result) publish({ login: { ...normalizeLogin(result), method: state.login.method } });
  }

  async function logout() {
    const result = await loginInvoke({ op: 'logout' });
    if (!result) return;
    publish({ login: { ...normalizeLogin(result), method: state.login.method }, notice: '已断开浏览器登录。' });
    await perform({ op: 'status' });
  }

  // 轮询不占用 busy 门；传输失败由调用方退避重试，不视为 Host 登录已停止。
  async function pollLogin() {
    try {
      const value = await call({ op: 'loginStatus' });
      if (disposed) return { ok: true, phase: 'idle' };
      const next = normalizeLogin(value);
      publish({ login: { ...next, url: next.phase === 'waiting' ? next.url ?? state.login.url : null, method: state.login.method } });
      return { ok: true, phase: next.phase };
    } catch (error) {
      if (!disposed) publish({ login: { ...state.login, message: `暂时无法查询登录进度：${errorText(error, '进度查询失败')}。将自动重试，仍可取消登录。` } });
      return { ok: false };
    }
  }

  // 静默读：只在没有写操作在途、且期间没有新视图写入时更新，不触碰 notice/alert。
  async function pollRead() {
    if (disposed || Object.keys(state.busy).length) return;
    const epoch = viewEpoch;
    try {
      const view = await call({ op: 'status' });
      if (!disposed && !Object.keys(state.busy).length && epoch === viewEpoch) publish({ view });
    } catch { /* 服务暂不可用时保留当前视图 */ }
  }

  async function load() {
    await perform({ op: 'status' });
    try {
      const value = await call({ op: 'loginStatus' });
      if (!disposed) publish({ login: { ...normalizeLogin(value), method: state.login.method } });
    } catch { /* 服务未就绪时保持未登录状态 */ }
  }

  async function detect() {
    if (await perform({ op: 'detect' }, 'catalog')) await perform({ op: 'status' }, 'catalog');
  }

  return {
    subscribe, getSnapshot, load, detect, pollLogin, pollRead, startLogin, cancelLogin, logout,
    refresh: () => perform({ op: 'refresh' }, 'catalog'),
    refreshUsage: () => perform({ op: 'usage' }, 'usage'),
    retry: () => perform({ op: 'status' }),
    saveConnection: draft => perform({ op: 'connection', ...draft }, 'connection'),
    toggleModel: (id, enabled) => perform({ op: 'model', id, enabled }, `model:${id}`),
    saveModelSettings: (id, effort, maxTokens, contextTier) => perform({ op: 'modelSettings', id, effort, maxTokens, contextTier }, `model:${id}`),
    setContextTier: (id, contextTier) => perform({ op: 'modelContext', id, contextTier }, `model:${id}`),
    saveAdvanced: draft => perform({ op: 'advanced', ...draft }, 'advanced'),
    restoreRecommended: () => perform({ op: 'recommend' }, 'catalog'),
    setNotice: notice => publish({ notice }),
    dispose() { disposed = true; listeners.clear(); },
  };
}