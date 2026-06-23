// @ts-nocheck
import { ServiceIdentitiesService } from './identities.js';
import { ServiceRegistryService } from './registry.js';

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
 * Two sub-namespaces hang off it:
 *   - `sdk.services.identities` — per-service cloud identities ({@link ServiceIdentitiesService}).
 *   - `sdk.services.registry`   — image build/registry/scan/deploy ({@link ServiceRegistryService}),
 *                                 the legacy `/api/services/**` surface.
 */
export class ServicesService {
  constructor(sdk) {
    this.sdk = sdk;
    this.identities = new ServiceIdentitiesService(sdk);
    this.registry = new ServiceRegistryService(sdk);
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
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {object} params.data          - New service config blob.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ service: object }>}
   * @example
   * await sdk.services.update({ container: 'app1', name: 'api', data: { ...service } });
   */
  update({ container, name, data, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}`, 'PUT', { body: { data, branch } });
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
}
