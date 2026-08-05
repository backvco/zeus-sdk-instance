// @ts-nocheck
import { casMutate, resolveBaseRev } from '../cas.js';
import { InfrastructureRotateService } from './infrastructure/rotate.js';
import { InfrastructureBackupsService } from './infrastructure/backups.js';

/**
 * InfrastructureService — Helm/EKS addon lifecycle on a container's clusters.
 *
 * Accessed as `sdk.infrastructure`.
 *
 * An "infrastructure addon" is a 3rd-party workload Zeus installs onto a
 * cluster — a Helm chart (Prometheus, NATS, NetBird, MySQL/PG/ClickHouse
 * operators…), an AWS EKS-managed addon (vpc-cni, coredns, EBS/EFS/S3 CSI…),
 * or a zeus-managed deployment (the mesh webhook). Addon *definitions* live in
 * the container's `infrastructure/` directory; this service both edits those
 * definitions ({@link list}/{@link get}/{@link save}/{@link remove}) and drives
 * the live install/upgrade/uninstall lifecycle against a cluster.
 *
 * Typical lifecycle for a Helm addon:
 *   1. {@link save}     — author/edit the addon definition.
 *   2. {@link versions} — list available chart versions.
 *   3. {@link status}   — check what's installed (and run install preflight).
 *   4. {@link helm}     — install / upgrade / uninstall / read values, etc.
 *   5. {@link metricsStream} / {@link rolloutStatus} — observe post-install.
 *
 * Two sub-namespaces: `sdk.infrastructure.backups` (browse/trigger/backfill/
 * rotate-credentials) and `sdk.infrastructure.rotate` (DB credential rotation).
 *
 * All methods are container-scoped (first param `container`). Read endpoints
 * accept an optional `branch` (defaults to 'main' server-side).
 */
export class InfrastructureService {
  constructor(sdk) {
    this.sdk = sdk;
    /** Credential rotation sub-namespace. @type {InfrastructureRotateService} */
    this.rotate = new InfrastructureRotateService(sdk);
    /** Backup browsing + manual operations sub-namespace. @type {InfrastructureBackupsService} */
    this.backups = new InfrastructureBackupsService(sdk);
  }

  _base(container) {
    return `/v2configs/${encodeURIComponent(container)}/infrastructure`;
  }

  // ─── Addon definitions ──────────────────────────────────────────────────

  /**
   * List all infrastructure addon definitions in the container.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch]  - Config branch (default 'main').
   * @returns {Promise<{ addons: Array<object> }>}
   * @example
   * const { addons } = await sdk.infrastructure.list({ container: 'app1' });
   */
  list({ container, branch }) {
    return this.sdk._fetch(this._base(container), 'GET', { query: { branch } });
  }

  /**
   * Create or update an addon definition.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Addon id.
   * @param {object} params.data      - Addon definition JSON.
   * @param {string} [params.branch]  - Config branch (default 'main').
   * @returns {Promise<{ addon: object }>}
   * @example
   * await sdk.infrastructure.save({ container: 'app1', name: 'nats', data: {...} });
   */
  save({ container, name, data, branch }) {
    return this.sdk._fetch(this._base(container), 'POST', { body: { name, data, branch } });
  }

  /**
   * Get a single addon definition.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Addon id.
   * @param {string} [params.branch]  - Config branch (default 'main').
   * @returns {Promise<{ addon: object }>}
   * @example
   * const { addon } = await sdk.infrastructure.get({ container: 'app1', name: 'nats' });
   */
  get({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container)}/${encodeURIComponent(name)}`, 'GET', {
      query: { branch },
    });
  }

  /**
   * Update an existing addon definition (PUT — same effect as {@link save}).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Addon id.
   * @param {object} params.data      - Addon definition JSON.
   * @param {string} [params.branch]  - Config branch (default 'main').
   * @returns {Promise<{ addon: object }>}
   * Optimistic concurrency (see docs/infrastructure.md): sends `baseRev`
   * (default `data._rev ?? null`); a mismatch 409s `{ kind: 'stale-save' }`.
   * NOTE: when {@link get} returned the ROOT catalog doc (`_ownContainer:
   * false`) its `_rev` is the root's — pass `baseRev: null` for the first
   * per-container write. Prefer {@link mutate}, which handles this.
   *
   * @param {number|null} [params.baseRev] - Revision this write is based on (default `data._rev ?? null`).
   * @example
   * await sdk.infrastructure.update({ container: 'app1', name: 'nats', data: {...} });
   */
  update({ container, name, data, branch, baseRev }) {
    return this.sdk._fetch(`${this._base(container)}/${encodeURIComponent(name)}`, 'PUT', {
      body: { data, branch, baseRev: resolveBaseRev(data, baseRev) },
    });
  }

  /**
   * Read-mutate-write with automatic stale-save retry (see casMutate in
   * ../cas.js). Handles the root-catalog fallback: no container override yet
   * → write asserts `baseRev: null` (create); read-time decorations
   * (`_ownContainer`, `_shadow`) are stripped so they never persist.
   *
   * @param {{container: string, name: string, branch?: string, retries?: number}} params
   * @param {(addon: object) => object|void|Promise<object|void>} fn - Mutation to apply.
   * @returns {Promise<{ addon: object }>}
   * @example
   * await sdk.infrastructure.mutate({ container: 'app1', name: 'nats' }, (a) => { a.values.replicas = 3; });
   */
  mutate({ container, name, branch, retries } = {}, fn) {
    return casMutate({
      read: async () => {
        const { addon } = await this.get({ container, name, branch });
        const { _ownContainer, _shadow, ...doc } = addon || {};
        if (_ownContainer === false) {
          // Borrowed root-catalog doc: its _rev belongs to the ROOT doc, not
          // this container's (which doesn't exist yet) — drop the rev fields
          // so the write asserts baseRev:null (expect-create).
          delete doc._rev;
          delete doc._revAt;
          delete doc._revBy;
        }
        return doc;
      },
      write: (data, baseRev) => this.update({ container, name, data, branch, baseRev }),
      mutate: fn,
      retries,
    });
  }

  /**
   * Delete an addon definition.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Addon id.
   * @param {string} [params.branch]  - Config branch (default 'main').
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.infrastructure.remove({ container: 'app1', name: 'nats' });
   */
  remove({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container)}/${encodeURIComponent(name)}`, 'DELETE', {
      query: { branch },
    });
  }

  // ─── Status ─────────────────────────────────────────────────────────────

  /**
   * List the live pods (or PVCs) for an addon release on a cluster.
   *
   * @param {object} params
   * @param {string} params.container    - Container name.
   * @param {string} params.clusterName  - Cluster name.
   * @param {string} params.namespace    - Kubernetes namespace.
   * @param {string} [params.releaseName] - Helm release name to scope to.
   * @param {('pvcs'|string)} [params.type] - 'pvcs' to list PVCs; otherwise pods.
   * @returns {Promise<{ pods: Array<object> } | { pvcs: Array<object>, storageClasses: Record<string, object> }>}
   * @example
   * const { pods } = await sdk.infrastructure.statusResources({
   *   container: 'app1', clusterName: 'z-01', namespace: 'nats', releaseName: 'nats'
   * });
   */
  statusResources({ container, clusterName, namespace, releaseName, type }) {
    return this.sdk._fetch(`${this._base(container)}/status`, 'GET', {
      query: { clusterName, namespace, releaseName, type },
    });
  }

  /**
   * Compute installed/health status for every addon on a cluster (folds in real
   * pod health), and optionally run an install preflight for one addon +
   * namespace (namespace existence + required-secret presence).
   *
   * @param {object} params
   * @param {string} params.container        - Container name.
   * @param {string} params.clusterName      - Cluster name.
   * @param {string} [params.kubeContext]    - Override kube context.
   * @param {string} [params.environmentName] - Scope to an environment's deployments.
   * @param {string} [params.addonName]      - Addon to preflight (with `targetNamespace`).
   * @param {string} [params.targetNamespace] - Namespace to preflight.
   * @param {string} [params.branch]         - Config branch (default 'main').
   * @returns {Promise<{ addons: Array<object>, helmAvailable: boolean, eksAvailable: boolean, accessDenied: boolean, accessHint?: string, clusterRegion?: string, clusterArn?: string, clusterAccountId?: string, preflight?: { namespaceExists: boolean, missingSecrets: string[] } }>}
   * @example
   * const s = await sdk.infrastructure.status({ container: 'app1', clusterName: 'z-01' });
   * // → { addons: [...], helmAvailable: true, eksAvailable: true, accessDenied: false }
   */
  status({ container, clusterName, kubeContext, environmentName, addonName, targetNamespace, branch }) {
    return this.sdk._fetch(`${this._base(container)}/status`, 'POST', {
      body: { clusterName, kubeContext, environmentName, addonName, targetNamespace, branch },
    });
  }

  /**
   * Create a namespace on a cluster (tunnel-aware for k3s).
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.clusterName - Cluster name.
   * @param {string} params.namespace   - Namespace to create.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {Promise<{ success: true, namespace: string }>}
   * @example
   * await sdk.infrastructure.createNamespace({ container: 'app1', clusterName: 'z-01', namespace: 'nats' });
   */
  createNamespace({ container, clusterName, namespace, branch }) {
    return this.sdk._fetch(`${this._base(container)}/status`, 'PUT', {
      body: { clusterName, namespace, branch },
    });
  }

  // ─── EKS-managed addons ──────────────────────────────────────────────────

  /**
   * Describe a live EKS-managed addon (synchronous read). Use
   * {@link eksAddonStream} for create/update/reapply/delete.
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.addonName   - Zeus addon id (must be an eks-addon).
   * @param {string} params.clusterName - EKS cluster name.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {Promise<{ result: object, action: 'describe' }>}
   * @example
   * const { result } = await sdk.infrastructure.describeEksAddon({
   *   container: 'app1', addonName: 'aws-ebs-csi-driver', clusterName: 'z-01'
   * });
   */
  describeEksAddon({ container, addonName, clusterName, branch }) {
    return this.sdk._fetch(`${this._base(container)}/eks-addon`, 'POST', {
      body: { action: 'describe', addonName, clusterName, branch },
    });
  }

  /**
   * Run a mutating EKS-managed addon action. **Streaming** — returns a stream
   * handle. Emits `progress.*` events and a final `done`
   * `{ result, action, metadata, postInstall, serviceAccountRoleArn, error? }`.
   * (The synchronous `describe` action is exposed separately as
   * {@link describeEksAddon}.)
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {('create'|'update'|'reapply'|'delete')} params.action - Mutating action.
   * @param {string} params.addonName   - Zeus addon id (must be an eks-addon).
   * @param {string} params.clusterName - EKS cluster name.
   * @param {string} [params.version]   - Addon version (auto-resolved if omitted/incompatible).
   * @param {object} [params.configurationValues] - EKS addon configuration values.
   * @param {object} [params.provisionerConfig]   - Hook provisioner config (e.g. EFS).
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.eksAddonStream({
   *   container: 'app1', action: 'create', addonName: 'aws-efs-csi-driver', clusterName: 'z-01'
   * });
   * stream.onDone((r) => console.log(r)); // → { result: {...}, action: 'create', ... }
   */
  eksAddonStream({ container, action, addonName, clusterName, version, configurationValues, provisionerConfig, branch }) {
    return this.sdk._stream(`${this._base(container)}/eks-addon`, 'POST', {
      body: { action, addonName, clusterName, version, configurationValues, provisionerConfig, branch },
    });
  }

  // ─── Helm lifecycle ───────────────────────────────────────────────────────

  /**
   * Drive a Helm-chart addon action against a cluster. Dispatches on `action`:
   * `install`, `upgrade`, `rollback`, `uninstall`, `unstick`, `status`,
   * `values`, `history`, `manifest`, `render`, `save`, `revert`, `restart`,
   * `resize-pvc`, `delete-pvcs`, `ingress-transport-check`. Tunnel-aware (k3s).
   *
   * Returns synchronous JSON (NOT a stream). The response shape depends on the
   * action; for install/upgrade it is roughly
   * `{ result, action, rollout?, reachability?, warnings? }`.
   *
   * **412 acknowledgement:** for a `reachabilityCritical` addon, a mutating
   * action without `acknowledgeReachabilityCritical: true` returns HTTP 412
   * `requiresAcknowledgement` — the SDK transport throws
   * `ReachabilityAckRequiredError` automatically (catch it, re-call with
   * `acknowledgeReachabilityCritical: true`). Mutating actions hold a
   * release-scoped lock and may throw HTTP 409 if the release is locked.
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.action      - Helm action (see list above).
   * @param {string} params.addonName   - Zeus addon id (must be a helm-chart addon).
   * @param {string} [params.clusterName] - Cluster name (resolves kube context).
   * @param {string} [params.kubeContext] - Explicit kube context override.
   * @param {object} [params.values]    - Chart values (install/upgrade/render/save).
   * @param {string} [params.version]   - Chart version.
   * @param {number} [params.revision]  - Target revision (rollback).
   * @param {string} [params.targetNamespace]   - Namespace override.
   * @param {string} [params.targetReleaseName] - Release-name override.
   * @param {string} [params.environmentName]   - Environment scope (env record).
   * @param {string} [params.deploymentName]    - Deployment (instance) name.
   * @param {boolean} [params.liveOnly] - For `values`: skip env-record merge (drift truth).
   * @param {string}  [params.pvcName]  - For `resize-pvc`.
   * @param {string}  [params.newSize]  - For `resize-pvc`.
   * @param {string[]} [params.pvcNames] - For `delete-pvcs`.
   * @param {boolean} [params.deletePvcs] - For `uninstall`/`force-remove`: also delete the release's PVCs (destroys data). Default false.
   * @param {boolean} [params.deleteCrds] - For `uninstall`: also delete chart-shipped CRDs once verified unused cluster-wide. Default true. Ignored by `force-remove` (never sweeps CRDs, by construction).
   * @param {boolean} [params.purgeExtras] - For `uninstall`/`force-remove`: also purge keep-policy credential/TLS secrets + out-of-band resources. Default false.
   * @param {string|null} [params.backupProfile]  - Backup profile name (install/upgrade/save).
   * @param {string|null} [params.restoreProfile] - Restore source profile (restore install).
   * @param {boolean} [params.acknowledgeReachabilityCritical] - Break-glass ack for reachability-critical addons.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {Promise<object>} Action-dependent JSON (e.g. `{ result, action, rollout }`).
   * @example
   * // Install
   * const res = await sdk.infrastructure.helm({
   *   container: 'app1', action: 'install', addonName: 'nats',
   *   clusterName: 'z-01', values: {...}
   * });
   * // Reachability-critical retry
   * import { ReachabilityAckRequiredError } from '@zeusk8s/sdk-instance';
   * try {
   *   await sdk.infrastructure.helm({ container: 'app1', action: 'upgrade', addonName: 'netbird-management', clusterName: 'z-01', values: {...} });
   * } catch (e) {
   *   if (e instanceof ReachabilityAckRequiredError) {
   *     await sdk.infrastructure.helm({ container: 'app1', action: 'upgrade', addonName: 'netbird-management', clusterName: 'z-01', values: {...}, acknowledgeReachabilityCritical: true });
   *   } else throw e;
   * }
   */
  helm({
    container, action, addonName, clusterName, kubeContext, values, version, revision,
    targetNamespace, targetReleaseName, environmentName, deploymentName, liveOnly,
    pvcName, newSize, pvcNames, deletePvcs, deleteCrds, backupProfile, restoreProfile,
    acknowledgeReachabilityCritical, branch, purgeExtras,
  }) {
    return this.sdk._fetch(`${this._base(container)}/helm`, 'POST', {
      body: {
        action, addonName, clusterName, kubeContext, values, version, revision,
        targetNamespace, targetReleaseName, environmentName, deploymentName, liveOnly,
        pvcName, newSize, pvcNames, deletePvcs, deleteCrds, backupProfile, restoreProfile,
        acknowledgeReachabilityCritical, branch, purgeExtras,
      },
    });
  }

  // ─── Pending applies (apply queue) ────────────────────────────────────────

  /**
   * List the cluster-scoped add-ons on a cluster whose stored desired-config
   * intent (addonConfigs[x].savedValues) drifts from the live helm release —
   * i.e. what's waiting to be applied. Computed on demand, per cluster.
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.cluster     - Cluster name.
   * @param {string} [params.addon]     - Filter to a single add-on.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {Promise<{ pending: Array<{ addonName: string, scope: 'cluster', cluster: string, namespace: string, releaseName: string, driftCount: number, changedKeys: string[] }> }>}
   * @example
   * const { pending } = await sdk.infrastructure.pendingApplies({ container: 'app1', cluster: 'z-01' });
   */
  pendingApplies({ container, cluster, addon, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/pending-applies`, 'GET', {
      query: { cluster, addon, branch },
    });
  }

  // ─── Rollout ──────────────────────────────────────────────────────────────

  /**
   * List a release's StatefulSets with rollout status (`needsRollout` is true
   * when helm changed the pod template but pods are still on the prior revision).
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.clusterName - Cluster name.
   * @param {string} params.namespace   - Namespace.
   * @param {string} params.releaseName - Helm release name.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {Promise<{ statefulSets: Array<object>, needsRollout: boolean, pendingCount: number }>}
   * @example
   * const r = await sdk.infrastructure.rolloutStatus({
   *   container: 'app1', clusterName: 'z-01', namespace: 'ndb', releaseName: 'ndb'
   * });
   */
  rolloutStatus({ container, clusterName, namespace, releaseName, branch }) {
    return this.sdk._fetch(`${this._base(container)}/rollout`, 'GET', {
      query: { clusterName, namespace, releaseName, branch },
    });
  }

  /**
   * Sequentially restart the named StatefulSets (one pod at a time, waiting for
   * Ready). **Streaming** — returns a stream handle; final `done`
   * `{ ok, restarted, message, error? }`.
   *
   * @param {object} params
   * @param {string} params.container    - Container name.
   * @param {string} params.clusterName  - Cluster name.
   * @param {string} params.namespace    - Namespace.
   * @param {string[]} params.statefulSets - StatefulSet names to roll (non-empty).
   * @param {string} [params.branch]     - Config branch (default 'main').
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.rollout({
   *   container: 'app1', clusterName: 'z-01', namespace: 'ndb', statefulSets: ['ndb-ndbd']
   * });
   * stream.onDone((r) => console.log(r)); // → { ok: true, restarted: 1, ... }
   */
  rollout({ container, clusterName, namespace, statefulSets, branch }) {
    return this.sdk._stream(`${this._base(container)}/rollout`, 'POST', {
      body: { clusterName, namespace, statefulSets, branch },
    });
  }

  // ─── Metrics / network / versions ─────────────────────────────────────────

  /**
   * Stream Prometheus metrics for an addon release. **Streaming** — returns a
   * stream handle. Emits `status`, `metric` (per query), `error`, `complete`,
   * and `refresh` (every ~30s) named events; queries come from the addon's
   * `metrics.prometheusQueries`.
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.clusterName - Cluster name (sent as `cluster`).
   * @param {string} params.addonName   - Addon id (sent as `addon`).
   * @param {string} params.namespace   - Namespace.
   * @param {string} params.releaseName - Release name.
   * @param {('1h'|'6h'|'24h'|'7d')} [params.range='1h'] - Time range.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.metricsStream({
   *   container: 'app1', clusterName: 'z-01', addonName: 'nats', namespace: 'nats', releaseName: 'nats'
   * });
   * stream.onMessage = (ev) => console.log(ev.type, ev.data);
   */
  metricsStream({ container, clusterName, addonName, namespace, releaseName, range, branch }) {
    return this.sdk._stream(`${this._base(container)}/metrics`, 'GET', {
      query: { cluster: clusterName, addon: addonName, namespace, releaseName, range, branch },
    });
  }

  /**
   * One-shot Prometheus snapshot for an addon release — the JSON counterpart
   * of {@link metricsStream}, sized for tool-calling (bots/MCP): bounded
   * payload, current values by default, raw series points only when
   * `includeSeries` is set.
   *
   * @param {object} params
   * @param {string} params.container    - Container name.
   * @param {string} params.clusterName  - Cluster name (sent as `cluster`).
   * @param {string} params.addon        - Addon id (sent as `addon`).
   * @param {string} params.namespace    - Namespace.
   * @param {string} params.releaseName  - Release name.
   * @param {string[]|string} [params.keys] - Restrict to these metric keys (array or csv string).
   * @param {('1h'|'6h'|'24h'|'7d')} [params.range='1h'] - Time range.
   * @param {boolean} [params.includeSeries] - Include raw `[ts,value]` points per series (default false).
   * @param {string} [params.branch]     - Config branch (default 'main').
   * @returns {Promise<{ available: boolean, reason?: string, range?: string, metrics?: Record<string, { current: number|null, series: Array<{ labels: object, current: number|null, points?: Array<[number, number]> }>, error?: string }>, unknownKeys?: string[] }>}
   * @example
   * const snap = await sdk.infrastructure.metricsSnapshot({
   *   container: 'app1', clusterName: 'z-01', addon: 'nats', namespace: 'nats', releaseName: 'nats'
   * });
   * // → { available: true, range: '1h', metrics: { qps: { current: 12.3, series: [...] } }, unknownKeys: [] }
   */
  metricsSnapshot({ container, clusterName, addon, namespace, releaseName, keys, range, includeSeries, branch }) {
    return this.sdk._fetch(`${this._base(container)}/metrics/snapshot`, 'GET', {
      query: {
        cluster: clusterName,
        addon,
        namespace,
        releaseName,
        keys: Array.isArray(keys) ? keys.join(',') : keys,
        range,
        includeSeries: includeSeries ? '1' : undefined,
        branch,
      },
    });
  }

  /**
   * Get a cluster's pod and service CIDRs (derived from the live cluster).
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.clusterName - Cluster name.
   * @param {string} [params.branch]    - Config branch (default 'main').
   * @returns {Promise<{ podCIDR: string, serviceCIDR: string }>}
   * @example
   * const net = await sdk.infrastructure.clusterNetwork({ container: 'app1', clusterName: 'z-01' });
   */
  clusterNetwork({ container, clusterName, branch }) {
    return this.sdk._fetch(`${this._base(container)}/cluster-network`, 'GET', {
      query: { clusterName, branch },
    });
  }

  /**
   * List available versions for an addon (helm repo search, OCI/local pinned
   * version, or EKS-addon versions — `clusterName` required for eks-addons).
   *
   * @param {object} params
   * @param {string} params.container    - Container name.
   * @param {string} params.addonName    - Addon id.
   * @param {string} [params.clusterName] - Cluster name (required for eks-addons).
   * @param {string} [params.branch]     - Config branch (default 'main').
   * @returns {Promise<{ versions: Array<{ version: string, appVersion?: string, description?: string }>, addonName: string }>}
   * @example
   * const { versions } = await sdk.infrastructure.versions({ container: 'app1', addonName: 'nats' });
   */
  versions({ container, addonName, clusterName, branch }) {
    return this.sdk._fetch(`${this._base(container)}/versions`, 'POST', {
      body: { addonName, clusterName, branch },
    });
  }

  /**
   * Install / reconcile a zeus-managed addon on a cluster (currently only
   * 'zeus-mesh-webhook').
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.addonName   - zeus-managed addon id (e.g. 'zeus-mesh-webhook').
   * @param {string} params.clusterName - Cluster name.
   * @returns {Promise<{ ok: true, applied: Array<object> }>}
   * @example
   * await sdk.infrastructure.zeusManaged({ container: 'app1', addonName: 'zeus-mesh-webhook', clusterName: 'z-01' });
   */
  zeusManaged({ container, addonName, clusterName }) {
    return this.sdk._fetch(`${this._base(container)}/zeus-managed`, 'POST', {
      body: { addonName, clusterName },
    });
  }

  // ─── Operations / upgrade steps ─────────────────────────────────────────

  /**
   * Run an addon operation against the live cluster. Dispatches on `action`:
   * `list-pods`, `exec`, `verify` (port-forward GET), `delete-pod`,
   * `run-operation` (a catalog operation: rolling-restart or per-pod exec),
   * `valkey-topology` (per-pod replication roles for a valkey release),
   * `valkey-make-master` (sentinel-driven in-cluster promote of `podName`).
   *
   * @param {object} params
   * @param {string} params.container    - Container name.
   * @param {string} params.action       - Operation action (see list above).
   * @param {string} [params.clusterName] - Cluster name (resolves kube context).
   * @param {string} [params.namespace]  - Namespace.
   * @param {string} [params.releaseName] - Release name (list-pods / run-operation).
   * @param {string} [params.addonName]  - Addon id (run-operation).
   * @param {string} [params.operationId] - Catalog operation id (run-operation).
   * @param {string} [params.podName]    - Target pod (exec / verify / delete-pod).
   * @param {string} [params.container_]  - Container within the pod (exec). Sent as `container` body field — note this is distinct from the path `container`.
   * @param {string} [params.command]    - Command (exec).
   * @param {number} [params.port]        - Port (verify).
   * @param {string} [params.path]        - Path (verify).
   * @param {string} [params.masterSet]   - Sentinel master-set name (valkey-make-master; default 'mymaster').
   * @param {string} [params.branch]      - Config branch (default 'main').
   * @returns {Promise<object>} Action-dependent JSON (e.g. `{ pods }`, `{ success, output }`, `{ success, results, operation }`).
   * @example
   * const { pods } = await sdk.infrastructure.operation({
   *   container: 'app1', action: 'list-pods', clusterName: 'z-01', namespace: 'nats', releaseName: 'nats'
   * });
   */
  operation({ container, action, clusterName, namespace, releaseName, addonName, operationId, podName, container_, command, port, path, masterSet, branch }) {
    return this.sdk._fetch(`${this._base(container)}/operations`, 'POST', {
      body: { action, clusterName, namespace, releaseName, addonName, operationId, podName, container: container_, command, port, path, masterSet, branch },
    });
  }

  /**
   * List or apply addon upgrade steps (Zeus-applied CRD / manifest steps keyed
   * by addon + from→to version). `action: 'list'` returns the applicable steps;
   * `action: 'apply'` SSA-applies one step's manifests (returns synchronous
   * JSON, HTTP 207 on partial failure).
   *
   * @param {object} params
   * @param {string} params.container    - Container name.
   * @param {('list'|'apply')} params.action - List applicable steps or apply one.
   * @param {string} params.addonName    - Addon id.
   * @param {string} params.clusterName  - Cluster name.
   * @param {string} [params.fromVersion] - Current version (scopes which steps apply).
   * @param {string} [params.stepId]     - Step id (required for 'apply').
   * @param {string} [params.kubeContext] - Override kube context ('apply').
   * @param {string} [params.branch]     - Config branch (default 'main').
   * @returns {Promise<{ steps: Array<object> } | { ok: boolean, results: Array<object>, errors: Array<object> }>}
   * @example
   * const { steps } = await sdk.infrastructure.upgradeStep({
   *   container: 'app1', action: 'list', addonName: 'cert-manager', clusterName: 'z-01', fromVersion: '1.14.0'
   * });
   * await sdk.infrastructure.upgradeStep({
   *   container: 'app1', action: 'apply', addonName: 'cert-manager', clusterName: 'z-01', stepId: steps[0].id
   * });
   */
  upgradeStep({ container, action, addonName, clusterName, fromVersion, stepId, kubeContext, branch }) {
    return this.sdk._fetch(`${this._base(container)}/upgrade-step`, 'POST', {
      body: { action, addonName, clusterName, fromVersion, stepId, kubeContext, branch },
    });
  }
}
