// 高级面板：额度刷新节奏、直连流超时与图片预算、登录自动开窗开关。
// 边界与 host 共用 remote.mjs 的 ADVANCED_BOUNDS，草稿本地持有，保存经 Config Editor。
const FIELDS = [
  { key: 'quotaRefreshSeconds', label: '额度自动刷新间隔（秒）' },
  { key: 'streamIdleTimeoutMs', label: '流空闲超时（毫秒）' },
  { key: 'maxRequestImageBytes', label: '请求图片大小上限（字节）' },
];

export function AdvancedPanel({ state, store, formId }) {
  const { view, busy } = state;
  const current = view.advanced;
  const [draft, setDraft] = React.useState(() => ({ ...current }));

  React.useEffect(() => {
    setDraft({ ...current });
  }, [current.quotaRefreshSeconds, current.streamIdleTimeoutMs, current.maxRequestImageBytes, current.autoOpenBrowser]);

  const invalid = FIELDS.some(field => numberFieldInvalid(draft[field.key], ADVANCED_BOUNDS[field.key].min, ADVANCED_BOUNDS[field.key].max));
  const unchanged = FIELDS.every(field => Number(draft[field.key]) === current[field.key]) && Boolean(draft.autoOpenBrowser) === current.autoOpenBrowser;
  const save = () => {
    if (invalid || unchanged) return;
    void store.saveAdvanced({
      quotaRefreshSeconds: Number(draft.quotaRefreshSeconds),
      streamIdleTimeoutMs: Number(draft.streamIdleTimeoutMs),
      maxRequestImageBytes: Number(draft.maxRequestImageBytes),
      autoOpenBrowser: Boolean(draft.autoOpenBrowser),
    });
  };

  return h(Section, {
    title: '高级设置',
    summary: '刷新节奏与直连请求边界；保存后立即生效。',
    actions: button('保存高级设置', save, Boolean(busy.advanced) || invalid || unchanged, 'primary'),
  },
    h(ListBox, null,
      FIELDS.map(field => {
        const bounds = ADVANCED_BOUNDS[field.key];
        return h(Row, {
          key: field.key,
          name: field.label,
          meta: `范围 ${bounds.min}–${bounds.max}`,
          control: h(NumberField, {
            id: `${formId}-${field.key}`, label: '', compact: true,
            value: draft[field.key], min: bounds.min, max: bounds.max,
            disabled: Boolean(busy.advanced), onChange: value => setDraft({ ...draft, [field.key]: value }),
          }),
        });
      }),
      h(Row, {
        name: '登录时自动打开浏览器',
        meta: '发起 OAuth 授权时自动拉起系统浏览器',
        switchControl: h(Switch, {
          checked: Boolean(draft.autoOpenBrowser), disabled: Boolean(busy.advanced),
          label: '登录时自动打开浏览器', onChange: () => setDraft({ ...draft, autoOpenBrowser: !draft.autoOpenBrowser }),
        }),
      })),
    h('p', { className: 'kiro-muted' }, '额度刷新连续失败 6 次后暂停，手动刷新成功即恢复。流超时与图片上限仅作用于直连模式。'));
}