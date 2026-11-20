import { KiroProblem, safeProblem } from './cli.mjs';

// Fetch/read separation middleware. `read` serves memory then disk and never touches the
// upstream; `refresh` is the only fetching path (explicit or background revalidation).
// Failures back off exponentially and never erase the last good snapshot.
export function createResource({ kind, store, keyOf, fetch, ttl = 300_000, maxBackoff = 8, onUpdate }) {
  let memory;
  let inflight;
  let epoch = 0;
  const failures = new Map();

  function failureOf(key) {
    const failure = failures.get(key);
    return failure ? { error: failure.message } : {};
  }

  function read(subject) {
    const key = keyOf(subject);
    if (memory?.key === key) {
      return { value: memory.value, at: memory.at, source: 'memory', stale: Date.now() >= memory.until, ...failureOf(key) };
    }
    const entry = store.get(kind, key);
    if (entry) {
      memory = { key, value: entry.value, at: entry.at, until: entry.at + ttl };
      return { value: entry.value, at: entry.at, source: 'disk', stale: Date.now() >= entry.at + ttl, ...failureOf(key) };
    }
    return { source: 'none', stale: true, ...failureOf(key) };
  }

  async function refresh(subject, { force = false, signal } = {}) {
    const key = keyOf(subject);
    signal?.throwIfAborted();
    const failure = failures.get(key);
    if (!force && failure && Date.now() < failure.until) throw new KiroProblem(failure.message, 'BACKOFF');
    if (!signal && inflight?.key === key) return inflight.promise;
    const generation = epoch;
    const promise = (async () => {
      const value = await fetch(subject, signal);
      if (epoch === generation) {
        const at = Date.now();
        memory = { key, value, at, until: at + ttl };
        failures.delete(key);
        await store.set(kind, key, value, at).catch(() => {});
        onUpdate?.();
      }
      return value;
    })();
    if (!signal) inflight = { key, promise };
    try { return await promise; }
    catch (error) {
      if (!signal?.aborted && epoch === generation) {
        const count = (failures.get(key)?.count ?? 0) + 1;
        failures.set(key, { count, until: Date.now() + ttl * Math.min(2 ** count, maxBackoff), message: safeProblem(error) });
      }
      throw error;
    } finally { if (inflight?.promise === promise) inflight = undefined; }
  }

  // Stale-while-revalidate: a stale read triggers a background fetch without blocking.
  function revalidate(subject) {
    if (!read(subject).stale) return;
    const key = keyOf(subject);
    const failure = failures.get(key);
    if (failure && Date.now() < failure.until) return;
    if (inflight?.key === key) return;
    void refresh(subject).catch(() => {});
  }

  function reset() { ++epoch; memory = undefined; inflight = undefined; failures.clear(); }

  return { read, refresh, revalidate, reset };
}