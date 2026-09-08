// @ts-nocheck
/**
 * GlobalEndpointsService — external (public) DNS failover controls for one
 * global endpoint record, accessed as `sdk.globalEndpoints`.
 *
 * A record is one published hostname (e.g. `api.example.com`, `portals.example.com`)
 * whose weighted/failover members are clusters. Health automation sets weights;
 * manual overrides are applied LAST and always win — so an in-cluster agent can
 * hold its own cluster at weight 0 on ONE hostname (e.g. until it has synced
 * the certificates that hostname needs) without touching any other record.
 *
 * Typical join gate:
 *   await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'weight', cluster: 'z-01', value: 0 });
 *   // ... sync certs / become ready ...
 *   await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'clear-weight', cluster: 'z-01' });
 */
export class GlobalEndpointsService {
  constructor(sdk) { this.sdk = sdk; }

  _n(name) { return encodeURIComponent(name); }

  /**
   * Apply one manual failover override to a record's external DNS. Overrides win over
   * health automation unconditionally and persist until cleared. Triggers an immediate
   * reconcile; the response carries the applied weights.
   *
   * @param {object} params
   * @param {string} params.name     - Record hostname (registry or derived record).
   * @param {'drain'|'clear-drain'|'pin'|'clear-pin'|'weight'|'clear-weight'|'restore'|'clear-restore'|'failback'|'clear-failback'} params.type
   * @param {string} [params.cluster] - Cluster the action targets (required for pin/weight/clear-weight/restore/clear-restore).
   * @param {number|string} [params.value] - `weight`: 0..N; `failback`: 'auto' | 'manual'.
   * @returns {Promise<{ overrides: object, applied: object|null }>}
   * @example
   * // hold z-01 out of portals.example.com only (api/app records untouched)
   * await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'weight', cluster: 'z-01', value: 0 });
   */
  override({ name, type, cluster, value } = {}) {
    return this.sdk._fetch(`/global-endpoints/${this._n(name)}/external/override`, 'POST', { body: { type, cluster, value } });
  }

  /**
   * Current external status for a record — per-cluster weights, health verdicts and the
   * active overrides (what {@link override} changed).
   *
   * @param {object} params
   * @param {string} params.name - Record hostname.
   * @returns {Promise<object>}
   * @example
   * const status = await sdk.globalEndpoints.externalStatus({ name: 'portals.example.com' });
   */
  externalStatus({ name } = {}) {
    return this.sdk._fetch(`/global-endpoints/${this._n(name)}/external/status`, 'GET');
  }
}
