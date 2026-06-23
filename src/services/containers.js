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

  /**
   * Get a container's workspace settings (build/npm defaults).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @returns {Promise<{ settings: {
   *   npmTokenIds?: string[], enabledBuilderIds?: string[],
   *   defaultBuilderId?: string | null, localBuilderEnabled?: boolean,
   * } }>}
   * @example
   * const { settings } = await sdk.containers.settings({ container: 'app1' });
   */
  settings({ container }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/settings`, 'GET');
  }

  /**
   * Update a container's workspace settings. Only the fields present in
   * `settings` are merged server-side.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {object} params.settings  - Partial settings: `npmTokenIds`,
   *   `enabledBuilderIds`, `defaultBuilderId`, `localBuilderEnabled`.
   * @returns {Promise<{ settings: object }>} The full merged settings.
   * @example
   * await sdk.containers.updateSettings({ container: 'app1', settings: { npmTokenIds: ['tok_1'] } });
   */
  updateSettings({ container, settings }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/settings`, 'PUT', { body: settings });
  }

  /**
   * List clusters that belong to the container's workspace (owned + linked).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ clusters: Array<object> }>}
   * @example
   * const { clusters } = await sdk.containers.workspaceClusters({ container: 'app1' });
   */
  workspaceClusters({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/workspace-clusters`, 'GET', { query: { branch } });
  }

  /**
   * List the Kubernetes namespaces known to the container's environments.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ namespaces: Array<string> }>}
   * @example
   * const { namespaces } = await sdk.containers.namespaces({ container: 'app1' });
   */
  namespaces({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/namespaces`, 'GET', { query: { branch } });
  }

  /**
   * List cross-container cluster links for a container, plus the clusters that
   * are still available to link.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ links: Array<object>, available: Array<object> }>}
   * @example
   * const { links, available } = await sdk.containers.clusterLinks({ container: 'app1' });
   */
  clusterLinks({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/cluster-links`, 'GET', { query: { branch } });
  }

  /**
   * Link a cluster from another container into this container's workspace.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Name of the linkable cluster.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ links: Array<object> }>}
   * @example
   * await sdk.containers.createClusterLink({ container: 'app1', name: 'z-99' });
   */
  createClusterLink({ container, name, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/cluster-links`, 'POST', { body: { name, branch } });
  }

  /**
   * Remove a cluster link from this container's workspace.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name      - Linked cluster name to remove.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ links: Array<object> }>}
   * @example
   * await sdk.containers.deleteClusterLink({ container: 'app1', name: 'z-99' });
   */
  deleteClusterLink({ container, name, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/cluster-links`, 'DELETE', { body: { name, branch } });
  }

  /**
   * Get the container's cross-cluster overlay (mesh) DNS config.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} Overlay DNS config.
   * @example
   * const dns = await sdk.containers.overlayDns({ container: 'app1' });
   */
  overlayDns({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/overlay/dns`, 'GET', { query: { branch } });
  }

  /**
   * Get the container's overlay keepalive config.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} Overlay keepalive config.
   * @example
   * const ka = await sdk.containers.overlayKeepalive({ container: 'app1' });
   */
  overlayKeepalive({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/overlay/keepalive`, 'GET', { query: { branch } });
  }
}
