import { credentialKey } from '@deepseek-ai/dsh-credentials';
import { KiroProblem } from './cli.mjs';
import { refreshGrant, validateGrantSession } from './oauth-wire.mjs';
import { pluginId } from './remote.mjs';

const recordKey = credentialKey(pluginId, 'oauth');
const authProblem = message => new KiroProblem(message, 'AUTH');
const payload = rec => rec?.kind === 'grant' && rec.payload?.version === 1 ? rec.payload : undefined;
const fresh = grant => Number.isSafeInteger(grant.expiresAt) && grant.expiresAt > Date.now() + 45_000;

export function oauthGrants(credentials, refresh = refreshGrant) {
  function store() {
    const service = credentials();
    if (typeof service?.modifyRecord !== 'function' || typeof service.readRecord !== 'function') throw authProblem('此 Profile 的 DSH 凭据服务未就绪。');
    return service;
  }
  async function auth(signal) {
    signal?.throwIfAborted();
    const service = store();
    let grant = payload(await service.readRecord(recordKey));
    if (!grant) throw authProblem('请先在 Kiro Provider 中完成浏览器登录。');
    if (!fresh(grant)) {
      const latest = await service.modifyRecord(recordKey, async current => {
        signal?.throwIfAborted();
        const saved = payload(current);
        if (!saved || fresh(saved)) return undefined;
        // Once refresh starts, commit its rotated token even if the requesting turn is cancelled.
        // The refresh transport has its own deadline and this mutation holds the credential lock.
        const renewed = await refresh(saved);
        return { kind: 'grant', payload: renewed };
      });
      grant = payload(latest);
      if (!grant) throw authProblem('Kiro 登录已断开，请重新登录。');
    }
    signal?.throwIfAborted();
    return validateGrantSession(grant);
  }
  return {
    auth,
    checkWritable() { store(); },
    async connected() {
      const service = credentials();
      return typeof service?.describeRecord === 'function' && (await service.describeRecord(recordKey))?.kind === 'grant';
    },
    async save(grant, signal) {
      const service = store();
      await service.modifyRecord(recordKey, async () => {
        signal?.throwIfAborted();
        return { kind: 'grant', payload: grant };
      });
    },
    async forget() { await store().deleteRecord(recordKey); },
  };
}
