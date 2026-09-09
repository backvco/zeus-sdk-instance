// @ts-nocheck
/**
 * CustomHostnamesService — bring-your-own-domain hostnames bound to a service
 * in an environment, accessed as `sdk.customHostnames`.
 *
 * A custom hostname is a customer-owned domain (e.g. `help.example.com`,
 * CNAMEd to a Zeus-published record) that Zeus fronts with an Ingress + TLS
 * (HTTP-01 via cert-manager) and keeps reconciled across the environment's
 * clusters. See `docs/custom-hostnames.md` for the full lifecycle.
 *
 * Typical join gate (bring a hostname up without disturbing existing traffic):
 *   await sdk.customHostnames.put({ container, env, hostname, service });
 *   // poll get() until status.state === 'ready' …
 *   await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'clear-weight', cluster });
 */
export class CustomHostnamesService {
  constructor(sdk) { this.sdk = sdk; }

  /** Base path for an environment's custom-hostnames collection. @private */
  _base(container, env) {
    return `/v2configs/${encodeURIComponent(container)}/environments/${encodeURIComponent(env)}/custom-hostnames`;
  }

  /** Path for a single hostname. @private */
  _one(container, env, hostname) {
    return `${this._base(container, env)}/${encodeURIComponent(hostname)}`;
  }

  /**
   * List custom hostnames in an environment — paged, server-side filtered.
   * Never returns the full set; page with `cursor` (the last hostname of the
   * previous page).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.env       - Environment name.
   * @param {string} [params.service] - Filter to hostnames bound to this service (exact match).
   * @param {string} [params.q]       - Substring match on hostname.
   * @param {'pending'|'ready'|'error'} [params.state] - Filter on `status.state`.
   * @param {string} [params.cluster] - Filter to hostnames with a status entry for this cluster.
   * @param {number} [params.limit=100] - Page size, clamped 1..500.
   * @param {string} [params.cursor] - Resume after this hostname (from a prior page's `next`).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ items: Array<object>, next: string|null, counts: { total: number, pending: number, ready: number, error: number } }>}
   * @example
   * const { items, next, counts } = await sdk.customHostnames.list({ container: 'app1', env: 'dev-d00' });
   */
  list({ container, env, service, q, state, cluster, limit, cursor, branch } = {}) {
    return this.sdk._fetch(this._base(container, env), 'GET', {
      query: { service, q, state, cluster, limit, cursor, branch },
    });
  }

  /**
   * Get one custom hostname, including its live status.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.env       - Environment name.
   * @param {string} params.hostname  - The hostname (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ hostname: object }>}
   * @example
   * const { hostname: doc } = await sdk.customHostnames.get({ container: 'app1', env: 'dev-d00', hostname: 'help.example.com' });
   */
  get({ container, env, hostname, branch } = {}) {
    return this.sdk._fetch(this._one(container, env, hostname), 'GET', { query: { branch } });
  }

  /**
   * Create or update a custom hostname (idempotent upsert). Validates the
   * hostname, verifies its CNAME points at a Zeus-published target (unless
   * `force`), saves the doc, and reconciles it onto the target clusters
   * immediately.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.env       - Environment name.
   * @param {string} params.hostname  - The hostname (required).
   * @param {string} params.service   - Service this hostname routes to (required).
   * @param {string[]} [params.clusters] - Target clusters; default = every cluster the service is deployed on.
   * @param {string} [params.issuingCluster] - Cluster that owns the Certificate; default = first weighted target.
   * @param {string[]} [params.expectTargets] - Hostnames the CNAME is allowed to resolve to; default = the service's published external hosts.
   * @param {boolean} [params.force=false] - Skip the CNAME check (e.g. propagation still pending).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ hostname: object, reconcile: object }>} On a CNAME mismatch (and `force` not set),
   *   rejects with a {@link ZeusApiError} whose `.status` is 422 and `.body` is `{ error: 'cname-mismatch', verify }`.
   * @example
   * await sdk.customHostnames.put({ container: 'app1', env: 'dev-d00', hostname: 'help.example.com', service: 'customer-portals' });
   */
  put({ container, env, hostname, service, clusters, issuingCluster, expectTargets, force, branch } = {}) {
    return this.sdk._fetch(this._one(container, env, hostname), 'PUT', {
      body: { service, clusters, issuingCluster, expectTargets, force, branch },
    });
  }

  /**
   * Delete a custom hostname: prune its Ingress/Certificate/Secret from every
   * cluster it was applied to, then delete the doc.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.env       - Environment name.
   * @param {string} params.hostname  - The hostname (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ deleted: true, pruned: object }>}
   * @example
   * await sdk.customHostnames.delete({ container: 'app1', env: 'dev-d00', hostname: 'help.example.com' });
   */
  delete({ container, env, hostname, branch } = {}) {
    return this.sdk._fetch(this._one(container, env, hostname), 'DELETE', { query: { branch } });
  }

  /**
   * Run one action against a custom hostname.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.env       - Environment name.
   * @param {string} params.hostname  - The hostname (required).
   * @param {'verify'|'reissue'|'sync'} params.action
   *   - `'verify'`  — re-run the CNAME check and record the result.
   *   - `'reissue'` — delete the Certificate + TLS Secret on the issuing cluster
   *     so cert-manager (via ingress-shim) re-issues it, then reconcile.
   *   - `'sync'`    — re-reconcile onto its target clusters.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} `verify` → `{ hostname, verify }`; `reissue`/`sync` → `{ hostname, reconcile }`.
   * @example
   * await sdk.customHostnames.action({ container: 'app1', env: 'dev-d00', hostname: 'help.example.com', action: 'verify' });
   */
  action({ container, env, hostname, action, branch } = {}) {
    return this.sdk._fetch(this._one(container, env, hostname), 'POST', { body: { action, branch } });
  }

  /**
   * Bulk-reconcile every custom hostname in an environment (optionally
   * scoped to one service). STREAMING — returns an SSE run stream (one log
   * line per hostname).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.env       - Environment name.
   * @param {string} [params.service] - Only reconcile hostnames bound to this service.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE run stream
   *   (`info`/`step`/`error`/`done` events) — async-iterable + assignable
   *   `onOpen/onMessage/onError/onDone` callbacks + `close()`.
   * @example
   * const s = sdk.customHostnames.syncAll({ container: 'app1', env: 'dev-d00' });
   * for await (const ev of s) console.log(ev.type, ev.data);
   */
  syncAll({ container, env, service, branch } = {}) {
    return this.sdk._stream(this._base(container, env), 'POST', {
      body: { action: 'sync-all', service, branch },
    });
  }
}
