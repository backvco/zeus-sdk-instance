// @ts-nocheck
import { casMutate, resolveBaseRev } from '../cas.js';
import { ClustersCoreService } from './clusters/core.js';
import { ClusterNodegroupsService } from './clusters/nodegroups.js';
import { ClusterSecurityService } from './clusters/security.js';
import { ClusterUpgradeService } from './clusters/upgrade.js';
import { ClusterStorageService } from './clusters/storage.js';
import { ClusterCertsService } from './clusters/certs.js';
import { ClusterOverlayService } from './clusters/overlay.js';
import { ClusterExtrasService } from './clusters/extras.js';

/**
 * ClustersService — Kubernetes clusters (EKS, GKE, k3s) within a container.
 *
 * Accessed as `sdk.clusters`. This is the largest namespace in the SDK; the core
 * lifecycle lives here and seven sub-namespaces hang off it:
 *   - `sdk.clusters.nodegroups` — managed node groups, Karpenter NodePools, k3s groups.
 *   - `sdk.clusters.security`   — access entries, security groups, IAM node roles.
 *   - `sdk.clusters.upgrade`    — Kubernetes version upgrades + sessions.
 *   - `sdk.clusters.storage`    — S3/EFS/GCS/Filestore resources.
 *   - `sdk.clusters.certs`      — cert-manager issuers + DNS-solver creds + live addons.
 *   - `sdk.clusters.overlay`    — cross-cluster WireGuard/NetBird mesh.
 *   - `sdk.clusters.extras`     — arch-taint, Harbor, GKE CSI/access, firewall rules.
 *
 * Every cluster belongs to a container (workspace). All methods take
 * `{ container, name, ... }` where `name` is the cluster name. Routes that read
 * a `?branch=` query (defaulting to 'main') accept an optional `branch` here;
 * it's dropped when undefined.
 *
 * Lifecycle: `create` (register config) → `provision` (build the cloud cluster,
 * STREAMING) → operate (nodegroups/storage/certs/overlay/...) → `destroy`
 * (STREAMING). `get`/`update`/`metadata`/`drift`/`diff` inspect and edit config.
 *
 * Single-cluster inspect + storage-class + provision/destroy methods are
 * inherited from {@link ClustersCoreService} (split out for file size, but still
 * reached as `sdk.clusters.<method>`).
 */
export class ClustersService extends ClustersCoreService {
  constructor(sdk) {
    super(sdk);
    this.nodegroups = new ClusterNodegroupsService(sdk);
    this.security = new ClusterSecurityService(sdk);
    this.upgrade = new ClusterUpgradeService(sdk);
    this.storage = new ClusterStorageService(sdk);
    this.certs = new ClusterCertsService(sdk);
    this.overlay = new ClusterOverlayService(sdk);
    this.extras = new ClusterExtrasService(sdk);
  }

  // ─── Collection ─────────────────────────────────────────────────────────────

  /**
   * List all clusters in a container.
   * @param {object} params
   * @param {string} params.container
   * @param {string} [params.branch='main']
   * @returns {Promise<{ clusters: Array<object> }>}
   * @example
   * const { clusters } = await sdk.clusters.list({ container: 'app1' });
   */
  list({ container, branch }) {
    return this.sdk._fetch(this._col(container), 'GET', { query: { branch } });
  }

  /**
   * Create a new cluster config entry.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name - Cluster name.
   * @param {object} params.data - Cluster config object.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster: object }>}
   * @example
   * await sdk.clusters.create({ container:'app1', name:'z-05', data:{ provider:'eks', region:'us-east-2' } });
   */
  create({ container, name, data, branch }) {
    return this.sdk._fetch(this._col(container), 'POST', { body: { name, data, branch } });
  }

  /**
   * Get one cluster's config.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster: object }>} cluster may carry `linked`, `sourceContainer`.
   * @example
   * const { cluster } = await sdk.clusters.get({ container:'app1', name:'z-01' });
   */
  get({ container, name, branch }) {
    return this.sdk._fetch(this._base(container, name), 'GET', { query: { branch } });
  }

  /**
   * Update a cluster's config.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {object} params.data - Full cluster config object.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster: object }>}
   * The route enforces optimistic concurrency: the request must carry the
   * `_rev` you read (`baseRev`), and a mismatch 409s (`kind: 'stale-save'`)
   * without writing. When omitted, `baseRev` is taken from `data._rev`
   * (present whenever `data` came from {@link get}); with neither it sends
   * `null` ("no doc expected yet"), which 409s if one exists. Prefer
   * {@link mutate} for programmatic edits.
   *
   * @param {number|null} [params.baseRev] - Revision this write is based on (default `data._rev ?? null`).
   * @example
   * const { cluster } = await sdk.clusters.get({ container:'app1', name:'z-01' });
   * cluster.region = 'us-west-2';
   * await sdk.clusters.update({ container:'app1', name:'z-01', data: cluster });
   */
  update({ container, name, data, branch, baseRev }) {
    return this.sdk._fetch(this._base(container, name), 'PUT', {
      body: { data, branch, baseRev: resolveBaseRev(data, baseRev) },
    });
  }

  /**
   * Read-mutate-write a cluster with automatic stale-save retry.
   * Fetches the current doc, applies `fn` (edit in place or return a
   * replacement), saves with the fetched `_rev` — and on a stale-save 409
   * re-fetches and re-applies `fn` to the fresh doc (safe CAS retry, never a
   * merge of stale state).
   *
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @param {number} [params.retries=3] - Stale-save retries.
   * @param {(cluster: object) => object|void|Promise<object|void>} fn - Mutation to apply.
   * @returns {Promise<{ cluster: object }>}
   * @example
   * await sdk.clusters.mutate({ container:'app1', name:'z-01' }, (c) => { c.labels = { tier: 'prod' }; });
   */
  mutate({ container, name, branch, retries } = {}, fn) {
    return casMutate({
      // `capabilities` / `linked` / `sourceContainer` are computed by the GET
      // route at read time, not part of the stored doc — writing them back
      // would persist stale copies, so strip before mutating.
      read: async () => {
        const { cluster } = await this.get({ container, name, branch });
        const { capabilities, linked, sourceContainer, ...doc } = cluster || {};
        return doc;
      },
      write: (data, baseRev) => this.update({ container, name, data, branch, baseRev }),
      mutate: fn,
      retries,
    });
  }

  /**
   * Delete a cluster's config entry (does NOT destroy cloud resources — see {@link destroy}).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.clusters.delete({ container:'app1', name:'z-05' });
   */
  delete({ container, name, branch }) {
    return this.sdk._fetch(this._base(container, name), 'DELETE', { query: { branch } });
  }

  /**
   * Import an existing cloud cluster. Without `clusterName` lists importable
   * clusters in the region; with it returns a preview.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.region - Required.
   * @param {string} [params.clusterName] - When set, returns `{ preview }` instead of a list.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ region, clusters } | { preview }>}
   * @example
   * const { clusters } = await sdk.clusters.importList({ container:'app1', region:'us-east-2' });
   */
  importList({ container, region, clusterName, branch }) {
    return this.sdk._fetch(`${this._col(container)}/import`, 'GET', { query: { region, clusterName, branch } });
  }

  /**
   * Import a cloud cluster into Zeus config (EKS or GKE).
   * @param {object} params - container, branch + body. EKS: { region, clusterName, name? };
   *   GKE: { provider:'gke', accountId, project, location, clusterName, name? }.
   * @returns {Promise<{ cluster, message }>}
   * @example
   * await sdk.clusters.import({ container:'app1', region:'us-east-2', clusterName:'prod-eks' });
   */
  import({ container, branch, ...body }) {
    return this.sdk._fetch(`${this._col(container)}/import`, 'POST', { body: { ...body, branch } });
  }

  /**
   * List in-flight cluster builds (active provisioning runs).
   * @param {object} params
   * @param {string} params.container
   * @returns {Promise<{ builds: Array<{ name, provider, runId, startedAt, lastMessage, lastType, streamUrl }> }>}
   * @example
   * const { builds } = await sdk.clusters.activeBuilds({ container:'app1' });
   */
  activeBuilds({ container }) {
    return this.sdk._fetch(`${this._col(container)}/active-builds`, 'GET');
  }

  /**
   * List failed (pinned) cluster builds.
   * @param {object} params
   * @param {string} params.container
   * @param {string} [params.branch='main']
   * @returns {Promise<{ builds: Array<object> }>}
   * @example
   * const { builds } = await sdk.clusters.failedBuilds({ container:'app1' });
   */
  failedBuilds({ container, branch }) {
    return this.sdk._fetch(`${this._col(container)}/failed-builds`, 'GET', { query: { branch } });
  }

  /**
   * Replay a pinned failed-build log as a stream. STREAMING.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.id - Build id (selects which recorded log to replay).
   * @param {boolean|string} [params.log=true] - Truthy flag that switches the route into log-replay mode.
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream of the recorded log.
   * @example
   * const s = sdk.clusters.failedBuildLog({ container:'app1', id:'b1', log:true });
   */
  failedBuildLog({ container, id, log, branch }) {
    return this.sdk._stream(`${this._col(container)}/failed-builds`, 'GET', { query: { id, log, branch } });
  }

  /**
   * Remove a pinned failed build.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.id - Required.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ removed }>}
   * @example
   * await sdk.clusters.removeFailedBuild({ container:'app1', id:'b1' });
   */
  removeFailedBuild({ container, id, branch }) {
    return this.sdk._fetch(`${this._col(container)}/failed-builds`, 'DELETE', { query: { id, branch } });
  }

  /**
   * Drift report across all clusters (desired vs live).
   * @param {object} params
   * @param {string} params.container
   * @param {string} [params.branch='main']
   * @returns {Promise<{ clusters: Array<object>, summary: { total, awsEks, liveExists, withDrift, errored } }>}
   * @example
   * const { summary } = await sdk.clusters.drift({ container:'app1' });
   */
  drift({ container, branch }) {
    return this.sdk._fetch(`${this._col(container)}/drift`, 'GET', { query: { branch } });
  }

  /**
   * Diff two clusters on portable characteristics.
   * @param {object} params
   * @param {string} params.container
   * @param {string} [params.base='']
   * @param {string} [params.target='']
   * @param {string} [params.branch='main']
   * @returns {Promise<{ base, target, groups, summary }>}
   * @example
   * const diff = await sdk.clusters.diff({ container:'app1', base:'z-01', target:'z-02' });
   */
  diff({ container, base, target, branch }) {
    return this.sdk._fetch(`${this._col(container)}/diff`, 'GET', { query: { base, target, branch } });
  }

  /**
   * Apply selected diff rows from `base` onto `target`.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.base
   * @param {string} params.target
   * @param {Array<object>} params.rows - Selected diff rows to apply.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster, applied, skipped, scaffolded }>}
   * @example
   * await sdk.clusters.applyDiff({ container:'app1', base:'z-01', target:'z-02', rows:[...] });
   */
  applyDiff({ container, base, target, rows, branch }) {
    return this.sdk._fetch(`${this._col(container)}/diff`, 'POST', { body: { base, target, rows, branch } });
  }

  /**
   * Read autoMovePrimaryBeforeDrain for one cluster.
   * Missing values come back as `preview`.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ mode: 'off'|'preview'|'on', cluster: string, container: string }>}
   * @example
   * const { mode } = await sdk.clusters.getAutoMovePrimary({ container:'app1', name:'z-02' });
   */
  getAutoMovePrimary({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/auto-move-primary`, 'GET', { query: { branch } });
  }

  /**
   * Set autoMovePrimaryBeforeDrain. `preview` logs the move and does not
   * promote. `on` promotes before drain or host maintenance. `off` skips it.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {'off'|'preview'|'on'} params.mode
   * @param {string} [params.branch='main']
   * @returns {Promise<{ mode: string, cluster: string, container: string }>}
   * @example
   * await sdk.clusters.setAutoMovePrimary({ container:'app1', name:'z-02', mode:'on' });
   */
  setAutoMovePrimary({ container, name, mode, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/auto-move-primary`, 'PUT', { body: { mode }, query: { branch } });
  }

  /**
   * Read failureDomainRebalance. Missing values come back as `preview`.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ mode: 'off'|'preview'|'on', cluster: string, container: string }>}
   */
  getFailureDomainRebalance({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/failure-domain-rebalance`, 'GET', { query: { branch } });
  }

  /**
   * Set failureDomainRebalance. `preview` records a one-member reschedule and
   * does not evict. `on` reschedules that member. `off` only alerts.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {'off'|'preview'|'on'} params.mode
   * @param {string} [params.branch='main']
   */
  setFailureDomainRebalance({ container, name, mode, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/failure-domain-rebalance`, 'PUT', { body: { mode }, query: { branch } });
  }

  /**
   * Preview a quorum-spread rebalance. Does not delete a pod.
   * Apply with {@link applyQuorumSpread}.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch]
   * @returns {Promise<{ ok: boolean, dryRun: true, planHash: string|null, steps: object[], safe: boolean }>}
   * @example
   * const preview = await sdk.clusters.planQuorumSpread({ container:'app1', name:'z-02' });
   */
  planQuorumSpread({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/quorum-spread/plan`, 'POST', { body: {}, query: { branch } });
  }

  /**
   * Apply a previewed quorum-spread rebalance. `confirm` must equal the cluster
   * name. `planHash` is the single-use token from {@link planQuorumSpread}.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.confirm
   * @param {string} params.planHash
   * @param {string} [params.branch]
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream.
   * @example
   * const stream = sdk.clusters.applyQuorumSpread({ container:'app1', name:'z-02', confirm:'z-02', planHash });
   */
  applyQuorumSpread({ container, name, confirm, planHash, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/quorum-spread/apply`, 'POST', {
      body: { dryRun: false, confirm, planHash },
      query: { branch }
    });
  }

  /**
   * Preview one named quorum-member move. Does not delete a pod.
   * `groupId` is the catalog group id (`keeper/<namespace>/<release>`, and the
   * same shape for MySQL, NATS, and Valkey). `member` is the pod name.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.groupId
   * @param {string} params.member
   * @param {string} [params.branch]
   * @returns {Promise<{ ok: boolean, action: string, planHash: string|null, steps: object[], safe: boolean }>}
   * @example
   * await sdk.clusters.planQuorumMemberMove({ container:'app1', name:'z-02', groupId:'keeper/db/chi', member:'keeper-1' });
   */
  planQuorumMemberMove({ container, name, groupId, member, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/quorum-member/plan`, 'POST', {
      body: { groupId, member },
      query: { branch }
    });
  }

  /**
   * Apply a previewed quorum-member move. `confirm` must equal the cluster
   * name. `planHash` is the single-use token from {@link planQuorumMemberMove}.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.groupId
   * @param {string} params.member
   * @param {string} params.confirm
   * @param {string} params.planHash
   * @param {string} [params.branch]
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream.
   * @example
   * const stream = sdk.clusters.applyQuorumMemberMove({ container:'app1', name:'z-02', groupId:'keeper/db/chi', member:'keeper-1', confirm:'z-02', planHash });
   */
  applyQuorumMemberMove({ container, name, groupId, member, confirm, planHash, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/quorum-member/apply`, 'POST', {
      body: { groupId, member, dryRun: false, confirm, planHash },
      query: { branch }
    });
  }

  /**
   * Read nodeGroupShape. Missing values come back as `preview`.
   * Preview plans per-host VM targets and does not create or destroy a VM.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ mode: 'off'|'preview'|'on', cluster: string, container: string }>}
   */
  getNodeGroupShape({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/node-group-shape`, 'GET', { query: { branch } });
  }

  /**
   * Set nodeGroupShape. `off` skips the planner. `preview` records the plan.
   * `on` allows one VM change per sweep. Does not itself create a VM.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {'off'|'preview'|'on'} params.mode
   * @param {string} [params.branch='main']
   */
  setNodeGroupShape({ container, name, mode, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/node-group-shape`, 'PUT', { body: { mode }, query: { branch } });
  }
}
