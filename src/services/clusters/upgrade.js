// @ts-nocheck
/**
 * ClusterUpgradeService — Kubernetes version upgrade orchestration for a single
 * cluster. Accessed as `sdk.clusters.upgrade`.
 *
 * Lifecycle: `preflight` (check a target version + addon compatibility) →
 * `start` (stream the upgrade; gated by env `ZEUS_ALLOW_UPGRADE=1` server-side) →
 * `status` (current/target version + addon plan) and `sessions`/`session` (durable
 * run history). Each upgrade run is recorded as a session.
 *
 * All methods are container + cluster scoped: pass `{ container, name, ... }`.
 */
export class ClusterUpgradeService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  /**
   * Run upgrade preflight checks for a target version.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.targetVersion - e.g. '1.30'.
   * @param {string} [params.branch='main']
   * @returns {Promise<object>} The preflight result object (opaque; includes per-check status).
   * @example
   * const pre = await sdk.clusters.upgrade.preflight({ container:'app1', name:'z-01', targetVersion:'1.30' });
   */
  preflight({ container, name, targetVersion, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/upgrade/preflight`, 'GET', { query: { targetVersion, branch } });
  }

  /**
   * Start a cluster upgrade. STREAMING. (Server gated by ZEUS_ALLOW_UPGRADE=1.)
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.targetVersion
   * @param {boolean} params.acknowledgeIrreversible - Must be true.
   * @param {boolean} [params.forceDrain=false]
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream. The session id is
   *   carried both in the `x-upgrade-session-id` response header and the first
   *   `upgrade-session-started` event `{ sessionId }`.
   * @example
   * const s = sdk.clusters.upgrade.start({ container:'app1', name:'z-01', targetVersion:'1.30', acknowledgeIrreversible:true });
   * for await (const ev of s) console.log(ev);
   */
  start({ container, name, targetVersion, acknowledgeIrreversible, forceDrain }) {
    return this.sdk._stream(`${this._base(container, name)}/upgrade/start`, 'POST', {
      body: { targetVersion, acknowledgeIrreversible, forceDrain },
    });
  }

  /**
   * Get current/target version status + addon upgrade plan.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {boolean} [params.refresh] - Pass true to force a live refresh.
   * @param {string} [params.targetVersion]
   * @param {string} [params.branch='main']
   * @returns {Promise<{ clusterName, region, currentVersion, platformVersion, versionStatus, addonPlan }>}
   * @example
   * const st = await sdk.clusters.upgrade.status({ container:'app1', name:'z-01' });
   */
  status({ container, name, refresh, targetVersion, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/upgrade/status`, 'GET', {
      query: { refresh: refresh ? '1' : undefined, targetVersion, branch },
    });
  }

  /**
   * List recorded upgrade sessions for this cluster.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @returns {Promise<{ sessions: Array<{ id, clusterName, currentVersion, targetVersion, status, currentPhase, createdAt, updatedAt, completedAt, error, eventCount }> }>}
   * @example
   * const { sessions } = await sdk.clusters.upgrade.sessions({ container:'app1', name:'z-01' });
   */
  sessions({ container, name }) {
    return this.sdk._fetch(`${this._base(container, name)}/upgrade/sessions`, 'GET');
  }

  /**
   * Get one upgrade session by id (full record including events).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.id - Session id.
   * @returns {Promise<object>} The full session object (id, status, currentPhase, events, ...).
   * @example
   * const session = await sdk.clusters.upgrade.session({ container:'app1', name:'z-01', id:'sess-123' });
   */
  session({ container, name, id }) {
    return this.sdk._fetch(`${this._base(container, name)}/upgrade/session/${encodeURIComponent(id)}`, 'GET');
  }
}
