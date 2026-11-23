// 设置页与 pill 的样式。视觉基准对齐 dsh-subusage：currentColor 透明混色层次 + 单强调色 #3b82f6 + 语义状态色。
export const CLIENT_STYLES = `
:where(.kiro-settings,.kiro-pill,.kiro-quota-pill,.kiro-quota-popover){
  --kiro-accent:#3b82f6;--kiro-on-accent:#fff;
  --kiro-ok:#22c55e;--kiro-warn:#eab308;--kiro-warn-text:#ca8a04;--kiro-tight:#f97316;--kiro-danger:#ef4444;--kiro-neutral:#94a3b8;
  --kiro-line:color-mix(in srgb,currentColor 12%,transparent);
  --kiro-line-strong:color-mix(in srgb,currentColor 20%,transparent);
  --kiro-surface:color-mix(in srgb,currentColor 4%,transparent);
  --kiro-surface-2:color-mix(in srgb,currentColor 7%,transparent);
  --kiro-muted:color-mix(in srgb,currentColor 66%,transparent);
  --kiro-faint:color-mix(in srgb,currentColor 50%,transparent);
  --kiro-s1:4px;--kiro-s2:8px;--kiro-s3:12px;--kiro-s4:16px;--kiro-s5:20px;
  --kiro-r-sm:8px;--kiro-r:12px;
  --kiro-fs-xs:11px;--kiro-fs-sm:12px;--kiro-fs:13px;--kiro-fs-lg:15px;--kiro-fs-xl:20px;
}
.kiro-settings{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;margin:0 auto;padding:6px 2px var(--kiro-s5);min-width:0;box-sizing:border-box;container-type:inline-size;container-name:kiro;color:var(--dsw-alias-label-primary,CanvasText);color-scheme:light;font-size:var(--kiro-fs);line-height:1.5}
:where(body[data-ds-dark-theme],.dark,[data-theme=dark],[data-color-scheme=dark]) :is(.kiro-settings,.kiro-pill,.kiro-quota-pill,.kiro-quota-popover),:is(.kiro-settings,.kiro-pill,.kiro-quota-pill,.kiro-quota-popover):where(.dark,[data-theme=dark],[data-color-scheme=dark]){color-scheme:dark;--kiro-warn-text:#eab308}
@media (prefers-color-scheme:dark){
  :where(:root:not(.light,[data-theme=light],[data-color-scheme=light])) :is(.kiro-settings,.kiro-pill,.kiro-quota-pill,.kiro-quota-popover){color-scheme:dark;--kiro-warn-text:#eab308}
}
.kiro-settings *,.kiro-quota-pill *,.kiro-quota-popover *{box-sizing:border-box}
.kiro-settings button,.kiro-settings input,.kiro-settings select,.kiro-quota-pill button,.kiro-quota-popover button{font:inherit;color:inherit}
.kiro-settings button,.kiro-quota-pill button,.kiro-quota-popover button{touch-action:manipulation}
.kiro-settings :focus-visible,.kiro-pill :focus-visible,.kiro-quota-pill :focus-visible,.kiro-quota-popover :focus-visible{outline:2px solid var(--kiro-accent);outline-offset:2px}
.kiro-settings h2,.kiro-settings h3,.kiro-settings p,.kiro-quota-popover p{margin:0}
.kiro-settings input::placeholder{color:var(--kiro-faint);opacity:1}
.kiro-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.kiro-header-main{display:flex;flex-direction:column;gap:3px;min-width:0}
.kiro-title{font-size:var(--kiro-fs-xl);font-weight:700;line-height:1.2;letter-spacing:-.02em}
.kiro-subtitle{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--kiro-muted);font-size:var(--kiro-fs-sm)}
.kiro-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;background:var(--kiro-neutral)}
.kiro-dot[data-tone=ok]{background:var(--kiro-ok)}
.kiro-dot[data-tone=warn]{background:var(--kiro-warn)}
.kiro-dot[data-tone=danger]{background:var(--kiro-danger)}
.kiro-dot[data-tone=accent]{background:var(--kiro-accent)}
.kiro-muted{color:var(--kiro-muted);font-size:var(--kiro-fs-sm)}
.kiro-section{display:flex;flex-direction:column;gap:8px;min-width:0}
.kiro-section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--kiro-s2);flex-wrap:wrap;min-height:24px}
.kiro-section-title{font-size:12px;font-weight:600;letter-spacing:.01em;color:var(--kiro-muted)}
.kiro-summary{margin-top:2px;color:var(--kiro-faint);font-size:var(--kiro-fs-sm);overflow-wrap:anywhere}
.kiro-actions{display:flex;align-items:center;gap:var(--kiro-s2);flex-wrap:wrap}
.kiro-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:4px 12px;border:1px solid var(--kiro-line-strong);border-radius:var(--kiro-r-sm);background:transparent;color:inherit;text-decoration:none;cursor:pointer;font-size:12.5px;font-weight:500;line-height:1.4;white-space:nowrap;transition:background .14s ease,border-color .14s ease,opacity .14s ease}
.kiro-button:hover:not(:disabled){background:var(--kiro-surface-2);border-color:color-mix(in srgb,currentColor 32%,transparent)}
.kiro-button:disabled{opacity:.42;cursor:not-allowed}
.kiro-button.is-primary{border-color:var(--kiro-accent);background:var(--kiro-accent);color:var(--kiro-on-accent)}
.kiro-button.is-primary:hover:not(:disabled){filter:brightness(1.06);background:var(--kiro-accent)}
.kiro-button.is-quiet{border-color:transparent;background:transparent;color:var(--kiro-muted)}
.kiro-button.is-quiet:hover:not(:disabled){background:var(--kiro-surface-2);color:inherit}
.kiro-button.is-sm{min-height:24px;padding:2px 9px;font-size:12px}
.kiro-list{display:flex;flex-direction:column;border:1px solid var(--kiro-line);border-radius:var(--kiro-r);background:var(--kiro-surface);overflow:hidden}
.kiro-row{display:flex;align-items:center;justify-content:space-between;gap:var(--kiro-s3);min-height:44px;padding:10px 14px;background:transparent;flex-wrap:wrap}
.kiro-row + .kiro-row{border-top:1px solid var(--kiro-line)}
.kiro-row[data-off=true] .kiro-row-name{opacity:.52}
.kiro-row-main{display:flex;align-items:center;gap:var(--kiro-s2);flex:1 1 13rem;min-width:0}
.kiro-row-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.kiro-row-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.kiro-row-name{font-size:13px;font-weight:560;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.kiro-row-meta{color:var(--kiro-faint);font-size:11.5px;overflow-wrap:anywhere}
.kiro-row-control{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
.kiro-row-detail{flex-basis:100%;display:flex;flex-direction:column;gap:10px;border-top:1px dashed var(--kiro-line);border-left:2px solid color-mix(in srgb,var(--kiro-accent) 55%,transparent);padding:10px 0 2px 12px;margin-top:4px}
.kiro-more{border:0;background:none;padding:2px 6px;border-radius:6px;color:var(--kiro-muted);cursor:pointer;font-size:12px;font-weight:500}
.kiro-more:hover{background:var(--kiro-surface-2);color:var(--kiro-accent)}
.kiro-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;background:var(--kiro-line-strong);cursor:pointer;transition:background .15s ease}
.kiro-switch[aria-checked=true]{background:var(--kiro-accent)}
.kiro-switch:disabled{opacity:.42;cursor:not-allowed}
.kiro-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.kiro-switch[aria-checked=true] .kiro-switch-knob{transform:translateX(16px)}
.kiro-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;background:var(--kiro-surface-2);color:var(--kiro-muted);font-size:11px;font-weight:560;white-space:nowrap;font-variant-numeric:tabular-nums}
.kiro-chip[data-tone=accent]{background:color-mix(in srgb,var(--kiro-accent) 14%,transparent);color:var(--kiro-accent)}
.kiro-chip[data-tone=ok]{background:color-mix(in srgb,var(--kiro-ok) 14%,transparent);color:var(--kiro-ok)}
.kiro-chip[data-tone=warn]{background:color-mix(in srgb,var(--kiro-warn) 14%,transparent);color:var(--kiro-warn-text)}
.kiro-chip[data-tone=danger]{background:color-mix(in srgb,var(--kiro-danger) 14%,transparent);color:var(--kiro-danger)}
.kiro-tabs{display:flex;gap:2px;overflow-x:auto;border-bottom:1px solid var(--kiro-line);margin-bottom:2px}
.kiro-tab{flex:none;min-height:34px;padding:6px 12px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;border-radius:8px 8px 0 0;background:transparent;color:inherit;opacity:.68;cursor:pointer;font-size:13px;font-weight:500;white-space:nowrap;transition:opacity .14s ease,border-color .14s ease,background .14s ease}
.kiro-tab:hover{opacity:.95;background:var(--kiro-surface)}
.kiro-tab[aria-selected=true]{opacity:1;font-weight:600;border-bottom-color:var(--kiro-accent)}
.kiro-panel{display:flex;flex-direction:column;gap:14px;min-width:0}
.kiro-banner{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;background:color-mix(in srgb,var(--kiro-tone,var(--kiro-neutral)) 10%,transparent);border:1px solid color-mix(in srgb,var(--kiro-tone,var(--kiro-neutral)) 28%,transparent)}
.kiro-banner[data-tone=ok]{--kiro-tone:var(--kiro-ok)}
.kiro-banner[data-tone=warn]{--kiro-tone:var(--kiro-warn)}
.kiro-banner[data-tone=danger]{--kiro-tone:var(--kiro-danger)}
.kiro-banner[data-tone=accent]{--kiro-tone:var(--kiro-accent)}
.kiro-banner-icon{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:var(--kiro-tone,var(--kiro-neutral));color:#fff;font-size:14px;font-weight:700;flex:none}
.kiro-banner[data-tone=warn] .kiro-banner-icon{color:#1f1300}
.kiro-banner-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.kiro-banner-title{font-size:14px;font-weight:700;line-height:1.25}
.kiro-banner-sub{font-size:11.5px;opacity:.75;overflow-wrap:anywhere}
.kiro-window-list{display:flex;flex-direction:column;gap:10px}
.kiro-card{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,currentColor 5%,transparent)}
.kiro-card[data-tone=danger]{background:color-mix(in srgb,var(--kiro-danger) 9%,transparent)}
.kiro-card[data-aside=true]{opacity:.76}
.kiro-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.kiro-card-name{font-size:13px;font-weight:600}
.kiro-card-sub{font-size:11.5px;color:var(--kiro-faint);font-variant-numeric:tabular-nums}
.kiro-card-pct{display:flex;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums}
.kiro-card-pct strong{font-size:18px;font-weight:700;line-height:1.1}
.kiro-card-pct small{font-size:11px;opacity:.68}
.kiro-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--kiro-faint)}
.kiro-search{width:100%;min-height:32px;padding:6px 10px;border:1px solid var(--kiro-line-strong);border-radius:var(--kiro-r-sm);background:transparent;color:inherit;font-size:13px}
.kiro-field-error{color:var(--kiro-danger);font-size:11px}
.kiro-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0;color:var(--kiro-faint);font-size:11.5px}
.kiro-meta div{display:flex;gap:4px}
.kiro-meta dt{font-weight:500}
.kiro-meta dd{margin:0;font-variant-numeric:tabular-nums}
.kiro-notice{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:10px;font-size:12px;overflow-wrap:anywhere;background:color-mix(in srgb,var(--kiro-tone,var(--kiro-accent)) 10%,transparent);border:1px solid color-mix(in srgb,var(--kiro-tone,var(--kiro-accent)) 28%,transparent)}
.kiro-notice[data-kind=warn]{--kiro-tone:var(--kiro-warn);color:var(--kiro-warn-text)}
.kiro-notice[data-kind=error]{--kiro-tone:var(--kiro-danger);color:var(--kiro-danger)}
.kiro-notice[data-kind=ok]{--kiro-tone:var(--kiro-ok)}
.kiro-empty{color:var(--kiro-muted);font-size:var(--kiro-fs-sm);padding:var(--kiro-s2) 0}
.kiro-meter{position:relative;height:8px;border-radius:99px;background:rgba(128,128,128,.22);overflow:hidden}
.kiro-meter-fill{display:block;height:100%;border-radius:99px;background:var(--kiro-ok);transition:width .25s ease}
.kiro-meter-fill[data-high=true]{background:var(--kiro-tight)}
.kiro-meter-fill[data-full=true]{background:var(--kiro-danger)}
.kiro-meter-fill[data-tone=warn]{background:var(--kiro-warn)}
.kiro-meter-fill[data-tone=tight]{background:var(--kiro-tight)}
.kiro-meter-fill[data-tone=danger]{background:var(--kiro-danger)}
.kiro-form{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--kiro-line);border-radius:var(--kiro-r);background:var(--kiro-surface)}
.kiro-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.kiro-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--kiro-muted)}
.kiro-field-inline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}
.kiro-input,.kiro-select{min-height:32px;padding:6px 10px;border:1px solid var(--kiro-line-strong);border-radius:var(--kiro-r-sm);background:transparent;color:inherit;font-size:13px;color-scheme:inherit}
.kiro-select option{color:CanvasText;background:Canvas}
.kiro-input{width:min(100%,24rem)}
.kiro-input-sm{width:130px;text-align:right;font-variant-numeric:tabular-nums}
.kiro-input:disabled,.kiro-select:disabled{opacity:.48}
.kiro-details{border:1px solid var(--kiro-line);border-radius:10px;background:color-mix(in srgb,currentColor 3%,transparent);padding:8px 12px}
.kiro-details summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;font-weight:500;color:var(--kiro-muted);user-select:none}
.kiro-details summary::-webkit-details-marker{display:none}
.kiro-details summary::before{content:'▸';font-size:11px;margin-right:4px;display:inline-block;transition:transform .15s ease}
.kiro-details[open] summary::before{transform:rotate(90deg)}
.kiro-details[open] summary{margin-bottom:10px;color:inherit}
.kiro-login-state{display:flex;flex-direction:column;gap:6px;padding:10px 14px;border-radius:10px;background:color-mix(in srgb,var(--kiro-accent) 8%,transparent);border:1px solid color-mix(in srgb,var(--kiro-accent) 26%,transparent);font-size:12.5px}
.kiro-login-state a{color:var(--kiro-accent)}
.kiro-footer{color:var(--kiro-faint);font-size:11.5px;padding-top:2px}
.kiro-footer a{color:var(--kiro-muted)}
.kiro-footer a:hover{color:var(--kiro-accent)}
.kiro-pill{display:inline-flex;align-items:center;gap:1px;min-height:26px;box-sizing:border-box;padding:2px;border:1px solid rgba(128,128,128,.3);border-radius:999px;background:transparent;color:inherit;font-size:11px;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;max-width:min(48vw,280px)}
.kiro-pill[data-readonly=true]{padding:2px 9px;font-size:11.5px;font-weight:600;opacity:.82}
.kiro-pill[data-error=true]{gap:6px;padding:2px 8px;border-color:color-mix(in srgb,var(--kiro-danger) 45%,transparent);background:color-mix(in srgb,var(--kiro-danger) 10%,transparent)}
.kiro-pill-tier{min-height:20px;padding:0 7px;border:1px solid transparent;border-radius:999px;background:transparent;color:inherit;font:inherit;opacity:.7;cursor:pointer;font-size:11px;font-weight:500;transition:background .14s ease,color .14s ease,border-color .14s ease,opacity .14s ease}
.kiro-pill-tier:hover:not(:disabled){opacity:1;background:color-mix(in srgb,currentColor 8%,transparent)}
.kiro-pill-tier[aria-pressed=true]{opacity:1;border-color:color-mix(in srgb,var(--kiro-accent) 45%,transparent);background:color-mix(in srgb,var(--kiro-accent) 16%,transparent);color:var(--kiro-accent);font-weight:600;cursor:default}
.kiro-pill-tier:disabled{opacity:.42;cursor:not-allowed}
.kiro-pill-error{color:var(--kiro-danger);font-size:11px;font-weight:600}
.kiro-quota-pill{position:relative;display:inline-flex;align-items:center}
.kiro-quota-trigger{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:5px 10px;border:1px solid rgba(128,128,128,.3);border-radius:999px;background:transparent;color:inherit;font-size:12px;font-weight:600;line-height:1;white-space:nowrap;max-width:min(46vw,240px);cursor:pointer;transition:background .14s ease,border-color .14s ease}
.kiro-quota-trigger:hover{background:var(--kiro-surface-2)}
.kiro-quota-trigger[data-short=true]{padding:4px 11px 4px 9px}
.kiro-quota-trigger[data-stale=true]{border-style:dashed}
.kiro-quota-trigger[data-tinted=true]{background:color-mix(in srgb,var(--kiro-pill-tone,var(--kiro-neutral)) 14%,transparent);border-color:color-mix(in srgb,var(--kiro-pill-tone,var(--kiro-neutral)) 45%,transparent)}
.kiro-quota-trigger[data-tinted=true]:hover{background:color-mix(in srgb,var(--kiro-pill-tone,var(--kiro-neutral)) 20%,transparent)}
.kiro-quota-trigger[data-tone=ok]{--kiro-pill-tone:var(--kiro-ok)}
.kiro-quota-trigger[data-tone=warn]{--kiro-pill-tone:var(--kiro-warn)}
.kiro-quota-trigger[data-tone=tight]{--kiro-pill-tone:var(--kiro-tight)}
.kiro-quota-trigger[data-tone=danger]{--kiro-pill-tone:var(--kiro-danger)}
.kiro-quota-trigger[data-tone=neutral]{--kiro-pill-tone:var(--kiro-neutral)}
.kiro-quota-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--kiro-pill-tone,var(--kiro-neutral))}
.kiro-quota-mini{display:inline-grid;width:34px;flex:none;gap:2px}
.kiro-quota-mini-track{display:block;width:100%;border-radius:999px;background:rgba(128,128,128,.22);overflow:hidden}
.kiro-quota-mini-fill{display:block;height:100%;border-radius:999px}
.kiro-quota-mini-fill[data-tone=ok]{background:var(--kiro-ok)}
.kiro-quota-mini-fill[data-tone=warn]{background:var(--kiro-warn)}
.kiro-quota-mini-fill[data-tone=tight]{background:var(--kiro-tight)}
.kiro-quota-mini-fill[data-tone=danger]{background:var(--kiro-danger)}
.kiro-quota-badge{font-size:11px;font-weight:600;color:var(--kiro-pill-tone,inherit)}
.kiro-quota-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kiro-quota-popover{position:absolute;bottom:calc(100% + 6px);right:0;z-index:50;width:min(340px,calc(100vw - 24px));max-height:min(70vh,calc(100vh - 72px));overflow-y:auto;box-sizing:border-box;overflow-wrap:anywhere;padding:14px;border-radius:14px;background:var(--dsh-surface,var(--dsw-alias-bg-layer-1,Canvas));color:var(--dsh-text,var(--dsw-alias-label-primary,CanvasText));color-scheme:light;border:1px solid rgba(128,128,128,.28);box-shadow:0 12px 32px rgba(0,0,0,.28);font:12px/1.5 sans-serif}
.kiro-quota-head{position:sticky;top:-14px;z-index:1;margin:-14px -14px 10px;padding:14px 14px 8px;background:var(--dsh-surface,var(--dsw-alias-bg-layer-1,Canvas));border-bottom:1px solid var(--kiro-line);display:flex;align-items:center;gap:8px}
.kiro-quota-title{font-weight:600;font-size:13px}
.kiro-quota-close{margin-left:auto;border:0;background:transparent;color:inherit;opacity:.6;cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;border-radius:6px}
.kiro-quota-close:hover{opacity:1;background:var(--kiro-surface-2)}
.kiro-quota-body{display:flex;flex-direction:column;gap:10px}
.kiro-quota-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;font-size:11px;color:var(--kiro-faint)}
.kiro-quota-refresh{padding:4px 12px;border-radius:8px;border:0;background:rgba(59,130,246,.14);color:var(--kiro-accent);font-size:12px;font-weight:500;cursor:pointer;transition:background .14s ease,opacity .14s ease}
.kiro-quota-refresh:hover:not(:disabled){background:rgba(59,130,246,.22)}
.kiro-quota-refresh:disabled{opacity:.5;cursor:not-allowed}
html[data-dsh-go-island] .kiro-quota-pill{flex-wrap:wrap;width:100%}
html[data-dsh-go-island][data-dsh-go-island-form="panel"] .kiro-quota-popover{position:static!important;top:auto!important;bottom:auto!important;left:auto!important;right:auto!important;width:100%!important;max-height:none!important;overflow:visible!important;margin-top:8px;box-shadow:none!important;background:transparent!important;border-color:rgba(128,128,128,.2)!important}
@container kiro (max-width: 560px){
  .kiro-header{flex-direction:column;align-items:flex-start}
  .kiro-row{gap:var(--kiro-s2);padding:10px 12px}
  .kiro-input{width:100%}
  .kiro-input-sm{width:100%;text-align:left}
}
@media (prefers-reduced-motion: reduce){
  .kiro-settings *,.kiro-pill *,.kiro-quota-pill *,.kiro-quota-popover *{transition:none !important}
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