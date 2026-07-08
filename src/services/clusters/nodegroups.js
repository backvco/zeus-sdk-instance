// @ts-nocheck
/**
 * ClusterNodegroupsService — node-group, node-pool, and k3s node-group operations
 * for a single cluster. Accessed as `sdk.clusters.nodegroups`.
 *
 * Three families share this namespace because they're three flavors of "the
 * machines a cluster runs on":
 *   - **nodegroups** — EKS managed node groups / GKE node pools (provider-dispatched).
 *   - **nodepools**  — Karpenter NodePools (EKS-only, dynamic provisioning).
 *   - **k3sNodegroups** — Proxmox/k3s control-plane + worker group utilities.
 *
 * Lifecycle for each: `plan` → `apply` (stream) → `drift`/`live` → `destroy`.
 * Streaming methods return an SSE stream handle; the terminal `done` event
 * carries the documented payload. A 409 `{ error, inFlight }` means a run is
 * already in progress. All methods are container + cluster scoped:
 * pass `{ container, name, ... }`.
 */
export class ClusterNodegroupsService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  // ─── EKS/GKE managed node groups ────────────────────────────────────────────

  /**
   * Compute a plan for a managed node group (no changes applied).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name   - Cluster name.
   * @param {string} params.ngName - Node-group name.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ plan: { provider, cluster, nodeGroup, steps, warnings, errors, summary, planHash } }>}
   * @example
   * const { plan } = await sdk.clusters.nodegroups.plan({ container:'app1', name:'z-01', ngName:'workers' });
   */
  plan({ container, name, ngName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodegroups/plan`, 'POST', { body: { ngName, branch } });
  }

  /**
   * Apply a managed node-group change (create/update/replace). STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @param {string} [params.planHash] - Plan hash from {@link plan} (optional).
   * @param {string} [params.mode] - 'replace' for a full replace; anything else applies in place.
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream; `done` payload `{ status }`.
   * @example
   * const s = sdk.clusters.nodegroups.apply({ container:'app1', name:'z-01', ngName:'workers' });
   * for await (const ev of s) console.log(ev);
   */
  apply({ container, name, ngName, planHash, mode, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/nodegroups/apply`, 'POST', { body: { ngName, planHash, mode, branch } });
  }

  /**
   * Destroy a managed node group. STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream; `done` payload `{ status, summary }`.
   * @example
   * const s = sdk.clusters.nodegroups.destroy({ container:'app1', name:'z-01', ngName:'workers' });
   */
  destroy({ container, name, ngName, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/nodegroups/destroy`, 'POST', { body: { ngName, branch } });
  }

  /**
   * Compare desired node groups against live cloud state.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster: string, items: Array<{ ng, exists, awsState, drift }> }>}
   * @example
   * const { items } = await sdk.clusters.nodegroups.drift({ container:'app1', name:'z-01' });
   */
  drift({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodegroups/drift`, 'GET', { query: { branch } });
  }

  /**
   * Live nodes + pods running on a managed node group (no branch read by route).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @returns {Promise<{ cluster, ng, nodes, pods }>}
   * @example
   * const { nodes } = await sdk.clusters.nodegroups.workload({ container:'app1', name:'z-01', ngName:'workers' });
   */
  workload({ container, name, ngName }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodegroups/${encodeURIComponent(ngName)}/workload`, 'GET');
  }

  /**
   * Live state + drift summary for a single managed node group.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ng, cluster, live, drift }>}
   * @example
   * const { live } = await sdk.clusters.nodegroups.live({ container:'app1', name:'z-01', ngName:'workers' });
   */
  live({ container, name, ngName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodegroups/${encodeURIComponent(ngName)}/live`, 'GET', { query: { branch } });
  }

  /**
   * Cancel the cloud provider's in-flight operation for a node group (GKE only).
   * GKE serializes cluster operations, so a stuck pool create/update blocks all
   * other mutations until it finishes or is cancelled. GKE's cancel API only
   * accepts node-upgrade operations; pass `force:true` to force-release any
   * other stuck operation by deleting the pool's underlying instance groups
   * (destructive — the pool must be destroyed/replaced afterwards).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @param {boolean} [params.force=false]
   * @param {string[]} [params.zones] - With force: only release these zones' instance groups
   *   (zones with running nodes are always kept). Omit to release every failing zone.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ng, cluster, cancelled: Array<{ name, operationType, status }>, forced?: boolean, deletedMigs?: string[], keptMigs?: string[], message?: string }>}
   * @example
   * const { cancelled } = await sdk.clusters.nodegroups.cancelOperation({ container:'app1', name:'z-03', ngName:'workers' });
   */
  cancelOperation({ container, name, ngName, force, zones, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodegroups/${encodeURIComponent(ngName)}/cancel-operation`, 'POST', { body: { force, zones, branch } });
  }

  /**
   * Re-scope a node group's subnets / availability zones (EKS v2). STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @param {string[]} params.subnetIds - Target subnet IDs (deduped server-side).
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream; `done` payload `{ status }`.
   * @example
   * const s = sdk.clusters.nodegroups.azScope({ container:'app1', name:'z-01', ngName:'workers', subnetIds:['subnet-a'] });
   */
  azScope({ container, name, ngName, subnetIds, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/nodegroups/${encodeURIComponent(ngName)}/az-scope`, 'POST', { body: { subnetIds, branch } });
  }

  // ─── Karpenter node pools (EKS-only) ────────────────────────────────────────

  /**
   * Compute a plan for a Karpenter NodePool.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.poolName
   * @param {string} [params.branch='main']
   * @returns {Promise<{ plan: { steps, warnings, errors, summary, planHash, rendered } }>}
   * @example
   * const { plan } = await sdk.clusters.nodegroups.poolPlan({ container:'app1', name:'z-01', poolName:'default' });
   */
  poolPlan({ container, name, poolName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/plan`, 'POST', { body: { poolName, branch } });
  }

  /**
   * Apply a Karpenter NodePool. STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.poolName
   * @param {string} [params.planHash]
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream; `done` payload
   *   `{ cluster, pool, state, updatedPool, nodePoolResourceVersion, nodeClassResourceVersion }`.
   * @example
   * const s = sdk.clusters.nodegroups.poolApply({ container:'app1', name:'z-01', poolName:'default' });
   */
  poolApply({ container, name, poolName, planHash, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/nodepools/apply`, 'POST', { body: { poolName, planHash, branch } });
  }

  /**
   * Destroy a Karpenter NodePool. STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.poolName
   * @param {boolean} [params.force=false]
   * @param {boolean} [params.drain=false]
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream.
   * @example
   * const s = sdk.clusters.nodegroups.poolDestroy({ container:'app1', name:'z-01', poolName:'default', drain:true });
   */
  poolDestroy({ container, name, poolName, force, drain, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/nodepools/destroy`, 'POST', { body: { poolName, force, drain, branch } });
  }

  /**
   * Compare Karpenter NodePools against live cluster state.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster, items: Array<{ pool, exists, drift, conditions, nodeCount }> }>}
   * @example
   * const { items } = await sdk.clusters.nodegroups.poolDrift({ container:'app1', name:'z-01' });
   */
  poolDrift({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/drift`, 'GET', { query: { branch } });
  }

  /**
   * List live NodePools and whether each is known to Zeus (import candidates).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster, items: Array<{ name, flavor, awsManaged, knownInZeus, nodeClassRef, labels }> }>}
   * @example
   * const { items } = await sdk.clusters.nodegroups.poolImportList({ container:'app1', name:'z-01' });
   */
  poolImportList({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/import`, 'GET', { query: { branch } });
  }

  /**
   * Import live NodePools into Zeus config.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string[]} [params.poolNames] - Names to import; null/omitted imports all unknown.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ imported: Array<{ name, flavor, managedBy }>, warnings, cluster }>}
   * @example
   * const { imported } = await sdk.clusters.nodegroups.poolImport({ container:'app1', name:'z-01', poolNames:['default'] });
   */
  poolImport({ container, name, poolNames, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/import`, 'POST', { body: { poolNames, branch } });
  }

  /**
   * Live nodes + pods for a NodePool (no branch read by route).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.poolName
   * @returns {Promise<{ cluster, pool, nodes, pods }>}
   * @example
   * const { nodes } = await sdk.clusters.nodegroups.poolWorkload({ container:'app1', name:'z-01', poolName:'default' });
   */
  poolWorkload({ container, name, poolName }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/${encodeURIComponent(poolName)}/workload`, 'GET');
  }

  /**
   * Live state for a single NodePool.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.poolName
   * @param {string} [params.branch='main']
   * @returns {Promise<{ pool, cluster, live, unknownInZeus? }>}
   * @example
   * const { live } = await sdk.clusters.nodegroups.poolLive({ container:'app1', name:'z-01', poolName:'default' });
   */
  poolLive({ container, name, poolName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/${encodeURIComponent(poolName)}/live`, 'GET', { query: { branch } });
  }

  /**
   * Describe the impact of destroying a NodePool (evictable pods, skipped DaemonSets).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.poolName
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster, pool, [impactFields]: * }>}
   * @example
   * const impact = await sdk.clusters.nodegroups.poolImpact({ container:'app1', name:'z-01', poolName:'default' });
   */
  poolImpact({ container, name, poolName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/nodepools/${encodeURIComponent(poolName)}/impact`, 'GET', { query: { branch } });
  }

  // ─── k3s node groups (Proxmox) ──────────────────────────────────────────────

  /**
   * Run a k3s node-group action (control-plane scale/HA/reconcile/etc). STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name - Cluster id.
   * @param {string} params.action - One of: 'scale-control-plane', 'reconcile-dns',
   *   'set-autostart', 'forget-group', 'set-control-plane-ha',
   *   'replace-control-plane-member', 'apply-control-plane'.
   * @param {object} [params] - Action-specific fields, passed through to the body:
   *   targetCount, preferredIps, groupName, autoStart, haGroup, spread, force, vmName, applyHa.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream.
   * @example
   * const s = sdk.clusters.nodegroups.k3sAction({ container:'app1', name:'z-02', action:'scale-control-plane', targetCount:3 });
   */
  k3sAction({ container, name, action, targetCount, preferredIps, groupName, autoStart, haGroup, spread, force, vmName, applyHa }) {
    return this.sdk._stream(`${this._base(container, name)}/k3s-nodegroups`, 'POST', {
      body: { action, targetCount, preferredIps, groupName, autoStart, haGroup, spread, force, vmName, applyHa },
    });
  }

  /**
   * Status of k3s node groups (or control-plane members with `detail`).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name - Cluster id.
   * @param {string} [params.detail] - Pass 'control-plane' for member-level detail.
   * @returns {Promise<{ items, reachable } | { members, reachable, desired }>}
   * @example
   * const { items } = await sdk.clusters.nodegroups.k3sStatus({ container:'app1', name:'z-02' });
   */
  k3sStatus({ container, name, detail }) {
    return this.sdk._fetch(`${this._base(container, name)}/k3s-nodegroups/status`, 'GET', { query: { detail } });
  }

  /**
   * Detect k3s node sync state (orphans/ghosts/healthy).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name - Cluster id.
   * @returns {Promise<{ reachable, inSync, orphans, ghosts, healthy }>}
   * @example
   * const { orphans } = await sdk.clusters.nodegroups.k3sSyncStatus({ container:'app1', name:'z-02' });
   */
  k3sSyncStatus({ container, name }) {
    return this.sdk._fetch(`${this._base(container, name)}/k3s-nodegroups/sync`, 'GET');
  }

  /**
   * Reconcile k3s node sync (adopt/reap orphans, drop ghosts). STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name - Cluster id.
   * @param {object} [params.decisions={}] - `{ orphans: {[name]:'adopt'|'reap'}, dropGhosts }`.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE stream.
   * @example
   * const s = sdk.clusters.nodegroups.k3sSync({ container:'app1', name:'z-02', decisions:{ dropGhosts:true } });
   */
  k3sSync({ container, name, decisions }) {
    return this.sdk._stream(`${this._base(container, name)}/k3s-nodegroups/sync`, 'POST', { body: { decisions } });
  }

  /**
   * Live nodes + pods for a k3s node group.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name - Cluster id.
   * @param {string} params.ngName
   * @returns {Promise<{ cluster, ng, nodes, pods }>}
   * @example
   * const { nodes } = await sdk.clusters.nodegroups.k3sWorkload({ container:'app1', name:'z-02', ngName:'workers' });
   */
  k3sWorkload({ container, name, ngName }) {
    return this.sdk._fetch(`${this._base(container, name)}/k3s-nodegroups/${encodeURIComponent(ngName)}/workload`, 'GET');
  }
}
