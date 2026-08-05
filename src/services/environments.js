// @ts-nocheck
import { casMutate, resolveBaseRev } from '../cas.js';
/**
 * EnvironmentsService — v2configs environments, accessed as `sdk.environments`.
 *
 * An environment is a container-scoped deployment target: it tracks the
 * clusters it deploys to, the namespaces it owns (plus their secrets/
 * configMaps), white-label domains, backup profiles, and per-service
 * networking. Every method is container-scoped — the first param is always
 * `container` and most also take the environment `name`. Routes that read
 * `?branch=` (defaulting to `'main'`) accept an optional `branch`.
 *
 * Typical lifecycle:
 *   list → create (POST) → get → update (PUT) → duplicate → delete.
 * Operational extras: discover/move namespaces, cluster teardown (SSE),
 * DNS sync (env + per-service), static IP pools, and backup profiles.
 *
 * Streaming methods ({@link clusterTeardown}, {@link migrateBackupDeployments})
 * return an SSE stream handle from `openStream`: async-iterable + assignable
 * `onOpen/onMessage/onError/onDone` callbacks + `close()`.
 *
 * All paths are relative to baseURL (which already includes `/api`).
 */
export class EnvironmentsService {
  constructor(sdk) { this.sdk = sdk; }

  /** Base path for a container's environments collection. @private */
  _base(container) {
    return `/v2configs/${encodeURIComponent(container)}/environments`;
  }

  /** Base path for a single environment. @private */
  _env(container, name) {
    return `${this._base(container)}/${encodeURIComponent(name)}`;
  }

  // ─────────────────────────── collection ───────────────────────────

  /**
   * List all environments in a container.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ environments: Array<object> }>}
   * @example
   * const { environments } = await sdk.environments.list({ container: 'app1' });
   */
  list({ container, branch } = {}) {
    return this.sdk._fetch(this._base(container), 'GET', { query: { branch } });
  }

  /**
   * Create (or overwrite) an environment by name.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name (required).
   * @param {object} [params.data]     - Environment config document.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ environment: object }>}
   * @example
   * await sdk.environments.create({ container: 'app1', name: 'dev-d00', data: {} });
   */
  create({ container, name, data, branch } = {}) {
    return this.sdk._fetch(this._base(container), 'POST', { body: { name, data, branch } });
  }

  // ──────────────────────────── single env ──────────────────────────

  /**
   * Get one environment. 404s if it doesn't exist.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ environment: object }>}
   * @example
   * const { environment } = await sdk.environments.get({ container: 'app1', name: 'dev-d00' });
   */
  get({ container, name, branch } = {}) {
    return this.sdk._fetch(this._env(container, name), 'GET', { query: { branch } });
  }

  /**
   * Update an environment (replace its config document).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {object} [params.data]     - New config document.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ environment: object }>}
   * Optimistic concurrency (see docs/environments.md): sends `baseRev`
   * (default `data._rev ?? null`); a mismatch 409s `{ kind: 'stale-save' }`
   * without writing. Prefer {@link mutate} for programmatic edits.
   *
   * @param {number|null} [params.baseRev] - Revision this write is based on (default `data._rev ?? null`).
   * @example
   * await sdk.environments.update({ container: 'app1', name: 'dev-d00', data: env }); // env from get(), carries _rev
   */
  update({ container, name, data, branch, baseRev } = {}) {
    return this.sdk._fetch(this._env(container, name), 'PUT', {
      body: { data, branch, baseRev: resolveBaseRev(data, baseRev) },
    });
  }

  /**
   * Read-mutate-write with automatic stale-save retry: fetch → apply `fn` →
   * save with the fetched `_rev`; on 409 re-fetch and re-apply `fn` (CAS
   * retry, never a stale merge). See casMutate in ../cas.js.
   *
   * @param {{container: string, name: string, branch?: string, retries?: number}} params
   * @param {(environment: object) => object|void|Promise<object|void>} fn - Mutation to apply.
   * @returns {Promise<{ environment: object }>}
   * @example
   * await sdk.environments.mutate({ container: 'app1', name: 'dev-d00' }, (env) => { env.suspended = false; });
   */
  mutate({ container, name, branch, retries } = {}, fn) {
    return casMutate({
      read: async () => (await this.get({ container, name, branch })).environment,
      write: (data, baseRev) => this.update({ container, name, data, branch, baseRev }),
      mutate: fn,
      retries,
    });
  }

  /**
   * Delete an environment. 404s if missing.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} [params.branch='main'] - Config branch (query param).
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.environments.delete({ container: 'app1', name: 'dev-d00' });
   */
  delete({ container, name, branch } = {}) {
    return this.sdk._fetch(this._env(container, name), 'DELETE', { query: { branch } });
  }

  /**
   * Duplicate an environment to a new name.
   *
   * @param {object} params
   * @param {string} params.container  - Container name.
   * @param {string} params.name       - Source environment name.
   * @param {string} params.targetName - New environment name (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ environment: object }>}
   * @example
   * await sdk.environments.duplicate({ container: 'app1', name: 'dev-d00', targetName: 'dev-d01' });
   */
  duplicate({ container, name, targetName, branch } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/duplicate`, 'POST', {
      body: { targetName, branch },
    });
  }

  // ──────────────────────────── namespaces ──────────────────────────

  /**
   * List every K8s namespace on a cluster, each tagged with whether it's
   * already tracked by some env (and which container/env owns it).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name (path scope only).
   * @param {string} params.cluster   - Cluster name to scan (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ namespaces: Array<{
   *   name: string, status: string, createdAt: string,
   *   trackedBy: { container: string, environment: string } | null
   * }> }>}
   * @example
   * const { namespaces } = await sdk.environments.discoverNamespaces({
   *   container: 'app1', name: 'system', cluster: 'z-01' });
   */
  discoverNamespaces({ container, name, cluster, branch } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/discover-namespaces`, 'GET', {
      query: { cluster, branch },
    });
  }

  /**
   * Move a namespace (plus its secrets[ns] and configMaps[ns]) from this env
   * to another env. Aborts (409) if the target already tracks the namespace.
   *
   * @param {object} params
   * @param {string} params.container         - Source container name.
   * @param {string} params.name              - Source environment name.
   * @param {string} params.namespace         - Namespace key to move (required).
   * @param {string} params.targetContainer   - Target container (required).
   * @param {string} params.targetEnvironment - Target environment (required).
   * @param {string} [params.branch='main']   - Config branch.
   * @returns {Promise<{
   *   ok: true, moved: string,
   *   from: { container: string, environment: string },
   *   to: { container: string, environment: string },
   *   secretsMoved: number, configMapsMoved: number
   * }>}
   * @example
   * await sdk.environments.moveNamespace({
   *   container: 'app1', name: 'dev-d00', namespace: 'addons',
   *   targetContainer: 'app1', targetEnvironment: 'system' });
   */
  moveNamespace({ container, name, namespace, targetContainer, targetEnvironment, branch } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/move-namespace`, 'POST', {
      body: { namespace, targetContainer, targetEnvironment, branch },
    });
  }

  // ───────────────────────── cluster teardown ───────────────────────

  /**
   * Scan everything an env installed onto a cluster (non-streaming preview).
   * This is the `action: 'scan'` branch of the cluster-teardown route.
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.name        - Environment name.
   * @param {string} params.clusterName - Cluster to scan (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} Teardown inventory (shape from scanEnvClusterResources).
   * @example
   * const inventory = await sdk.environments.scanClusterTeardown({
   *   container: 'app1', name: 'dev-d00', clusterName: 'z-01' });
   */
  scanClusterTeardown({ container, name, clusterName, branch } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/cluster-teardown`, 'POST', {
      body: { action: 'scan', clusterName, branch },
    });
  }

  /**
   * Execute cluster teardown for an env and unlink the cluster on success.
   * STREAMING — the `action: 'execute'` branch returns an SSE run stream.
   * On any hard failure the cluster is left linked so the user can retry.
   *
   * @param {object} params
   * @param {string} params.container   - Container name.
   * @param {string} params.name        - Environment name.
   * @param {string} params.clusterName - Cluster to tear down (required).
   * @param {boolean} [params.force=false]         - Force-unlink without cleanup.
   * @param {boolean} [params.deleteVolumes=false] - Also delete persistent volumes.
   * @param {string} [params.branch='main']        - Config branch.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE run stream
   *   (`info`/`step`/`error`/`done` events from the run progress).
   * @example
   * const s = sdk.environments.clusterTeardown({
   *   container: 'app1', name: 'dev-d00', clusterName: 'z-01' });
   * s.onMessage = (ev) => console.log(ev.data);
   * // later: s.close();
   */
  clusterTeardown({ container, name, clusterName, force, deleteVolumes, branch } = {}) {
    return this.sdk._stream(`${this._env(container, name)}/cluster-teardown`, 'POST', {
      body: { action: 'execute', clusterName, force, deleteVolumes, branch },
    });
  }

  // ──────────────────────────── env DNS ─────────────────────────────

  /**
   * Compute the env's desired DNS records vs. live records, each with a
   * status (`in-sync`/`drift`/`missing`/`stale`/`no-zone`) and bound zone.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ records: Array<object> }>}
   * @example
   * const { records } = await sdk.environments.dns({ container: 'app1', name: 'dev-d00' });
   */
  dns({ container, name, branch } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/dns`, 'GET', { query: { branch } });
  }

  /**
   * Apply env DNS changes, or list/delete white-label DNS records.
   * Routes by `action` (branch is fixed to 'main' server-side):
   *   - `'apply'`            → write UPSERT/DELETE changes; returns { results, applied }.
   *   - `'list-whitelabel'`  → preview live records under a white-label domain.
   *   - `'delete-whitelabel'`→ delete this env's white-label records.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {'apply'|'list-whitelabel'|'delete-whitelabel'} params.action
   * @param {Array<object>} [params.changes] - DNS changes (for `apply`).
   * @param {object} [params.wlEntry]         - White-label entry (for the white-label actions).
   * @returns {Promise<object>} `apply` → { results, applied }; `list-whitelabel` → { domain, zone, records };
   *   `delete-whitelabel` → { domain, zone, deleted, failed, ok }.
   * @example
   * await sdk.environments.applyDns({ container: 'app1', name: 'dev-d00', action: 'apply', changes });
   */
  applyDns({ container, name, action, changes, wlEntry } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/dns`, 'POST', {
      body: { action, changes, wlEntry },
    });
  }

  // ───────────────────────── backup profiles ────────────────────────

  /**
   * List an env's backup profiles (sanitized — secrets stripped), the
   * default profile, and the deployment-usage index.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ profiles: object, defaultProfile: string|null, usage: object }>}
   * @example
   * const { profiles } = await sdk.environments.backupProfiles({ container: 'app1', name: 'dev-d00' });
   */
  backupProfiles({ container, name, branch } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/backup-profiles`, 'GET', {
      query: { branch },
    });
  }

  /**
   * Action-routed backup-profiles mutations. The route dispatches on `action`:
   *   `upsert` | `remove` | `set-default` | `test` | `list-buckets` |
   *   `describe-bucket` | `create-bucket` | `list-iam-users` |
   *   `create-iam-keys` | `preview-policy` | `list-usage` | `plan-reconcile` |
   *   `apply-reconcile` | `drift-snapshot`.
   * Pass the action plus that action's fields (e.g. `name`, `profile`,
   * `defaultProfile`, `region`, `bucketName`, `pathPrefix`, `rotate`,
   * `deleteOrphans`, `branch`). Response shape depends on the action.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} [params.action]  - One of the actions above.
   * @param {object} [params.body]    - Explicit verbatim body — use when the
   *   action payload has its own `name` field (profile/bucket name) that would
   *   collide with the environment `name`.
   * @param {object} [params....]     - Action-specific body fields (when not using `body`).
   * @returns {Promise<object>} Action-specific result.
   * @example
   * await sdk.environments.backupProfileAction({
   *   container: 'app1', name: 'dev-d00', action: 'set-default', defaultProfile: 'primary' });
   * await sdk.environments.backupProfileAction({ container: 'app1', name: 'dev-d00', body: { action: 'upsert', name: 'primary', ... } });
   */
  backupProfileAction({ container, name, body, ...rest } = {}) {
    return this.sdk._fetch(`${this._env(container, name)}/backup-profiles`, 'POST', { body: body ?? rest });
  }

  /**
   * Migrate legacy backup-enabled deployments to a backup profile. STREAMING.
   * Defaults to a dry run (returns the plan) unless `dryRun: false`.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {boolean} [params.dryRun=true] - Plan only when true; write when false.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE stream; terminal
   *   payload is `{ dryRun, planned, skipped, summary }`.
   * @example
   * const s = sdk.environments.migrateBackupDeployments({
   *   container: 'app1', name: 'dev-d00', dryRun: false });
   * s.onMessage = (ev) => console.log(ev.data);
   */
  migrateBackupDeployments({ container, name, dryRun, branch } = {}) {
    return this.sdk._stream(
      `${this._env(container, name)}/backup-profiles/migrate-deployments`,
      'POST',
      { body: { dryRun, branch } },
    );
  }

  // ──────────────────────── per-service DNS / IPs ───────────────────

  /** Base path for an env-service subtree. @private */
  _svc(container, name, service) {
    return `${this._env(container, name)}/services/${encodeURIComponent(service)}`;
  }

  /**
   * Per-service DNS — desired vs. live records (with status), the service's
   * `networking.dns` block, alias↔EIP↔pod bindings, and warnings.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} params.service   - Service name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ records: Array<object>, dnsConfig: object|null,
   *   bindings?: Array<object>, isMultiCluster?: boolean, warnings?: string[],
   *   applyEnabled?: boolean, message?: string }>}
   * @example
   * const { records } = await sdk.environments.serviceDns({
   *   container: 'app1', name: 'dev-d00', service: 'sip' });
   */
  serviceDns({ container, name, service, branch } = {}) {
    return this.sdk._fetch(`${this._svc(container, name, service)}/dns`, 'GET', {
      query: { branch },
    });
  }

  /**
   * Apply per-service DNS changes (only `action: 'apply'` is supported;
   * branch is fixed to 'main' server-side).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} params.service   - Service name.
   * @param {Array<object>} params.changes - DNS changes to write (required).
   * @returns {Promise<{ results: Array<object>, applied: number }>}
   * @example
   * await sdk.environments.applyServiceDns({
   *   container: 'app1', name: 'dev-d00', service: 'sip', changes });
   */
  applyServiceDns({ container, name, service, changes } = {}) {
    return this.sdk._fetch(`${this._svc(container, name, service)}/dns`, 'POST', {
      body: { action: 'apply', changes },
    });
  }

  /**
   * List the static-IP pool for an (env, service, cluster), with region-wide
   * quota utilization. The pool is scoped per cluster so StatefulSet ordinals
   * don't collide across clusters.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} params.service   - Service name.
   * @param {string} params.cloud     - Cloud key, e.g. `'aws'` | `'gcp'` (required).
   * @param {string} params.region    - Provider region (required).
   * @param {string} params.cluster   - Cluster name (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ ips: Array<object>, quota: object|null,
   *   cloud: string, region: string, cluster: string }>}
   * @example
   * const { ips } = await sdk.environments.serviceStaticIps({
   *   container: 'app1', name: 'dev-d00', service: 'sip',
   *   cloud: 'aws', region: 'us-east-2', cluster: 'z-01' });
   */
  serviceStaticIps({ container, name, service, cloud, region, cluster, branch } = {}) {
    return this.sdk._fetch(`${this._svc(container, name, service)}/static-ips`, 'GET', {
      query: { cloud, region, cluster, branch },
    });
  }

  /**
   * Allocate a new static IP for an (env, service, cluster).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} params.service   - Service name.
   * @param {string} params.cloud     - Cloud key, e.g. `'aws'` | `'gcp'` (required).
   * @param {string} params.region    - Provider region (required).
   * @param {string} params.cluster   - Cluster name (required).
   * @param {string} [params.eipName] - Explicit Name tag (for ordinal pinning, e.g. `dev-d00-sip-0`).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ ip: object }>}
   * @example
   * await sdk.environments.allocateServiceStaticIp({
   *   container: 'app1', name: 'dev-d00', service: 'sip',
   *   cloud: 'aws', region: 'us-east-2', cluster: 'z-01', eipName: 'dev-d00-sip-0' });
   */
  allocateServiceStaticIp({ container, name, service, cloud, region, cluster, eipName, branch } = {}) {
    return this.sdk._fetch(`${this._svc(container, name, service)}/static-ips`, 'POST', {
      body: { cloud, region, cluster, eipName, branch },
    });
  }

  /**
   * Release a static IP from an (env, service) pool.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Environment name.
   * @param {string} params.service   - Service name.
   * @param {string} params.cloud     - Cloud key (required, query param).
   * @param {string} params.region    - Provider region (required, query param).
   * @param {string} params.id        - Allocation id, e.g. `eipalloc-xxx` (required, query param).
   * @returns {Promise<{ released: true }>}
   * @example
   * await sdk.environments.releaseServiceStaticIp({
   *   container: 'app1', name: 'dev-d00', service: 'sip',
   *   cloud: 'aws', region: 'us-east-2', id: 'eipalloc-0abc' });
   */
  releaseServiceStaticIp({ container, name, service, cloud, region, id } = {}) {
    return this.sdk._fetch(`${this._svc(container, name, service)}/static-ips`, 'DELETE', {
      query: { cloud, region, id },
    });
  }
}
