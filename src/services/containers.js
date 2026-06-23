// @ts-nocheck
/**
 * ContainersService — workload containers (a.k.a. workspaces).
 *
 * Accessed as `sdk.containers`.
 *
 * A "container" is a named workspace that owns a set of v2configs entities —
 * services, environments, clusters, whitelabels, and infrastructure add-ons.
 * One Zeus instance can host several; `app1` is the default. Most other SDK
 * methods take a `container` argument that maps to one of these.
 */
export class ContainersService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Get workspace-level config used by tab loaders (root DNS domain + zone).
   *
   * @returns {Promise<{ rootDomain: string, rootDomainZoneId: string }>}
   * @example
   * const { rootDomain } = await sdk.containers.config();
   */
  config() { return this.sdk._fetch('/v2configs/config', 'GET'); }

  /**
   * List all containers with entity counts.
   *
   * @returns {Promise<{ containers: Array<{
   *   name: string,
   *   createdAt: string,
   *   counts: { services: number, environments: number, clusters: number, infrastructure: number },
   * }> }>}
   * @example
   * const { containers } = await sdk.containers.list();
   * for (const c of containers) console.log(c.name, c.counts.clusters);
   */
  list() { return this.sdk._fetch('/v2configs/containers', 'GET'); }

  /**
   * Create a new (empty) container, optionally seeding it from another
   * container's services/environments/clusters/whitelabels/infrastructure JSON
   * (chart tarballs are not copied).
   *
   * @param {object} params
   * @param {string} params.name        - New container name (validated; lower-case slug).
   * @param {string} [params.cloneFrom] - Existing container name to seed from.
   * @returns {Promise<{ name: string, cloned: boolean }>}
   * @example
   * await sdk.containers.create({ name: 'app2' });
   * await sdk.containers.create({ name: 'app2-staging', cloneFrom: 'app2' });
   */
  create({ name, cloneFrom }) {
    return this.sdk._fetch('/v2configs/containers', 'POST', { body: { name, cloneFrom } });
  }

  /**
   * Delete a container. Refuses to delete a non-empty container (HTTP 409) —
   * destroy its clusters and remove its services/etc. first.
   *
   * @param {object} params
   * @param {string} params.name - Container name.
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.containers.delete({ name: 'app2-staging' });
   */
  delete({ name }) {
    return this.sdk._fetch(`/v2configs/containers/${encodeURIComponent(name)}`, 'DELETE');
  }

  /**
   * List dashboard workspaces (landing-page container summaries).
   * Alias of {@link SystemService.dashboardWorkspaces} kept here for discoverability.
   *
   * @returns {Promise<{ workspaces: Array<object> }>}
   * @example
   * const { workspaces } = await sdk.containers.workspaces();
   */
  workspaces() { return this.sdk._fetch('/dashboard/workspaces', 'GET'); }
}
