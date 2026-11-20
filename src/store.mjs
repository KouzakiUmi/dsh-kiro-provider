import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { KiroProblem } from './cli.mjs';

const MAX_BYTES = 2_000_000;
const LOCK_RETRIES = 5;

// Derived snapshots only: settings stay in the Config Editor, secrets in DSH credentials.
// The store is a non-authoritative acceleration layer; corruption is discarded, never fatal.
export function createStore({ file, validate }) {
  let doc = { version: 1, entries: {} };
  let queue = Promise.resolve();
  let loaded = false;
  let disposed = false;

  async function readDisk() {
    let text;
    try { text = await readFile(file, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return undefined; throw error; }
    if (text.length > MAX_BYTES) return undefined;
    let parsed;
    try { parsed = JSON.parse(text); } catch { return undefined; }
    if (parsed?.version !== 1 || parsed.entries === null || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) return undefined;
    const entries = {};
    for (const [key, entry] of Object.entries(parsed.entries)) {
      const sep = key.indexOf(':');
      if (sep <= 0 || !Number.isSafeInteger(entry?.at) || entry.at < 0) continue;
      const value = validate(key.slice(0, sep), entry.value);
      if (value !== undefined) entries[key] = { value, at: entry.at };
    }
    return { version: 1, entries };
  }

  async function load() {
    if (loaded || disposed) return;
    doc = await readDisk().catch(() => undefined) ?? { version: 1, entries: {} };
    loaded = true;
  }

  function enqueue(change) {
    if (disposed) return Promise.reject(new KiroProblem('Kiro 状态存储已关闭。'));
    const task = queue.then(async () => {
      if (disposed) return;
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const lock = `${file}.lock`;
      let handle;
      for (let attempt = 0; ; attempt++) {
        try { handle = await open(lock, 'wx', 0o600); break; }
        catch (error) {
          if (error?.code !== 'EEXIST' || attempt >= LOCK_RETRIES) throw new KiroProblem('Kiro 状态正被其他实例写入，请稍后重试。');
          await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
        }
      }
      try {
        // Re-read under the lock so concurrent instances merge instead of overwriting.
        const disk = await readDisk().catch(() => undefined);
        const next = { version: 1, entries: { ...(disk ?? doc).entries } };
        change(next.entries);
        const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
        try {
          await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
          await rename(tmp, file);
        } catch (error) {
          await unlink(tmp).catch(() => {});
          throw error;
        }
        doc = next;
      } finally {
        await handle.close();
        await unlink(lock).catch(() => {});
      }
    });
    queue = task.then(() => {}, () => {});
    return task;
  }

  return {
    load,
    get(kind, key) { return doc.entries[`${kind}:${key}`]; },
    set(kind, key, value, at = Date.now()) {
      const normalized = validate(kind, value);
      if (normalized === undefined) return Promise.reject(new KiroProblem('Kiro 状态快照无效。'));
      return enqueue(entries => { entries[`${kind}:${key}`] = { value: normalized, at }; });
    },
    remove(kind, key) { return enqueue(entries => { delete entries[`${kind}:${key}`]; }); },
    // Synchronous memory invalidation; the disk removal persists behind the queue.
    invalidate(kind, key) {
      delete doc.entries[`${kind}:${key}`];
      void enqueue(entries => { delete entries[`${kind}:${key}`]; }).catch(() => {});
    },
    whenIdle() { return queue; },
    dispose() { disposed = true; },
  };
}