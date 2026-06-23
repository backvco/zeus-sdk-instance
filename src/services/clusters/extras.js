// @ts-nocheck
/**
 * ClusterExtrasService — assorted cluster operations that don't fit the larger
 * sub-namespaces. Accessed as `sdk.clusters.extras`.
 *
 * Covers:
 *   - **arch-taint** — opt-in CPU-architecture taint migration (preflight/start/revert).
 *   - **harbor** — Harbor registry replication endpoints/policies/proxy-caches + robot accounts.
 *   - **gke** — Google-managed CSI driver enablement + GKE access bindings.
 *   - **firewall-rules** — apply GKE node-pool firewall rules.
 *
 * `arch-taint/start` and `gke-csi-drivers` POST STREAM (SSE). `harbor-*` POSTs are
 * action-dispatched (pass `action` + that action's fields; see the route for the
 * full action matrix). All methods are container + cluster scoped:
 * pass `{ container, name, ... }`. Most routes read `?branch=` (default 'main');
 * `firewall-rules` POST reads `branch` from the body, while `gke-access`
 * POST/DELETE read `branch` from the query (member/policy go in the body).
 */
export class ClusterExtrasService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  // ─── Arch taint ─────────────────────────────────────────────────────────────

  /**
   * Preflight the CPU-architecture taint migration.
   * @param {object} params - container, name, branch? (def 'main'), mode? (def 'enable').
   * @returns {Promise<object>} The preflight result object (includes `ok`).
   * @example const pre = await sdk.clusters.extras.archTaintPreflight({ container:'app1', name:'z-01' });
   */
  archTaintPreflight({ container, name, branch, mode }) {
    return this.sdk._fetch(`${this._base(container, name)}/arch-taint/preflight`, 'POST', { body: { branch, mode } });
  }

  /**
   * Start the arch-taint migration. STREAMING.
   * @param {object} params - container, name + body: acknowledgeIrreversible, preflightResult,
   *   branch? (def 'main'), mode? (def 'enable'), archOverrides? (def {}).
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream (409 → `{ error, inFlight, runId }`).
   * @example const s = sdk.clusters.extras.archTaintStart({ container:'app1', name:'z-01', acknowledgeIrreversible:true, preflightResult:pre });
   */
  archTaintStart({ container, name, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/arch-taint/start`, 'POST', { body });
  }

  /**
   * Revert the arch-taint migration.
   * @param {object} params - container, name, branch? (def 'main'), force? (def false).
   * @returns {Promise<{ ok }>}
   * @example await sdk.clusters.extras.archTaintRevert({ container:'app1', name:'z-01' });
   */
  archTaintRevert({ container, name, branch, force }) {
    return this.sdk._fetch(`${this._base(container, name)}/arch-taint/revert`, 'POST', { body: { branch, force } });
  }

  // ─── Harbor ─────────────────────────────────────────────────────────────────

  /**
   * Get Harbor replication state (registries, policies, proxy caches).
   * @returns {Promise<{ registries, policies, proxyCaches, harborUrl }>}
   * @example const r = await sdk.clusters.extras.harborReplication({ container:'app1', name:'z-01' });
   */
  harborReplication({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/harbor-replication`, 'GET', { query: { branch } });
  }

  /**
   * Run a Harbor replication action. Action-dispatched.
   * @param {object} params - container, name, branch + body: action plus that action's fields.
   *   Actions include: add-endpoint, delete-endpoint, update-endpoint, ping-endpoint,
   *   reconnect-endpoint, create-policy, delete-policy, run-policy, executions,
   *   add-proxy-cache, delete-proxy-cache, proxy-cache-stats, proxy-cache-config,
   *   flush-proxy-cache, set-retention, clear-retention, set-project-quota,
   *   set-proxy-speed, gc-get, gc-set, gc-run, gc-history. See the route for fields.
   * @param {object} [params.body] - Explicit verbatim body — use when the action
   *   payload has its own `name` field (e.g. an endpoint name) that would collide
   *   with the cluster `name`.
   * @returns {Promise<object>} Shape varies by action (mostly Harbor objects pass-through).
   * @example await sdk.clusters.extras.harborReplicationAction({ container:'app1', name:'z-01', action:'ping-endpoint', id:3 });
   * @example await sdk.clusters.extras.harborReplicationAction({ container:'app1', name:'z-01', body:{ action:'add-endpoint', name:'peer', url:'...' } });
   */
  harborReplicationAction({ container, name, branch, body, ...rest }) {
    return this.sdk._fetch(`${this._base(container, name)}/harbor-replication`, 'POST', { body: body ?? rest, query: { branch } });
  }

  /**
   * Get Harbor robot accounts (or one robot's secret with `robotId`).
   * @param {object} params - container, name, branch, robotId? (→ { secret }), project?.
   * @returns {Promise<{ robots, projects, scan, harborUrl } | { secret }>}
   * @example const { robots } = await sdk.clusters.extras.harborRobots({ container:'app1', name:'z-01' });
   */
  harborRobots({ container, name, robotId, project, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/harbor-robots`, 'GET', { query: { robotId, project, branch } });
  }

  /**
   * Run a Harbor robot action. Action-dispatched.
   * @param {object} params - container, name, branch + body: action plus fields.
   *   Actions: create ({ project, name, role, durationDays }), delete ({ robotId }),
   *   rotate ({ robotId, robotName? }), create-project ({ project, public? }),
   *   delete-project ({ projectId }), set-scan-policy ({ projectId, autoScan?, preventVul?, severity? }).
   * @returns {Promise<object>} Shape varies by action (e.g. create → { id, name, secret }).
   * @example await sdk.clusters.extras.harborRobotAction({ container:'app1', name:'z-01', action:'create', project:'library', name:'puller' });
   */
  harborRobotAction({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/harbor-robots`, 'POST', { body, query: { branch } });
  }

  // ─── GKE ──────────────────────────────────────────────────────────────────────

  /**
   * Get the GKE Google-managed CSI driver status.
   * @returns {Promise<{ drivers: { pd, filestore, gcs }, reason? }>}
   * @example const { drivers } = await sdk.clusters.extras.gkeCsiDrivers({ container:'app1', name:'z-03' });
   */
  gkeCsiDrivers({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/gke-csi-drivers`, 'GET', { query: { branch } });
  }

  /**
   * Enable a GKE CSI driver ('filestore' | 'gcs'). STREAMING.
   * @param {object} params - container, name, branch + body: driver.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ enabled }`.
   * @example const s = sdk.clusters.extras.enableGkeCsiDriver({ container:'app1', name:'z-03', driver:'filestore' });
   */
  enableGkeCsiDriver({ container, name, branch, driver }) {
    return this.sdk._stream(`${this._base(container, name)}/gke-csi-drivers`, 'POST', { body: { driver }, query: { branch } });
  }

  /**
   * Get GKE access bindings (project-scoped).
   * @returns {Promise<{ selfPrincipalArn, policies, entries, projectScoped: true, project }>}
   * @example const a = await sdk.clusters.extras.gkeAccess({ container:'app1', name:'z-03' });
   */
  gkeAccess({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/gke-access`, 'GET', { query: { branch } });
  }

  /**
   * Grant a GKE access binding (omit `member` to grant Zeus's own principal).
   * @param {object} params - container, name, branch, member?, policy? (def 'clusterAdmin').
   * @returns {Promise<{ success, ... }>}
   * @example await sdk.clusters.extras.grantGkeAccess({ container:'app1', name:'z-03', member:'user:a@b.com' });
   */
  grantGkeAccess({ container, name, branch, member, policy }) {
    return this.sdk._fetch(`${this._base(container, name)}/gke-access`, 'POST', { body: { member, policy }, query: { branch } });
  }

  /**
   * Revoke a GKE access binding (refuses to remove Zeus's own principal → 409).
   * @param {object} params - container, name, branch, member? | principalArn?.
   * @returns {Promise<{ success, ... }>}
   * @example await sdk.clusters.extras.revokeGkeAccess({ container:'app1', name:'z-03', member:'user:a@b.com' });
   */
  revokeGkeAccess({ container, name, branch, member, principalArn }) {
    return this.sdk._fetch(`${this._base(container, name)}/gke-access`, 'DELETE', { body: { member, principalArn }, query: { branch } });
  }

  /**
   * Apply GKE node-pool firewall rules (branch read from body; no query param).
   * @param {object} params - container, name, branch? (def 'main').
   * @returns {Promise<{ ok, applied, message? }>}
   * @example await sdk.clusters.extras.applyFirewallRules({ container:'app1', name:'z-03' });
   */
  applyFirewallRules({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/firewall-rules`, 'POST', { body: { branch } });
  }
}
