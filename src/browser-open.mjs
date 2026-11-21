import { spawn } from 'node:child_process';

// 与 remote.mjs 的 loginStart 响应白名单同构：只打开 Kiro/AWS 官方授权页。
const PORTAL = /^https:\/\/app\.kiro\.dev\/signin(?:\?|$)/;
const AWS = /^https:\/\/oidc\.[a-z0-9-]+\.amazonaws\.com\/authorize(?:\?|$)/;

export function validateOpenUrl(url) {
  if (typeof url !== 'string' || url.length > 4096) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && (PORTAL.test(url) || AWS.test(url));
}

// 本地发起的登录自动打开一次默认浏览器；失败静默——设置页仍保留可点击链接。
export function openBrowser(url, deps = {}) {
  if (!validateOpenUrl(url)) return false;
  const spawnImpl = deps.spawn ?? spawn;
  const platform = deps.platform ?? process.platform;
  try {
    const child = platform === 'win32'
      ? spawnImpl('rundll32', ['url.dll,FileProtocolHandler', url], { shell: false, windowsHide: true, stdio: 'ignore', detached: true })
      : spawnImpl(platform === 'darwin' ? 'open' : 'xdg-open', [url], { shell: false, stdio: 'ignore', detached: true });
    child.once('error', () => {});
    child.unref?.();
    return true;
  } catch { return false; }
}