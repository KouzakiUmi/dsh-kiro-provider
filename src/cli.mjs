import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

export const profileNames = ['local', 'managed', 'key'];
const cliName = process.platform === 'win32' ? 'kiro-cli.exe' : 'kiro-cli';
// 官方二进制命名：3.x 单一 kiro-cli；2.x Windows 桌面应用内核为版本化 chat-cli-x.y.z。
const cliFilePattern = process.platform === 'win32' ? /^(?:kiro-cli|chat-cli-\d+\.\d+\.\d+)\.exe$/i : /^kiro-cli$/;
const DENY = 'rules:\n  - capability: all\n    effect: deny\n';
export const AGENT_ID = 'dsh-provider-text';
const AGENT = JSON.stringify({ name: AGENT_ID, description: 'DSH text conversation', tools: [], includeMcpJson: false, includePowers: false, resources: [], permissions: { rules: [{ capability: 'all', effect: 'deny' }] } });
const BASIC_ENV = /^(?:path|systemroot|windir|comspec|pathext|home|userprofile|localappdata|appdata|programdata|programfiles(?:\(x86\))?|tmp|temp|tmpdir|lang|lc_[a-z]+|xdg_(?:config|cache|runtime|data|state)_home|https?_proxy|all_proxy|no_proxy|ssl_cert_file|ssl_cert_dir)$/i;

export class KiroProblem extends Error {
  constructor(message, code = 'INVALID_REQUEST') { super(message); this.code = code; }
}

export function classifyCliFailure(text) {
  if (/no longer supported|update to the latest version/i.test(text)) return new KiroProblem('请更新官方 Kiro CLI 后重试。', 'CLIENT_UPGRADE_REQUIRED');
  if (/credit.*(?:exhausted|limit exceeded)|quota exceeded/i.test(text)) return new KiroProblem('Kiro 额度已耗尽。', 'QUOTA');
  if (/invalid.{0,20}api key|not logged in|authentication required|login required|must (?:log|sign) in|no (?:valid )?credentials/i.test(text)) return new KiroProblem('Kiro 登录不可用；请重新登录或检查 API Key。', 'AUTH');
  if (/model.{0,60}(?:not available|not found|unsupported)|invalid.model|(?:cannot|failed to|could not) set.{0,35}model/i.test(text)) return new KiroProblem('当前 Kiro 账号不支持所选模型。', 'MODEL_UNSUPPORTED');
  return new KiroProblem('Kiro CLI 操作失败；请检查连接方式后重试。', 'TRANSPORT');
}

export async function resolveCli(configured = '', path = process.env.PATH ?? '') {
  const fileName = name => process.platform === 'win32' ? name.toLowerCase() : name;
  if (configured && (!isAbsolute(configured) || !cliFilePattern.test(fileName(basename(configured))))) {
    throw new KiroProblem('请在插件配置中指定 kiro-cli 原生可执行文件的绝对路径。');
  }
  const dirs = path.split(process.platform === 'win32' ? ';' : ':');
  const candidates = configured ? [configured] : dirs.map(s => s.replace(/^"|"$/g, '')).filter(isAbsolute).map(dir => join(dir, cliName));
  for (const candidate of candidates) {
    try {
      const target = await realpath(candidate);
      if (!(await lstat(target)).isFile()) continue;
      await access(target, constants.X_OK);
      return target;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
    }
  }
  if (!configured && process.platform === 'win32') {
    // 2.x Windows 桌面应用的自更新布局：%LOCALAPPDATA%\kiro-cli\run\chat-cli-<version>.exe（PATH 无 shim）。
    // 3.x 起官方改为单一 kiro-cli 走 PATH，这里仅作兼容回退；多版本共存时取最高版本号。
    const local = process.env.LOCALAPPDATA;
    if (local && isAbsolute(local)) {
      let names;
      try {
        names = await readdir(join(local, 'kiro-cli', 'run'));
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
      }
      const versioned = (names ?? [])
        .map(name => /^chat-cli-(\d+)\.(\d+)\.(\d+)\.exe$/i.exec(name))
        .filter(Boolean)
        .sort((a, b) => b[1] - a[1] || b[2] - a[2] || b[3] - a[3]);
      // 逐候选容错与 PATH 循环同语义：断链/权限拒绝只跳过该版本，不放弃次高版本。
      for (const match of versioned) {
        try {
          const candidate = join(local, 'kiro-cli', 'run', match[0]);
          const target = await realpath(candidate);
          if (!(await lstat(target)).isFile()) continue;
          await access(target, constants.X_OK);
          return target;
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
        }
      }
    }
  }
  throw new KiroProblem('找不到官方 Kiro CLI。请先安装，或在插件配置中设置 cliPath。');
}

function ownedEnvironment(profile, home, key, source) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => BASIC_ENV.test(key)));
  if (profile !== 'local') env.KIRO_HOME = home;
  else if (source.KIRO_HOME && isAbsolute(source.KIRO_HOME)) env.KIRO_HOME = source.KIRO_HOME;
  if (profile === 'key' && key) env.KIRO_API_KEY = key;
  env.KIRO_LOG_LEVEL = 'error';
  env.KIRO_LOG_NO_COLOR = '1';
  return env;
}

async function checkDirectory(path, allowed = []) {
  const item = await lstat(path);
  if (!item.isDirectory() || item.isSymbolicLink() || (await readdir(path)).some(name => !allowed.includes(name))) {
    throw new KiroProblem('Kiro 隔离工作目录含额外文件，已停止启动。');
  }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const item = await lstat(path);
  if (!item.isDirectory() || item.isSymbolicLink()) throw new KiroProblem('Kiro 隔离目录指向了外部位置，已停止启动。');
}

async function writeOwned(path, data) {
  try { await writeFile(path, data, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const item = await lstat(path);
    if (!item.isFile() || item.isSymbolicLink() || item.size !== Buffer.byteLength(data)) throw new KiroProblem('Kiro 隔离配置已更改，已停止启动。');
    if (await readFile(path, 'utf8') !== data) throw new KiroProblem('Kiro 隔离配置已更改，已停止启动。');
  }
}

export async function cliOptions(root, profile, key, source = process.env) {
  if (!profileNames.includes(profile) || !isAbsolute(root)) throw new Error('Kiro 连接配置无效。');
  const base = join(root, profile);
  const cwd = join(base, 'empty-workspace');
  const home = join(base, 'kiro-home');
  await ensureDirectory(root);
  await ensureDirectory(base);
  await ensureDirectory(cwd);
  await checkDirectory(cwd, ['.kiro']);
  const project = join(cwd, '.kiro');
  const projectAgents = join(project, 'agents');
  await ensureDirectory(project);
  await checkDirectory(project, ['agents']);
  await ensureDirectory(projectAgents);
  await checkDirectory(projectAgents, [`${AGENT_ID}.json`]);
  await writeOwned(join(projectAgents, `${AGENT_ID}.json`), AGENT);
  if (profile !== 'local') {
    await ensureDirectory(home);
    for (const dir of ['settings', 'agents']) await ensureDirectory(join(home, dir));
    await writeOwned(join(home, 'settings', 'permissions.yaml'), DENY);
    await writeOwned(join(home, 'agents', `${AGENT_ID}.json`), AGENT);
  }
  return { cwd, env: ownedEnvironment(profile, home, key, source) };
}

export function spawnKiro(binary, args, options) {
  return spawn(binary, args, { ...options, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function runKiro(binary, args, options, { input, signal, timeout = 20_000, limit = 2_000_000 } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Kiro 操作已取消。'));
  return new Promise((resolve, reject) => {
    const child = spawnKiro(binary, args, options);
    const chunks = [];
    let size = 0;
    let failure;
    let diagnostic = Buffer.alloc(0);
    const stop = (message, code) => { failure ??= new KiroProblem(message, code); child.kill(); };
    const abort = () => stop('Kiro 操作已取消。', 'ABORTED');
    const timer = setTimeout(() => stop('等待 Kiro CLI 响应超时。', 'TIMEOUT'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > limit) stop('Kiro CLI 返回的数据超过上限。');
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { diagnostic = Buffer.concat([diagnostic, chunk.subarray(-4096)]).subarray(-4096); });
    child.stdin.on('error', () => {});
    child.once('error', () => { failure ??= new KiroProblem('无法启动 Kiro CLI。', 'TRANSPORT'); });
    child.once('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else {
        const problem = classifyCliFailure(diagnostic.toString('utf8'));
        resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), failure: code !== 0 || problem.code === 'MODEL_UNSUPPORTED' ? problem : undefined });
      }
    });
    child.stdin.end(input);
  });
}

// 版本门禁：V3 引擎在 2.37（2.x 末代）已可用且 3.x 语义相同；2.36 及更早的 V3 预览与 1.x 拒绝。
export function supportedCli(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major >= 3 || (major === 2 && minor >= 37);
}

export async function cliVersion(binary, options, signal) {
  const { code, stdout } = await runKiro(binary, ['--version'], options, { signal, timeout: 5_000, limit: 2048 });
  const match = /^kiro(?:[- ]cli)?[ \t]+((\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?)[ \t]*\r?$/im.exec(stdout);
  if (code !== 0 || !match || !supportedCli(match[1])) {
    throw new KiroProblem('Kiro Provider 需要官方 Kiro CLI 2.37+ 或 3.x。');
  }
  return match[1];
}

// Only bounded errors authored by this plugin reach settings responses, never provider output or paths.
export function safeProblem(error) {
  if (error instanceof KiroProblem) return error.message;
  return '无法完成 Kiro 设置操作；请检查连接配置后重试。';
}

// The isolated home is a Kiro configuration boundary, not an OS sandbox.
export async function checkRuntimeHome(env) {
  const home = env.KIRO_HOME || join(homedir(), '.kiro');
  for (const path of [join(home, 'hooks'), join(home, 'settings', 'mcp.json')]) {
    try {
      const item = await lstat(path);
      if (!item.isSymbolicLink() && item.isDirectory() && !(await readdir(path)).length) continue;
      throw new KiroProblem('所选 Kiro 配置含 Hooks 或全局 MCP；请选择干净的 Kiro 登录配置。');
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}
