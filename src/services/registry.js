// @ts-nocheck
/**
 * ServiceRegistryService — the legacy `/api/services/**` image-build & registry
 * surface (NOT container-scoped in the URL path; `container` is passed via
 * query/body where the route needs it to resolve workspace registry creds).
 *
 * Accessed as `sdk.services.registry`.
 *
 * Covers a service's whole image lifecycle:
 *   - per-service build config (`config`) — image name, repo, registryId, envs
 *   - GitHub build-file editing → PR (`buildFiles`)
 *   - live cluster workload discovery for a service (`clusterInfo`)
 *   - build orchestration (`build*`, including an SSE log stream)
 *   - registry tag listing / deletion (`registry`, `deleteTag`)
 *   - rolling a built tag onto a deployment (`deploy`)
 *   - Harbor/Trivy vulnerability scanning (`scan*`)
 *   - in-memory build-log inspection (`buildLogs`)
 *
 * Typical flow: configure (`setConfig`) → `build()` → watch `buildStream()` →
 * `scan()` the tag → `deploy()` it to an environment.
 */
export class ServiceRegistryService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Get the full service-config map (all services' build config keyed by name).
   * Route: GET /api/services/config
   *
   * @returns {Promise<Record<string, object>>} The raw service-config object.
   * @example
   * const cfg = await sdk.services.registry.config();
   * // → { api: { imageName: 'api', repo: '...', environments: {...} }, ... }
   */
  config() { return this.sdk._fetch('/services/config', 'GET'); }

  /**
   * Create/replace the build config for one service.
   * Route: POST /api/services/config
   *
   * @param {object} params
   * @param {string} params.name   - Service name (config key).
   * @param {object} params.config - The service config blob to store.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.services.registry.setConfig({ name: 'api', config: { imageName: 'api' } });
   */
  setConfig({ name, config }) {
    return this.sdk._fetch('/services/config', 'POST', { body: { name, config } });
  }

  /**
   * Delete one service's build config.
   * Route: DELETE /api/services/config
   *
   * @param {object} params
   * @param {string} params.name - Service name (config key).
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.services.registry.deleteConfig({ name: 'api' });
   */
  deleteConfig({ name }) {
    return this.sdk._fetch('/services/config', 'DELETE', { body: { name } });
  }

  /**
   * List the editable build files (Dockerfile, entrypoint.sh, .dockerignore)
   * from the service's linked GitHub repo, plus available branches.
   * Route: GET /api/services/[name]/build-files
   *
   * @param {object} params
   * @param {string} params.name  - Service name.
   * @param {string} [params.ref] - Git ref/branch to read files from.
   * @returns {Promise<{ files: Record<string, { content: string, sha: string|null, exists: boolean }>, ref: string|null, branches: string[] }>}
   * @example
   * const { files, branches } = await sdk.services.registry.buildFiles({ name: 'api' });
   */
  buildFiles({ name, ref }) {
    return this.sdk._fetch(`/services/${encodeURIComponent(name)}/build-files`, 'GET', { query: { ref } });
  }

  /**
   * Commit edited build files to a new `zeus/*` branch and open a PR.
   * Route: POST /api/services/[name]/build-files
   *
   * @param {object} params
   * @param {string} params.name         - Service name.
   * @param {string} params.baseBranch   - Branch to fork the change branch from.
   * @param {string} params.targetBranch - Branch the PR merges into.
   * @param {string} [params.prTitle]    - PR title.
   * @param {Array<{ path: string, content: string, sha?: string }>} params.files - Changed files (only Dockerfile/entrypoint.sh/.dockerignore are honored).
   * @returns {Promise<{ ok: true, prUrl: string, branch: string }>}
   * @example
   * await sdk.services.registry.commitBuildFiles({
   *   name: 'api', baseBranch: 'main', targetBranch: 'main',
   *   files: [{ path: 'Dockerfile', content: '...', sha: 'abc' }]
   * });
   */
  commitBuildFiles({ name, baseBranch, targetBranch, prTitle, files }) {
    return this.sdk._fetch(`/services/${encodeURIComponent(name)}/build-files`, 'POST', {
      body: { baseBranch, targetBranch, prTitle, files },
    });
  }

  /**
   * Discover live cluster workloads (deployments/statefulsets + pods) running a
   * service's image, across all namespaces of the env's cluster.
   * Route: GET /api/services/[name]/cluster-info
   *
   * @param {object} params
   * @param {string} params.name             - Service name.
   * @param {string} [params.env='dev']      - Environment key from the service config.
   * @param {boolean} [params.enabledOnly]   - Only keep (cluster,namespace) pairs an env record marks enabled (sent as `enabledOnly=1`).
   * @returns {Promise<{ deployment: object|null, pods: object[], instances: object[] }>}
   * @example
   * const { instances } = await sdk.services.registry.clusterInfo({ name: 'api', env: 'prod' });
   */
  clusterInfo({ name, env, enabledOnly }) {
    return this.sdk._fetch(`/services/${encodeURIComponent(name)}/cluster-info`, 'GET', {
      query: { env, enabledOnly: enabledOnly ? '1' : undefined },
    });
  }

  /**
   * Get in-memory build/deploy logs, optionally filtered to one service.
   * Route: GET /api/services/build-logs
   *
   * @param {object} [params]
   * @param {string} [params.name] - Service name to filter logs by.
   * @returns {Promise<Record<string, object>>} Map of log-key → log entry.
   * @example
   * const logs = await sdk.services.registry.buildLogs({ name: 'api' });
   */
  buildLogs({ name } = {}) {
    return this.sdk._fetch('/services/build-logs', 'GET', { query: { name } });
  }

  /**
   * List registry tags for a service's image.
   * Route: GET /api/services/registry
   *
   * @param {object} params
   * @param {string} params.name        - Service name (must have imageName configured).
   * @param {string} [params.mode]      - 'list' for bare tag names; default returns tags with details.
   * @param {string} [params.container] - Workspace container (resolves workspace registry creds).
   * @returns {Promise<{ baseName: string, registry: string, tagNames?: string[], tags?: object[] }>}
   * @example
   * const { tags } = await sdk.services.registry.registry({ name: 'api', container: 'app1' });
   */
  registry({ name, mode, container }) {
    return this.sdk._fetch('/services/registry', 'GET', { query: { name, mode, container } });
  }

  /**
   * Delete one registry tag for a service's image.
   * Route: DELETE /api/services/registry
   *
   * @param {object} params
   * @param {string} params.name        - Service name.
   * @param {string} params.tag         - Tag to delete.
   * @param {string} [params.container] - Workspace container.
   * @returns {Promise<object>} Delete result from the registry.
   * @example
   * await sdk.services.registry.deleteTag({ name: 'api', tag: 'dev-abc123' });
   */
  deleteTag({ name, tag, container }) {
    return this.sdk._fetch('/services/registry', 'DELETE', { query: { name, tag, container } });
  }

  /**
   * Build orchestration GET (multiplexed by `mode`):
   *   - mode 'info'     → host arch info
   *   - mode 'active'   → list active builds (optionally filtered by `name`)
   *   - mode 'branches' → remote branches for `name`
   *   - (no mode)       → poll build status for `name`+`branch`
   * Route: GET /api/services/registry/build
   *
   * @param {object} [params]
   * @param {string} [params.name]   - Service name (required for branches/status).
   * @param {string} [params.mode]   - 'info' | 'active' | 'branches'.
   * @param {string} [params.branch] - Branch (for status polling; defaults to '').
   * @returns {Promise<object>} Shape depends on mode: `{ hostArch }` | `{ active }` | branches | a build-status object.
   * @example
   * const { active } = await sdk.services.registry.buildStatus({ mode: 'active' });
   * const status = await sdk.services.registry.buildStatus({ name: 'api', branch: 'main' });
   */
  buildStatus({ name, mode, branch } = {}) {
    return this.sdk._fetch('/services/registry/build', 'GET', { query: { name, mode, branch } });
  }

  /**
   * Start an image build (or abort one with `action:'abort'`).
   * Route: POST /api/services/registry/build
   *
   * @param {object} params
   * @param {string} params.name              - Service name.
   * @param {string} params.branch            - Git branch to build.
   * @param {string} [params.builderId]       - 'local' or a configured builder id — REQUIRED unless aborting (no fallback).
   * @param {string} [params.envTag]          - Environment tag suffix for the image tag.
   * @param {string[]} [params.platforms]     - Target platforms (e.g. ['linux/amd64']).
   * @param {string} [params.container]       - Workspace container.
   * @param {string[]} [params.npmTokenIds]   - npm token ids to inject as build secrets.
   * @param {string} [params.environment]     - Environment name (for env-aware push registry).
   * @param {string} [params.action]          - 'abort' to abort a running build (needs name+branch only).
   * @returns {Promise<object>} Build start result (or abort result).
   * @example
   * await sdk.services.registry.build({ name: 'api', branch: 'main', builderId: 'local' });
   * await sdk.services.registry.build({ name: 'api', branch: 'main', action: 'abort' });
   */
  build({ name, branch, builderId, envTag, platforms, container, npmTokenIds, environment, action }) {
    return this.sdk._fetch('/services/registry/build', 'POST', {
      body: { name, branch, builderId, envTag, platforms, container, npmTokenIds, environment, action },
    });
  }

  /**
   * Open a live SSE stream of build status for a service+branch.
   * Route: GET /api/services/registry/build/stream  (text/event-stream)
   *
   * Emits typed events: `snapshot` (on connect), `update` (on change),
   * `heartbeat` (~10s), `done` (terminal — stream then closes).
   *
   * @param {object} params
   * @param {string} params.name     - Service name.
   * @param {string} [params.branch] - Branch (defaults to '').
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} Stream handle
   *   (async-iterable + onMessage/onDone/onError + close()).
   * @example
   * const s = sdk.services.registry.buildStream({ name: 'api', branch: 'main' });
   * s.onMessage = (evt) => console.log(evt.type, evt.data);
   * s.onDone(() => console.log('build finished'));
   */
  buildStream({ name, branch }) {
    return this.sdk._stream('/services/registry/build/stream', 'GET', { query: { name, branch } });
  }

  /**
   * Roll a built tag onto a service's deployment/statefulset for an environment.
   * Route: POST /api/services/registry/deploy
   *
   * @param {object} params
   * @param {string} params.serviceName  - Service name.
   * @param {string} params.environment  - Environment key from the service config.
   * @param {string} params.tag          - Image tag to deploy.
   * @param {string} [params.container]  - Workspace container (env-aware push registry).
   * @returns {Promise<{ ok: true, image: string, deployment: string, namespace: string, output: string }>}
   * @example
   * await sdk.services.registry.deploy({ serviceName: 'api', environment: 'prod', tag: 'prod-abc123' });
   */
  deploy({ serviceName, environment, tag, container }) {
    return this.sdk._fetch('/services/registry/deploy', 'POST', {
      body: { serviceName, environment, tag, container },
    });
  }

  /**
   * Get vulnerability scan data for a service's image.
   *   - default       → scan overviews (badges) for every tag
   *   - mode 'vulnerabilities' (+ tag) → full CVE list for one tag
   * Route: GET /api/services/registry/scan
   *
   * @param {object} params
   * @param {string} params.name        - Service name.
   * @param {string} [params.container] - Workspace container.
   * @param {string} [params.tag]       - Tag (required when mode='vulnerabilities').
   * @param {string} [params.mode]      - 'vulnerabilities' for the full CVE report; default 'overview'.
   * @returns {Promise<{ overviews: object|null, available: boolean } | { vulnerabilities: object }>}
   * @example
   * const { overviews } = await sdk.services.registry.scan({ name: 'api', container: 'app1' });
   * const { vulnerabilities } = await sdk.services.registry.scan({ name: 'api', tag: 'latest', mode: 'vulnerabilities' });
   */
  scan({ name, container, tag, mode }) {
    return this.sdk._fetch('/services/registry/scan', 'GET', { query: { name, container, tag, mode } });
  }

  /**
   * Trigger a (re)scan of one image tag.
   * Route: POST /api/services/registry/scan
   *
   * @param {object} params
   * @param {string} params.name        - Service name.
   * @param {string} params.tag         - Tag to scan.
   * @param {string} [params.container] - Workspace container.
   * @returns {Promise<object>} Scan-trigger result from Harbor.
   * @example
   * await sdk.services.registry.triggerScan({ name: 'api', tag: 'latest', container: 'app1' });
   */
  triggerScan({ name, tag, container }) {
    return this.sdk._fetch('/services/registry/scan', 'POST', { body: { name, tag, container } });
  }
}
