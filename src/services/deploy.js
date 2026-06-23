// @ts-nocheck
/**
 * DeployService — non-container-scoped v2configs utility endpoints.
 *
 * Accessed as `sdk.deploy`.
 *
 * These routes don't live under `/api/v2configs/[container]/...` — they're
 * shared utility endpoints that take the target `container` (plus `branch`,
 * default `'main'`) in the request body or query. They cover the deploy
 * pipeline (generate → validate → dry-run → deploy → status), shared
 * config/env-file layers, node-group user-data preview/validation, MySQL
 * replication ops, GitHub repo import, IAM/GCP identity catalogs + policy
 * validation, and a CIDR-overlap check.
 *
 * Typical deploy lifecycle:
 *   1. `validate({ container, type, data })` — lint a service/cluster/env config.
 *   2. `generate(...)` / `dryRunWrite(...)` — render YAML, optionally to disk.
 *   3. `deploy({ container, envName, clusterNames })` — generate per cluster.
 *   4. `status({ container, envName, clusterName })` — live namespace/secret/service state.
 *
 * Methods throw `ZeusApiError` on HTTP 4xx/5xx — you don't handle errors yourself.
 */
export class DeployService {
  constructor(sdk) { this.sdk = sdk; }

  // ── Deploy pipeline ─────────────────────────────────────────

  /**
   * Generate the full multi-phase deployment for an environment across one or
   * more clusters (namespaces, infra, secrets, configmaps, service groups,
   * whitelabel). Pure generation — writes nothing to a cluster.
   *
   * @param {object} params
   * @param {string} params.container        - Target container/workspace.
   * @param {string} params.envName          - Environment name.
   * @param {string[]} params.clusterNames   - Non-empty list of cluster names.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ results: Record<string, { phases: Array<object>, warnings: string[] }> }>}
   *   Keyed by cluster name; a failed cluster yields `{ phases: [], warnings: [msg] }`.
   * @example
   * const { results } = await sdk.deploy.deploy({
   *   container: 'app1', envName: 'prod', clusterNames: ['z-01'],
   * });
   * // → { results: { 'z-01': { phases: [...], warnings: [] } } }
   */
  deploy({ container, envName, clusterNames, branch }) {
    return this.sdk._fetch('/v2configs/deploy', 'POST', {
      body: { container, envName, clusterNames, branch },
    });
  }

  /**
   * Live deploy status for an env on a cluster — namespace existence, secret
   * presence + drift, and per-service workload health (with a cheap config-hash
   * drift check). Dispatches the route's default `handleStatus` action.
   *
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.envName
   * @param {string} params.clusterName
   * @param {string} [params.branch='main']
   * @returns {Promise<{
   *   clusterName: string,
   *   namespaces: Array<{ name: string, exists: boolean, status: string|null }>,
   *   secrets: Record<string, Array<{ name, exists, type, keys, autoInjected, drift }>>,
   *   services: Array<object>,
   * }>}
   * @example
   * const st = await sdk.deploy.status({ container: 'app1', envName: 'prod', clusterName: 'z-01' });
   */
  status({ container, envName, clusterName, branch }) {
    return this.sdk._fetch('/v2configs/deploy/status', 'POST', {
      body: { container, envName, clusterName, branch },
    });
  }

  /**
   * Low-level escape hatch for the deploy/status route's action dispatcher
   * (`secret-value`, `ensure-namespaces`, `apply-secrets`, `generate-service`,
   * `apply-services`, `service-pods`, `check-drift`, `restart-service`,
   * `scale-service`, `delete-service`, `uninstall-preview`, `uninstall-service`,
   * `list-crons`, `trigger-cron`, `cron-job-logs`). Pass `action` + that
   * action's fields; the response shape varies per action.
   *
   * @param {object} body - Must include `action` and the action's params (always `container`).
   * @returns {Promise<object>} Action-specific response.
   * @example
   * const { pods } = await sdk.deploy.statusAction({
   *   action: 'service-pods', container: 'app1', envName: 'prod',
   *   clusterName: 'z-01', namespace: 'default', serviceNames: ['api'],
   * });
   */
  statusAction(body) {
    return this.sdk._fetch('/v2configs/deploy/status', 'POST', { body });
  }

  /**
   * Dry-run: generate all YAML for an env+cluster and write it to
   * `/tmp/v2-dryrun/{envName}/{clusterName}/`, returning the on-disk file tree.
   *
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.envName
   * @param {string} params.clusterName
   * @param {string} [params.branch='main']
   * @returns {Promise<{
   *   outputPath: string,
   *   fileTree: Array<{ phase, displayName, group, services, files: string[] }>,
   *   totalFiles: number,
   *   warnings: string[],
   *   generatedAt: string,
   * }>}
   * @example
   * const { outputPath, totalFiles } = await sdk.deploy.dryRunWrite({
   *   container: 'app1', envName: 'prod', clusterName: 'z-01',
   * });
   */
  dryRunWrite({ container, envName, clusterName, branch }) {
    return this.sdk._fetch('/v2configs/dryrun', 'POST', {
      body: { container, envName, clusterName, branch },
    });
  }

  /**
   * Read back a single generated dry-run file for preview.
   *
   * @param {object} params
   * @param {string} params.envName
   * @param {string} params.clusterName
   * @param {string} params.filePath - Path relative to the dry-run output dir.
   * @returns {Promise<{ content: string, filePath: string }>}
   * @example
   * const { content } = await sdk.deploy.dryRunFile({
   *   envName: 'prod', clusterName: 'z-01', filePath: '01-namespaces/ns.yaml',
   * });
   */
  dryRunFile({ envName, clusterName, filePath }) {
    return this.sdk._fetch('/v2configs/dryrun', 'GET', {
      query: { envName, clusterName, filePath },
    });
  }

  /**
   * Generate the rendered YAML for one named service in an env (with connection
   * injection). Returns the generator result (`files`, `warnings`, ...).
   *
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.serviceName
   * @param {string} params.envName
   * @param {string} params.clusterName
   * @param {string} [params.branch='main']
   * @returns {Promise<{ files: Array<{ name: string, content: string }>, warnings: string[] }>}
   * @example
   * const { files } = await sdk.deploy.generateService({
   *   container: 'app1', serviceName: 'api', envName: 'prod', clusterName: 'z-01',
   * });
   */
  generateService({ container, serviceName, envName, clusterName, branch }) {
    return this.sdk._fetch('/v2configs/generate', 'POST', {
      body: { container, serviceName, envName, clusterName, branch },
    });
  }

  /**
   * Preview YAML for an ad-hoc service config object (not yet saved). Uses the
   * first cluster when `clusterName` is omitted.
   *
   * @param {object} params
   * @param {string} params.container
   * @param {object} params.serviceConfig - A full service template object (must have `name`).
   * @param {string} params.envName
   * @param {string} [params.clusterName]
   * @param {string} [params.branch='main']
   * @returns {Promise<{ files: Array<{ name: string, content: string }>, warnings: string[] }>}
   * @example
   * const res = await sdk.deploy.generatePreview({
   *   container: 'app1', envName: 'prod', serviceConfig: { name: 'api', image: '...' },
   * });
   */
  generatePreview({ container, serviceConfig, envName, clusterName, branch }) {
    return this.sdk._fetch('/v2configs/generate/preview', 'POST', {
      body: { container, serviceConfig, envName, clusterName, branch },
    });
  }

  /**
   * Validate a service / cluster / environment config object against the
   * container's clusters + environments + services.
   *
   * @param {object} params
   * @param {string} params.container
   * @param {object} params.data - The config object to validate.
   * @param {'service'|'cluster'|'environment'} [params.type='service']
   * @param {string} [params.branch='main']
   * @returns {Promise<{ valid: boolean, errors?: Array<object>, warnings?: Array<object> }>}
   *   (Exact keys come from the validator; an unknown `type` 400s.)
   * @example
   * const v = await sdk.deploy.validate({ container: 'app1', type: 'service', data: svc });
   */
  validate({ container, data, type, branch }) {
    return this.sdk._fetch('/v2configs/validate', 'POST', {
      body: { container, data, type, branch },
    });
  }

  // ── Node-group user-data (pure, no AWS calls) ───────────────

  /**
   * Statically validate node-group user-data for an AMI type. No AWS calls.
   *
   * @param {object} params
   * @param {string} params.amiType  - AMI type id.
   * @param {string} params.userData - User-data script text.
   * @returns {Promise<object>} Validation result (errors/warnings per the validator).
   * @example
   * const r = await sdk.deploy.validateUserData({ amiType: 'AL2_x86_64', userData: '#!/bin/bash...' });
   */
  validateUserData({ amiType, userData }) {
    return this.sdk._fetch('/v2configs/validate-user-data', 'POST', {
      body: { amiType, userData },
    });
  }

  /**
   * Preview the tuning-preset user-data block Zeus would inject for a given
   * node-group shape. Pure — no AWS calls.
   *
   * @param {object} params
   * @param {string} params.preset
   * @param {string} params.amiType
   * @param {string} params.instanceType
   * @param {number} [params.podMemoryRequestMiB=0]
   * @returns {Promise<object>} The rendered preset block.
   * @example
   * const block = await sdk.deploy.userDataPreview({
   *   preset: 'balanced', amiType: 'AL2_x86_64', instanceType: 'm5.large',
   * });
   */
  userDataPreview({ preset, amiType, instanceType, podMemoryRequestMiB }) {
    return this.sdk._fetch('/v2configs/user-data-preview', 'POST', {
      body: { preset, amiType, instanceType, podMemoryRequestMiB },
    });
  }

  // ── Shared env-file + common layers ─────────────────────────

  /**
   * List env-file layers. Without `envName`: the global layer only. With
   * `envName`: global + env layers, plus a merged preview for `service`.
   *
   * @param {object} [params]
   * @param {string} [params.branch='main']
   * @param {string} [params.envName]   - Include env layer (requires `container`).
   * @param {string} [params.service]   - Include a merged preview for this service.
   * @param {string} [params.container] - Required when `envName` is given.
   * @returns {Promise<{ global: object, env?: object, merged?: object }>}
   * @example
   * const { global } = await sdk.deploy.listEnvFiles();
   * const { env, merged } = await sdk.deploy.listEnvFiles({ container: 'app1', envName: 'prod', service: 'api' });
   */
  listEnvFiles({ branch, envName, service, container } = {}) {
    return this.sdk._fetch('/v2configs/env-files', 'GET', {
      query: { branch, envName, service, container },
    });
  }

  /**
   * Create/overwrite an env file in the global or env-scoped layer.
   *
   * @param {object} params
   * @param {'global'|'env'} params.scope
   * @param {string} params.filename
   * @param {string} params.content
   * @param {string} [params.branch='main']
   * @param {string} [params.envName]   - Required for `scope:'env'`.
   * @param {string} [params.container] - Required for `scope:'env'`.
   * @returns {Promise<{ ok: boolean }>}
   * @example
   * await sdk.deploy.saveEnvFile({ scope: 'global', filename: 'api.txt', content: 'FOO=1' });
   */
  saveEnvFile({ scope, filename, content, branch, envName, container }) {
    return this.sdk._fetch('/v2configs/env-files', 'PUT', {
      body: { scope, filename, content, branch, envName, container },
    });
  }

  /**
   * Delete an env file from the global or env-scoped layer.
   *
   * @param {object} params
   * @param {'global'|'env'} params.scope
   * @param {string} params.filename
   * @param {string} [params.branch='main']
   * @param {string} [params.envName]   - Required for `scope:'env'`.
   * @param {string} [params.container] - Required for `scope:'env'`.
   * @returns {Promise<{ ok: boolean }>}
   * @example
   * await sdk.deploy.deleteEnvFile({ scope: 'global', filename: 'api.txt' });
   */
  deleteEnvFile({ scope, filename, branch, envName, container }) {
    return this.sdk._fetch('/v2configs/env-files', 'DELETE', {
      query: { scope, filename, branch, envName, container },
    });
  }

  /**
   * Read the shared `common` config block for a branch.
   *
   * @param {object} [params]
   * @param {string} [params.branch='main']
   * @returns {Promise<{ common: object }>}
   * @example
   * const { common } = await sdk.deploy.getCommon();
   */
  getCommon({ branch } = {}) {
    return this.sdk._fetch('/v2configs/common', 'GET', { query: { branch } });
  }

  /**
   * Replace the shared `common` config block.
   *
   * @param {object} params
   * @param {object} params.data - New common config object.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ common: object }>}
   * @example
   * await sdk.deploy.saveCommon({ data: { region: 'us-east-2' } });
   */
  saveCommon({ data, branch }) {
    return this.sdk._fetch('/v2configs/common', 'PUT', { body: { data, branch } });
  }

  /**
   * Get the provider/cluster preset catalog (defaults the wizards use).
   *
   * @returns {Promise<{ presets: object, providers: object }>}
   * @example
   * const { presets, providers } = await sdk.deploy.presets();
   */
  presets() { return this.sdk._fetch('/v2configs/presets', 'GET'); }

  // ── MySQL replication (ClusterSet) ──────────────────────────

  /**
   * Read-only MySQL replication queries, routed by `action`:
   * `discover` (config index), `status` (live per-set board),
   * `preflight` (checks before a mutating op), `activity` (recent log).
   *
   * @param {object} params
   * @param {'discover'|'status'|'preflight'|'activity'} params.action
   * @param {string} [params.container] - Required for discover/status/preflight.
   * @param {string} [params.setName]   - Target ClusterSet (status/preflight/activity).
   * @param {string} [params.branch='main']
   * @param {string} [params.opAction]  - For preflight: the op being checked.
   * @param {object} [params.params]     - For preflight: op params.
   * @param {number} [params.limit]      - For activity: max entries.
   * @returns {Promise<object>} Action-specific body (the route returns `result.body`).
   * @example
   * const board = await sdk.deploy.mysqlReplication({ action: 'status', container: 'app1', setName: 'main' });
   */
  mysqlReplication({ action, container, setName, branch, opAction, params, limit }) {
    return this.sdk._fetch('/v2configs/replication/mysql', 'POST', {
      body: { action, container, setName, branch, opAction, params, limit },
    });
  }

  /**
   * Run a mutating MySQL ClusterSet action (`create`, `add-replica`,
   * `switchover`, `failover`, `rejoin`) as an **SSE stream** of progress events.
   * Dry-run unless `execute:true`.
   *
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.setName
   * @param {'create'|'add-replica'|'switchover'|'failover'|'rejoin'} params.action
   * @param {object} [params.params]
   * @param {boolean} [params.execute=false] - Actually apply (else dry-run).
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../stream.js').openStream>} SSE handle:
   *   async-iterable + `onOpen/onMessage/onError/onDone` + `close()`. Events are
   *   progress `{ type, data, raw }` (info/error/done from `createProgress`).
   * @example
   * const s = sdk.deploy.mysqlReplicationAction({ container: 'app1', setName: 'main', action: 'switchover', execute: true });
   * s.onMessage = (ev) => console.log(ev.type, ev.data);
   */
  mysqlReplicationAction({ container, setName, action, params, execute, branch }) {
    return this.sdk._stream('/v2configs/replication/mysql/action', 'POST', {
      body: { container, setName, action, params, execute, branch },
    });
  }

  // ── GitHub utility routes ───────────────────────────────────

  /**
   * List the GitHub scopes (orgs/owners) reachable with configured tokens.
   *
   * @returns {Promise<{ configured: boolean, scopes: Array<object> }>}
   * @example
   * const { configured, scopes } = await sdk.deploy.githubScopes();
   */
  githubScopes() { return this.sdk._fetch('/v2configs/github/scopes', 'GET'); }

  /**
   * Validate a GitHub repo URL is reachable; returns canonical metadata.
   *
   * @param {object} params
   * @param {string} params.url - The repo URL (ssh or https).
   * @returns {Promise<{ valid: boolean, repo?: { sshUrl: string, defaultBranch: string }, error?: string }>}
   * @example
   * const { valid, repo } = await sdk.deploy.githubValidate({ url: 'git@github.com:org/repo.git' });
   */
  githubValidate({ url }) {
    return this.sdk._fetch('/v2configs/github/validate', 'GET', { query: { url } });
  }

  /**
   * Search repos within a scope; each is annotated `imported` if a service in
   * `container` already uses it.
   *
   * @param {object} params
   * @param {string} params.scope     - Owner/org to search within.
   * @param {string} params.container - Container to dedup against.
   * @param {string} [params.q]       - Filter query.
   * @returns {Promise<{ configured: boolean, repos: Array<{ fullName: string, imported: boolean }> }>}
   * @example
   * const { repos } = await sdk.deploy.githubSearch({ scope: 'backvco', container: 'app1', q: 'api' });
   */
  githubSearch({ scope, container, q }) {
    return this.sdk._fetch('/v2configs/github/search', 'GET', { query: { scope, container, q } });
  }

  /**
   * Diagnostic: probe every configured token against one repo, reporting
   * per-token access. Use to debug "no token has access" errors.
   *
   * @param {object} params
   * @param {string} params.owner
   * @param {string} params.repo
   * @returns {Promise<{ owner: string, repo: string, configured: boolean, results: Array<object> }>}
   * @example
   * const { results } = await sdk.deploy.githubProbe({ owner: 'backvco', repo: 'app1-platform' });
   */
  githubProbe({ owner, repo }) {
    return this.sdk._fetch('/v2configs/github/probe', 'GET', { query: { owner, repo } });
  }

  /**
   * Import a GitHub repo as a new service in a container (or create a manual
   * service shell). Auto-derives names + image, imports `.env.example`.
   *
   * @param {object} params
   * @param {string} params.container
   * @param {string} [params.owner]       - With `repo`, imports from GitHub.
   * @param {string} [params.repo]
   * @param {boolean} [params.manual]      - Create a manual service (no repo).
   * @param {string} [params.name]         - Override the derived service name.
   * @param {string} [params.displayName]
   * @returns {Promise<{ name: string, serviceName: string, importedEnvFile: boolean, imageNameSource: string }>}
   *   409 if a service of that name already exists.
   * @example
   * await sdk.deploy.githubImport({ container: 'app1', owner: 'backvco', repo: 'app1-api' });
   */
  githubImport({ container, owner, repo, manual, name, displayName }) {
    return this.sdk._fetch('/v2configs/github/import', 'POST', {
      body: { container, owner, repo, manual, name, displayName },
    });
  }

  // ── Identity / IAM catalogs + policy validation ─────────────

  /**
   * Provider-agnostic catalog of services + verbs the permission DSL supports.
   *
   * @returns {Promise<{ aws: Array<object> }>}
   * @example
   * const { aws } = await sdk.deploy.identitiesCatalog();
   */
  identitiesCatalog() { return this.sdk._fetch('/v2configs/identities/catalog', 'GET'); }

  /**
   * Full AWS IAM action universe for the picker. One endpoint, three modes:
   * `services` (default), `actions` (needs `service`), `resource-types`
   * (needs `service`).
   *
   * @param {object} [params]
   * @param {'services'|'actions'|'resource-types'} [params.op='services']
   * @param {string} [params.service] - Required for actions/resource-types.
   * @returns {Promise<
   *   { services: Array<{ key: string, name: string }> } |
   *   { actions: Array<{ name, accessLevel, description, resourceTypes, isWildcardOnly, common }> } |
   *   { resourceTypes: Array<{ key: string, arn: string, conditionKeys: string[] }> }
   * >}
   * @example
   * const { actions } = await sdk.deploy.identitiesIamCatalog({ op: 'actions', service: 's3' });
   */
  identitiesIamCatalog({ op, service } = {}) {
    return this.sdk._fetch('/v2configs/identities/iam-catalog', 'GET', { query: { op, service } });
  }

  /**
   * Compile + validate an identity's permission DSL into an IAM policy
   * (local action-exists check + AWS AccessAnalyzer findings).
   *
   * @param {object} params
   * @param {Array<object>} params.permissions - The DSL rows.
   * @returns {Promise<{
   *   policy: object|null,
   *   findings: Array<{ findingType, issueCode, message, learnMoreLink?, locations }>,
   *   bytes: number, byteLimit: number, error?: string,
   * }>}
   * @example
   * const { findings } = await sdk.deploy.validatePolicy({ permissions: [{ service: 's3', actions: ['GetObject'] }] });
   */
  validatePolicy({ permissions }) {
    return this.sdk._fetch('/v2configs/identities/validate-policy', 'POST', { body: { permissions } });
  }

  /**
   * Validate a GCP identity manifest (schema check, plus an optional live
   * `testIamPermissions` check when `accountId` is given).
   *
   * @param {object} params
   * @param {object} params.manifest
   * @param {string} [params.accountId] - GCP account for the live check.
   * @returns {Promise<{ ok: boolean, errors: string[], warnings: string[] }>}
   * @example
   * const { ok, errors } = await sdk.deploy.validateGcpManifest({ manifest });
   */
  validateGcpManifest({ manifest, accountId }) {
    return this.sdk._fetch('/v2configs/identities/validate-gcp-manifest', 'POST', {
      body: { manifest, accountId },
    });
  }

  // ── CIDR overlap check ──────────────────────────────────────

  /**
   * Check a proposed CIDR for overlap against every known network in Zeus.
   * Read-only.
   *
   * @param {object} params
   * @param {string} params.cidr
   * @param {string} [params.excludeBundle]    - Skip a bundle (editing it).
   * @param {string} [params.excludeSubnetId]  - Skip a subnet (editing it).
   * @param {string} [params.branch='main']
   * @returns {Promise<{
   *   cidr: string,
   *   overlaps: Array<{ cidr, source, bundleName?, subnetId?, region?, label }>,
   *   totalKnown: number,
   * }>}
   * @example
   * const { overlaps } = await sdk.deploy.cidrCheck({ cidr: '10.20.0.0/16' });
   */
  cidrCheck({ cidr, excludeBundle, excludeSubnetId, branch }) {
    return this.sdk._fetch('/v2configs/networks/cidr-check', 'POST', {
      body: { cidr, excludeBundle, excludeSubnetId },
      query: { branch },
    });
  }
}
