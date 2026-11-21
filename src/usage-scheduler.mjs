// 额度定时补采：读路径永不阻塞；连续 6 次失败后暂停，手动刷新成功即恢复。
export const PAUSE_AFTER = 6;

export function createUsageScheduler({ refresh, intervalSeconds, enabled, timers = { setTimeout, clearTimeout } }) {
  let timer;
  let failures = 0;
  let paused = false;
  let nextRefreshAt = null;
  let disposed = false;

  function stop() {
    if (timer) { timers.clearTimeout(timer); timer = undefined; }
    nextRefreshAt = null;
  }

  function schedule() {
    stop();
    if (disposed || paused || !enabled()) return;
    const seconds = intervalSeconds();
    nextRefreshAt = Date.now() + seconds * 1000;
    timer = timers.setTimeout(tick, seconds * 1000);
    timer?.unref?.();
  }

  async function tick() {
    timer = undefined;
    if (disposed || paused || !enabled()) { schedule(); return; }
    try { await refresh(); failures = 0; }
    catch { failures += 1; if (failures >= PAUSE_AFTER) paused = true; }
    schedule();
  }

  return {
    schedule,
    state: () => ({ autoRefreshPaused: paused, nextRefreshAt, refreshFailures: failures }),
    // 手动刷新成功清零计数并恢复调度；失败同样计入暂停阈值。
    async manual(promise) {
      try {
        const value = await promise;
        failures = 0;
        paused = false;
        schedule();
        return value;
      } catch (error) {
        failures += 1;
        if (failures >= PAUSE_AFTER) paused = true;
        schedule();
        throw error;
      }
    },
    reset() { failures = 0; paused = false; schedule(); },
    dispose() { disposed = true; stop(); },
  };
}