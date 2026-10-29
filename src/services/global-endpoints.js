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

  /**
   * Instance HTTP prober settings: probe regions, interval, and how many
   * consecutive all-region failures raise the public-endpoint-down alert.
   * `effective` is the resolved values (config, else fleet regions, else defaults).
   *
   * @returns {Promise<{ settings: object, effective: { regions: string[], intervalSec: number, consecutiveFailures: number }, defaults: object, limits: object }>}
   * @example
   * const { effective } = await sdk.globalEndpoints.httpProber();
   */
  httpProber() {
    return this.sdk._fetch('/global-endpoints/http-prober', 'GET');
  }

  /**
   * Update instance HTTP prober settings. Only keys present in `body` are
   * written; `null` clears a field back to the default. The server rejects
   * an interval outside 15..3600, a consecutiveFailures outside 1..20, and
   * region ids that are malformed, duplicated, or not in the live fleet.
   *
   * @param {object} body
   * @param {string[]|null} [body.regions]
   * @param {number|null} [body.intervalSec]
   * @param {number|null} [body.consecutiveFailures]
   * @returns {Promise<{ settings: object, effective: object, defaults: object, limits: object }>}
   * @example
   * await sdk.globalEndpoints.setHttpProber({ regions: ['us-east', 'eu-west'], intervalSec: 30 });
   */
  setHttpProber(body = {}) {
    return this.sdk._fetch('/global-endpoints/http-prober', 'PUT', { body });
  }

  /**
   * Prober status for every published global endpoint, including the probe
   * regions and interval actually in effect (`probeRegions`, `probeIntervalSec`).
   *
   * @returns {Promise<Record<string, object>>}
   * @example
   * const status = await sdk.globalEndpoints.vantageStatus();
   */
  vantageStatus() {
    return this.sdk._fetch('/global-endpoints/vantage-status', 'GET');
  }
}
