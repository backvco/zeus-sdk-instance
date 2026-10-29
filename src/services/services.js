// @ts-nocheck
import { ServiceIdentitiesService } from './identities.js';
import { ServiceRegistryService } from './registry.js';
import { ServiceRunsService } from './service-runs.js';
import { casMutate, resolveBaseRev } from '../cas.js';

/**
 * ServicesService — v2configs services (workload definitions) for a container.
 *
 * Accessed as `sdk.services`.
 *
 * A "service" is a container-scoped workload config (image repo, builder,
 * volumes, cron jobs, etc.) that environments deploy. This entry class covers
 * the core service CRUD plus a few read-only helpers used by the service UI
 * (builder override, cron-enable map, environment membership, volume mappings).
 *
 * Three sub-namespaces hang off it:
 *   - `sdk.services.identities` — per-service cloud identities ({@link ServiceIdentitiesService}).
 *   - `sdk.services.registry`   — image build/registry/scan/deploy ({@link ServiceRegistryService}),
 *                                 the legacy `/api/services/**` surface.
 *   - `sdk.services.runs`       — ephemeral (run-to-completion) invocations ({@link ServiceRunsService}).
 */
export class ServicesService {
  constructor(sdk) {
    this.sdk = sdk;
    this.identities = new ServiceIdentitiesService(sdk);
    this.registry = new ServiceRegistryService(sdk);
    this.runs = new ServiceRunsService(sdk);
  }

  /**
   * Stream build/deploy staleness for a container's services. STREAMING.
   * Route: GET /api/v2configs/[container]/stale-builds  (text/event-stream)
   *
   * Frames are progress events `{ type: 'step'|'info'|'warn'|'done', message?, item? }`;
   * the `done` frame carries `{ items, total, skippedEnvs, fromCache, computedAt }`.
   * Item status: `needs-build` | `built` (ref/build-only mode) |
   * `needs-deploy` | `clean` | `not-running` | `unknown`.
   *
   * @param {object} params
   * @param {string} params.container       - Workspace container.
   * @param {string} [params.branch='main'] - Config-store snapshot branch.
   * @param {string} [params.ref]           - Git branch to check every service against
   *                                          (build-only, no cluster scan). Omit to use
   *                                          each env's `defaultBranch` and include deploy status.
   * @param {boolean} [params.refresh]      - Bypass the 10-minute server cache.
   * @param {boolean} [params.all]          - Include `clean` items in the `done` frame.
   * @param {AbortSignal} [params.signal]
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>}
   * @example
   * for await (const ev of sdk.services.staleBuilds({ container: 'app1', ref: 'dev' })) {
   *   if (ev.data?.item?.status === 'needs-build') console.log(ev.data.item.service);
   * }
   */
  staleBuilds({ container, branch = 'main', ref, refresh, all, signal }) {
    return this.sdk._stream(`/v2configs/${encodeURIComponent(container)}/stale-builds`, 'GET', {
      query: { branch, ref, refresh: refresh ? '1' : undefined, all: all ? '1' : undefined },
      signal,
    });
  }

  /**
   * List all services in a container.
   * Route: GET /api/v2configs/[container]/services
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ services: object[] }>}
   * @example
   * const { services } = await sdk.services.list({ container: 'app1' });
   */
  list({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services`, 'GET', { query: { branch } });
  }

  /**
   * Create or replace a service.
   * Route: POST /api/v2configs/[container]/services
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {object} params.data          - Service config blob.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ service: object }>}
   * @example
   * await sdk.services.create({ container: 'app1', name: 'api', data: { repo: {...} } });
   */
  create({ container, name, data, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services`, 'POST', { body: { name, data, branch } });
  }

  /**
   * Get one service by name.
   * Route: GET /api/v2configs/[container]/services/[name]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ service: object }>}
   * @example
   * const { service } = await sdk.services.get({ container: 'app1', name: 'api' });
   */
  get({ container, name, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}`, 'GET', { query: { branch } });
  }

  /**
   * Update a service (replaces its config blob).
   * Route: PUT /api/v2configs/[container]/services/[name]
   *
   * The route enforces optimistic concurrency: the request must carry the
   * `_rev` you read (`baseRev`), and a mismatch 409s (`kind: 'stale-save'`)
   * without writing — so a stale copy can never silently revert someone
   * else's fields. When `baseRev` is omitted it is taken from `data._rev`
   * (present whenever `data` came from {@link get}); a doc with neither
   * sends `null`, which asserts "no doc exists yet" and 409s if one does.
   * Prefer {@link mutate} for programmatic edits — it handles all of this.
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {object} params.data          - New service config blob.
   * @param {string} [params.branch='main'] - Config branch.
   * @param {number|null} [params.baseRev] - Revision this write is based on (default `data._rev ?? null`).
   * @returns {Promise<{ service: object }>}
   * @example
   * const { service } = await sdk.services.get({ container: 'app1', name: 'api' });
   * service.replicas = 3;
   * await sdk.services.update({ container: 'app1', name: 'api', data: service });
   */
  update({ container, name, data, branch, baseRev }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}`, 'PUT', {
      body: { data, branch, baseRev: resolveBaseRev(data, baseRev) },
    });
  }

  /**
   * Read-mutate-write a service with automatic stale-save retry.
   * Fetches the current doc, applies `fn` (edit in place or return a
   * replacement), saves with the fetched `_rev` — and on a stale-save 409
   * re-fetches and re-applies `fn` to the fresh doc (safe CAS retry, never a
   * merge of stale state).
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.branch='main'] - Config branch.
   * @param {number} [params.retries=3]   - Stale-save retries.
   * @param {(service: object) => object|void|Promise<object|void>} fn - Mutation to apply.
   * @returns {Promise<{ service: object }>}
   * @example
   * await sdk.services.mutate({ container: 'app1', name: 'api' }, (svc) => { svc.replicas = 3; });
   */
  mutate({ container, name, branch, retries } = {}, fn) {
    return casMutate({
      read: async () => (await this.get({ container, name, branch })).service,
      write: (data, baseRev) => this.update({ container, name, data, branch, baseRev }),
      mutate: fn,
      retries,
    });
  }

  /**
   * Delete a service and scrub it from every environment.
   * Route: DELETE /api/v2configs/[container]/services/[name]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.branch='main'] - Config branch (sent as ?branch=).
   * @returns {Promise<{ success: true, scrubbedEnvironments: string[] }>}
   * @example
   * await sdk.services.delete({ container: 'app1', name: 'api' });
   */
  delete({ container, name, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}`, 'DELETE', { query: { branch } });
  }

  /**
   * Get the service-level default builder override (service.defaultBuilderId).
   * Route: GET /api/v2configs/[container]/services/[name]/builder
   *
   * @param {object} params
   * @param {string} params.container - Workspace container.
   * @param {string} params.name      - Service name.
   * @returns {Promise<{ defaultBuilderId: string|null }>}
   * @example
   * const { defaultBuilderId } = await sdk.services.builder({ container: 'app1', name: 'api' });
   */
  builder({ container, name }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/builder`, 'GET');
  }

  /**
   * Set the service-level default builder override.
   * Route: PUT /api/v2configs/[container]/services/[name]/builder
   *
   * @param {object} params
   * @param {string} params.container          - Workspace container.
   * @param {string} params.name               - Service name.
   * @param {string|null} params.defaultBuilderId - Builder id, or null to clear.
   * @returns {Promise<{ defaultBuilderId: string|null }>}
   * @example
   * await sdk.services.setBuilder({ container: 'app1', name: 'api', defaultBuilderId: 'builder-1' });
   */
  setBuilder({ container, name, defaultBuilderId }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/builder`, 'PUT', {
      body: { defaultBuilderId },
    });
  }

  /**
   * List every (env, cluster) pair where a named cron job is enabled.
   * Route: GET /api/v2configs/[container]/services/[name]/cron-enables
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.cron          - Cron job name (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ enables: object[] }>}
   * @example
   * const { enables } = await sdk.services.cronEnables({ container: 'app1', name: 'api', cron: 'nightly' });
   */
  cronEnables({ container, name, cron, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/cron-enables`, 'GET', {
      query: { cron, branch },
    });
  }

  /**
   * List the environments that include this service (with per-env svc settings).
   * Route: GET /api/v2configs/[container]/services/[name]/environments
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ environments: Array<{ name: string, displayName: string, namespace: string|null, replicas: number|null, enabled: boolean, defaultBranch: string|null, clusters: string[] }> }>}
   * @example
   * const { environments } = await sdk.services.environments({ container: 'app1', name: 'api' });
   */
  environments({ container, name, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/environments`, 'GET', {
      query: { branch },
    });
  }

  /**
   * List every (env, cluster) pair that maps a per-cluster storage class for a
   * named PVC volume on this service.
   * Route: GET /api/v2configs/[container]/services/[name]/volume-mappings
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.volume        - PVC volume name (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ mappings: object[] }>}
   * @example
   * const { mappings } = await sdk.services.volumeMappings({ container: 'app1', name: 'api', volume: 'data' });
   */
  volumeMappings({ container, name, volume, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/volume-mappings`, 'GET', {
      query: { volume, branch },
    });
  }

  /**
   * Preview or apply a partial service-settings change.
   * Route: POST /api/v2configs/[container]/clusters/[name]/service-settings/plan|apply
   *
   * Defaults to a dry-run preview. Apply when `dryRun` is boolean false, with
   * `confirm` equal to the cluster name and `planHash` from that preview.
   * `settings.scaling.hpa` accepts `minReplicas`, `maxReplicas`, and `targetCPU`
   * (an integer percent from 1 to 100). `minReplicas` must not exceed
   * `maxReplicas`, including against the value already stored.
   * `settings.scheduling.topologySpread` accepts `maxSkew`, `topologyKey`, and
   * `whenUnsatisfiable`. Omitted `whenUnsatisfiable` is ScheduleAnyway, a soft
   * preference. DoNotSchedule is required and uses the same placement ceiling
   * as separateZones or separateNodes.
   *
   * Prepared in 0.2.23. Do not npm publish until Cameron says so.
   *
   * @param {object} input
   * @param {string} input.container
   * @param {string} input.cluster
   * @param {string} input.service
   * @param {object} input.settings
   * @param {string} [input.environment]
   * @param {'template'|'cluster'} [input.scope]
   * @param {string} [input.workload]
   * @param {string} [input.containerName]
   * @param {boolean} [input.deploy]
   * @param {boolean} [input.dryRun]
   * @param {string} [input.confirm]
   * @param {string} [input.planHash]
   * @example
   * await sdk.services.editSettings({
   *   container: 'app1', cluster: 'lab', service: 'api', scope: 'cluster', environment: 'dev',
   *   settings: { scaling: { hpa: { minReplicas: 2, maxReplicas: 6, targetCPU: 60 } },
   *     scheduling: { topologySpread: { maxSkew: 1, topologyKey: 'topology.kubernetes.io/zone' } } }
   * });
   */
  editSettings(input = {}) {
    const dryRun = input.dryRun !== false;
    const kind = dryRun ? 'plan' : 'apply';
    const body = {
      service: input.service,
      environment: input.environment,
      scope: input.scope,
      workload: input.workload,
      containerName: input.containerName,
      settings: input.settings,
      deploy: input.deploy === true,
      ...(dryRun ? {} : { dryRun: false, confirm: input.confirm, planHash: input.planHash })
    };
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(input.container)}/clusters/${encodeURIComponent(input.cluster)}/service-settings/${kind}`,
      'POST',
      { body: Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) }
    );
  }
}
