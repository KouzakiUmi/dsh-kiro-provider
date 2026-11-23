// Client 入口：挂载 Typert 远端、安装样式、注册设置分区与上下文 pill。
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
  const client = {
    async invoke(request) {
      const remote = service ?? ctx.get('remote.kiroProvider');
      if (disposed || !remote) throw new Error('Kiro 设置服务未就绪，请重试。');
      return readSettingsReply(await remote.invoke(request), request.op);
    },
  };
  ctx.effect(() => installStyles());
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'kiro-provider', order: 26,
    label: () => 'Kiro Provider', inject: () => ({ client }),
  }, Settings));
  registerContextPill(ctx, client.invoke);
  registerUsagePill(ctx, client.invoke);
  ctx.effect(() => () => { disposed = true; unmount?.(); });
}