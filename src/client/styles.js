// 设置页与 pill 的样式。纪律（改这里之前先读）：
// 1. 颜色/间距/圆角/字阶只用本文件的 --kiro-* 变量，业务分支不写魔法值；
// 2. 宿主语义令牌（--dsw-alias-*）优先，本地亮/暗值只承担无宿主变量时的回退；
// 3. 间距走 4/8 网格，强调色只有一个，状态色只表达真实语义；
// 4. 重复条目用列表行，不叠卡片；动效只碰 opacity/transform/颜色并响应 reduced-motion。
export const CLIENT_STYLES = `
:where(.kiro-settings,.kiro-pill){
  --kiro-surface:var(--dsw-alias-bg-layer-1,#fff);--kiro-subtle:var(--dsw-alias-bg-layer-2,#f6f7f9);
  --kiro-hover:var(--dsw-alias-interactive-bg-hover,#edf0f4);--kiro-text:var(--dsw-alias-label-primary,#182230);
  --kiro-muted:var(--dsw-alias-label-secondary,#667085);--kiro-faint:var(--dsw-alias-label-tertiary,#98a2b3);
  --kiro-border:var(--dsw-alias-border-l3,#e2e6eb);--kiro-divider:var(--dsw-alias-border-l4,#edf0f3);
  --kiro-accent:var(--dsw-alias-brand-primary,#5b5bd6);--kiro-on-accent:var(--dsw-alias-label-primary-foreground,#fff);
  --kiro-ok:var(--dsw-alias-state-success-primary,#16835a);--kiro-warn:var(--dsw-alias-state-warn-primary,#a15c07);
  --kiro-danger:var(--dsw-alias-state-error-primary,#c43d4b);
  --kiro-s1:4px;--kiro-s2:8px;--kiro-s3:12px;--kiro-s4:16px;--kiro-s5:24px;
  --kiro-r-sm:6px;--kiro-r:12px;
  --kiro-fs-xs:11px;--kiro-fs-sm:12px;--kiro-fs:13px;--kiro-fs-lg:16px;--kiro-fs-xl:20px;
}
.kiro-settings{color-scheme:light}
body[data-ds-dark-theme] .kiro-settings{color-scheme:dark}
@media (prefers-color-scheme: dark){
  :where(.kiro-settings,.kiro-pill){
    --kiro-surface:var(--dsw-alias-bg-layer-1,#17181c);--kiro-subtle:var(--dsw-alias-bg-layer-2,#202127);
    --kiro-hover:var(--dsw-alias-interactive-bg-hover,#2a2b33);--kiro-text:var(--dsw-alias-label-primary,#e8eaef);
    --kiro-muted:var(--dsw-alias-label-secondary,#a0a6b3);--kiro-faint:var(--dsw-alias-label-tertiary,#707684);
    --kiro-border:var(--dsw-alias-border-l3,#33353d);--kiro-divider:var(--dsw-alias-border-l4,#26272e);
    --kiro-accent:var(--dsw-alias-brand-primary,#8b8bf0);--kiro-on-accent:var(--dsw-alias-label-primary-foreground,#10111a);
    --kiro-ok:var(--dsw-alias-state-success-primary,#4cc38a);--kiro-warn:var(--dsw-alias-state-warn-primary,#d99a2b);
    --kiro-danger:var(--dsw-alias-state-error-primary,#f2555a);
  }
}
.kiro-settings{display:flex;flex-direction:column;gap:var(--kiro-s4);width:100%;max-width:860px;margin:0 auto;padding:6px 2px var(--kiro-s5);min-width:0;box-sizing:border-box;container-type:inline-size;container-name:kiro;color:var(--kiro-text);font-size:var(--kiro-fs);line-height:1.55}
.kiro-settings *{box-sizing:border-box}
.kiro-settings button,.kiro-settings input,.kiro-settings select{font:inherit}
.kiro-settings button{touch-action:manipulation}
.kiro-settings :focus-visible{outline:2px solid var(--kiro-accent);outline-offset:2px}
.kiro-settings h2,.kiro-settings h3,.kiro-settings p{margin:0}
.kiro-settings input::placeholder{color:var(--kiro-faint);opacity:1}
.kiro-title{font-size:var(--kiro-fs-xl);font-weight:680;line-height:1.25;letter-spacing:-.02em}
.kiro-muted{color:var(--kiro-muted)}
.kiro-section{display:flex;flex-direction:column;gap:var(--kiro-s3);min-width:0;padding:var(--kiro-s4);border:1px solid var(--kiro-border);border-radius:var(--kiro-r);background:var(--kiro-surface)}
.kiro-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--kiro-s3);flex-wrap:wrap}
.kiro-section-title{font-size:var(--kiro-fs-lg);font-weight:640}
.kiro-summary{margin-top:2px;color:var(--kiro-muted);font-size:var(--kiro-fs-sm);overflow-wrap:anywhere}
.kiro-actions{display:flex;align-items:center;gap:var(--kiro-s2);flex-wrap:wrap}
.kiro-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 11px;border:1px solid var(--kiro-border);border-radius:var(--kiro-r-sm);background:var(--kiro-surface);color:var(--kiro-text);cursor:pointer;font-size:var(--kiro-fs-sm);font-weight:560;line-height:1.4;white-space:nowrap;transition:background .14s ease,border-color .14s ease,color .14s ease}
.kiro-button:hover:not(:disabled){border-color:color-mix(in srgb,var(--kiro-accent) 40%,var(--kiro-border));background:var(--kiro-subtle)}
.kiro-button:active:not(:disabled){transform:translateY(.5px)}
.kiro-button:disabled{opacity:.45;cursor:not-allowed}
.kiro-button.is-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--kiro-accent));color:var(--kiro-on-accent);font-weight:620}
.kiro-button.is-primary:hover:not(:disabled){background:color-mix(in srgb,var(--kiro-accent) 88%,var(--kiro-text))}
.kiro-button.is-quiet{border-color:transparent;background:transparent;color:var(--kiro-muted)}
.kiro-button.is-quiet:hover:not(:disabled){border-color:var(--kiro-border);background:var(--kiro-surface);color:var(--kiro-text)}
.kiro-list{display:flex;flex-direction:column;border:1px solid var(--kiro-divider);border-radius:var(--kiro-r-sm);overflow:hidden}
.kiro-row{display:flex;align-items:center;gap:var(--kiro-s3);padding:var(--kiro-s2) var(--kiro-s3);background:var(--kiro-surface);flex-wrap:wrap}
.kiro-row + .kiro-row{border-top:1px solid var(--kiro-divider)}
.kiro-row[data-off=true] .kiro-row-name{color:var(--kiro-faint)}
.kiro-row-main{display:flex;align-items:center;gap:var(--kiro-s2);flex:1 1 12rem;min-width:0}
.kiro-row-copy{display:flex;flex-direction:column;gap:1px;min-width:0}
.kiro-row-head{display:flex;align-items:center;gap:var(--kiro-s2);flex-wrap:wrap;min-width:0}
.kiro-row-name{font-weight:580;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kiro-row-meta{color:var(--kiro-faint);font-size:var(--kiro-fs-xs);overflow-wrap:anywhere}
.kiro-row-detail{flex-basis:100%;display:flex;flex-direction:column;gap:var(--kiro-s2);padding:var(--kiro-s2) 0 var(--kiro-s1)}
.kiro-more{border:0;background:none;padding:2px 4px;color:var(--kiro-muted);cursor:pointer;font-size:var(--kiro-fs-sm);font-weight:560}
.kiro-more:hover{color:var(--kiro-accent)}
.kiro-switch{position:relative;flex:none;width:34px;height:20px;padding:0;border:1px solid var(--kiro-border);border-radius:999px;background:var(--kiro-subtle);cursor:pointer;transition:background .14s ease,border-color .14s ease}
.kiro-switch[aria-checked=true]{background:var(--kiro-accent);border-color:transparent}
.kiro-switch:disabled{opacity:.45;cursor:not-allowed}
.kiro-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--kiro-surface);box-shadow:0 1px 2px rgba(16,24,40,.2);transition:transform .14s ease}
.kiro-switch[aria-checked=true] .kiro-switch-knob{transform:translateX(14px)}
.kiro-chip{display:inline-flex;align-items:center;padding:1px 7px;border-radius:999px;background:var(--kiro-subtle);color:var(--kiro-muted);font-size:var(--kiro-fs-xs);font-weight:560;white-space:nowrap;font-variant-numeric:tabular-nums}
.kiro-chip[data-tone=accent]{background:color-mix(in srgb,var(--kiro-accent) 12%,var(--kiro-surface));color:var(--kiro-accent)}
.kiro-chip[data-tone=ok]{background:color-mix(in srgb,var(--kiro-ok) 12%,var(--kiro-surface));color:var(--kiro-ok)}
.kiro-chip[data-tone=warn]{background:color-mix(in srgb,var(--kiro-warn) 14%,var(--kiro-surface));color:var(--kiro-warn)}
.kiro-chip[data-tone=danger]{background:color-mix(in srgb,var(--kiro-danger) 12%,var(--kiro-surface));color:var(--kiro-danger)}
.kiro-tabs{display:flex;gap:var(--kiro-s1);overflow-x:auto;border-bottom:1px solid var(--kiro-divider);padding-bottom:var(--kiro-s1)}
.kiro-tab{flex:none;padding:6px 12px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--kiro-muted);cursor:pointer;font-size:var(--kiro-fs);font-weight:580;white-space:nowrap;transition:background .14s ease,color .14s ease,border-color .14s ease}
.kiro-tab:hover{background:var(--kiro-subtle);color:var(--kiro-text)}
.kiro-tab[aria-selected=true]{color:var(--kiro-text);border-color:var(--kiro-border);background:var(--kiro-surface);font-weight:640}
.kiro-panel{display:flex;flex-direction:column;gap:var(--kiro-s4);min-width:0}
.kiro-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--kiro-s3)}
.kiro-card{display:flex;flex-direction:column;gap:var(--kiro-s2);min-width:0;padding:var(--kiro-s4);border:1px solid var(--kiro-divider);border-radius:var(--kiro-r);background:var(--kiro-subtle)}
.kiro-card[data-aside=true]{opacity:.8}
.kiro-card-name{color:var(--kiro-muted);font-size:var(--kiro-fs-sm);font-weight:580}
.kiro-card-value{font-size:var(--kiro-fs-lg);font-weight:660;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.kiro-card-value small{color:var(--kiro-muted);font-size:var(--kiro-fs-sm);font-weight:500}
.kiro-card-reset{color:var(--kiro-faint);font-size:var(--kiro-fs-xs)}
.kiro-search{width:100%;min-height:32px;padding:6px 10px;border:1px solid var(--kiro-border);border-radius:var(--kiro-r-sm);background:var(--kiro-surface);color:var(--kiro-text);font-size:var(--kiro-fs-sm)}
.kiro-field-error{color:var(--kiro-danger);font-size:var(--kiro-fs-xs)}
.kiro-meta{display:flex;flex-wrap:wrap;gap:var(--kiro-s2) var(--kiro-s4);margin:0;color:var(--kiro-faint);font-size:var(--kiro-fs-xs)}
.kiro-meta div{display:flex;gap:var(--kiro-s1)}
.kiro-meta dt{font-weight:560}
.kiro-meta dd{margin:0;font-variant-numeric:tabular-nums}
.kiro-notice{display:flex;align-items:flex-start;gap:var(--kiro-s2);padding:var(--kiro-s2) var(--kiro-s3);border-radius:var(--kiro-r-sm);font-size:var(--kiro-fs-sm);overflow-wrap:anywhere}
.kiro-notice[data-kind=warn]{background:color-mix(in srgb,var(--kiro-warn) 10%,var(--kiro-surface));color:var(--kiro-warn)}
.kiro-notice[data-kind=error]{background:color-mix(in srgb,var(--kiro-danger) 10%,var(--kiro-surface));color:var(--kiro-danger)}
.kiro-notice[data-kind=ok]{background:color-mix(in srgb,var(--kiro-ok) 10%,var(--kiro-surface));color:var(--kiro-ok)}
.kiro-empty{color:var(--kiro-muted);font-size:var(--kiro-fs-sm);padding:var(--kiro-s2) 0}
.kiro-meter{position:relative;height:6px;border-radius:999px;background:var(--kiro-subtle);overflow:hidden}
.kiro-meter-fill{display:block;height:100%;border-radius:999px;background:var(--kiro-accent);transition:width .2s ease}
.kiro-meter-fill[data-high=true]{background:var(--kiro-warn)}
.kiro-meter-fill[data-full=true]{background:var(--kiro-danger)}
.kiro-window{display:flex;flex-direction:column;gap:var(--kiro-s1);padding:var(--kiro-s2) var(--kiro-s3)}
.kiro-window + .kiro-window{border-top:1px solid var(--kiro-divider)}
.kiro-window[data-aside=true]{opacity:.75}
.kiro-window-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--kiro-s2)}
.kiro-window-name{font-weight:580;font-size:var(--kiro-fs-sm)}
.kiro-window-count{color:var(--kiro-muted);font-size:var(--kiro-fs-sm);font-variant-numeric:tabular-nums}
.kiro-window-reset{color:var(--kiro-faint);font-size:var(--kiro-fs-xs)}
.kiro-form{display:flex;flex-direction:column;gap:var(--kiro-s2);padding:var(--kiro-s3);border:1px solid var(--kiro-divider);border-radius:var(--kiro-r-sm);background:var(--kiro-subtle)}
.kiro-field{display:flex;align-items:center;gap:var(--kiro-s2);flex-wrap:wrap;font-size:var(--kiro-fs-sm);color:var(--kiro-muted)}
.kiro-input,.kiro-select{min-height:30px;padding:5px 9px;border:1px solid var(--kiro-border);border-radius:var(--kiro-r-sm);background:var(--kiro-surface);color:var(--kiro-text);font-size:var(--kiro-fs-sm)}
.kiro-input{width:min(100%,26rem)}
.kiro-input:disabled,.kiro-select:disabled{opacity:.55}
.kiro-details{border:1px solid var(--kiro-border);border-radius:var(--kiro-r);background:var(--kiro-surface);padding:var(--kiro-s3) var(--kiro-s4)}
.kiro-details summary{cursor:pointer;font-weight:620;color:var(--kiro-muted)}
.kiro-details[open] summary{margin-bottom:var(--kiro-s3)}
.kiro-login-state{display:flex;flex-direction:column;gap:var(--kiro-s1);padding:var(--kiro-s3);border:1px dashed var(--kiro-border);border-radius:var(--kiro-r-sm);font-size:var(--kiro-fs-sm)}
.kiro-login-state a{color:var(--kiro-accent)}
.kiro-footer{color:var(--kiro-faint);font-size:var(--kiro-fs-sm)}
.kiro-footer a{color:var(--kiro-muted)}
.kiro-footer a:hover{color:var(--kiro-accent)}
.kiro-pill{display:inline-flex;align-items:center;gap:var(--kiro-s1);color:var(--kiro-muted);font-size:var(--kiro-fs-xs);white-space:nowrap}
.kiro-pill-context{font-variant-numeric:tabular-nums}
.kiro-pill-tier{min-height:22px;padding:1px 7px;border:1px solid var(--kiro-border);border-radius:999px;background:var(--kiro-surface);color:var(--kiro-muted);cursor:pointer;font-size:var(--kiro-fs-xs);font-weight:560;transition:background .14s ease,color .14s ease,border-color .14s ease}
.kiro-pill-tier:hover:not(:disabled){background:var(--kiro-subtle);color:var(--kiro-text)}
.kiro-pill-tier[aria-pressed=true]{border-color:transparent;background:var(--kiro-accent);color:var(--kiro-on-accent)}
.kiro-pill-tier:disabled{opacity:.45;cursor:not-allowed}
.kiro-pill-error{color:var(--kiro-danger)}
@container kiro (max-width: 560px){
  .kiro-section{padding:var(--kiro-s3)}
  .kiro-section-head{flex-direction:column}
  .kiro-row{gap:var(--kiro-s2)}
  .kiro-input{width:100%}
  .kiro-cards{grid-template-columns:1fr}
}
@media (prefers-reduced-motion: reduce){
  .kiro-settings *,.kiro-pill *{transition:none !important}
}
`;

// One <style> per document; instance counting keeps it alive while any slot uses it.
export function installStyles() {
  if (typeof document === 'undefined') return () => {};
  let style = document.querySelector('style[data-kiro-provider]');
  if (!style) {
    style = document.createElement('style');
    style.dataset.kiroProvider = '';
    style.dataset.kiroActive = '0';
    style.textContent = CLIENT_STYLES;
    document.head.appendChild(style);
  }
  style.dataset.kiroActive = String(Number(style.dataset.kiroActive) + 1);
  return () => {
    const left = Number(style.dataset.kiroActive) - 1;
    if (left <= 0) style.remove();
    else style.dataset.kiroActive = String(left);
  };
}