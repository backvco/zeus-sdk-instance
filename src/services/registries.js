// @ts-nocheck
/**
 * RegistriesService — workspace-level container-image registry configurations
 * (push credentials) plus encrypted per-cluster pull secrets.
 *
 * Accessed as `sdk.registries`.
 *
 * ─── Two stores ────────────────────────────────────────────────────────────────
 *
 * 1. **Registries** (`/v2configs/<container>/registries`): named push-credential
 *    entries persisted at `data/containers/<name>/registries.json`. Each carries
 *    `{ id, name, type, cluster, project, robot, robotId, host, isDefault, createdAt }`.
 *    Exactly one is the default; the first created becomes default automatically.
 *    Per-environment Harbor project overrides are set via {@link setEnvProjects}.
 *
 * 2. **Pull secrets** (`/v2configs/<container>/registry-pull-secrets`): encrypted
 *    pull-robot secrets keyed by `"envName/clusterName"`. The raw secret is never
 *    returned — list responses report only `{ hasSecret }` per key.
 *
 * All methods are container-scoped: first param is `container`. Methods that hit
 * the env-projects route also accept an optional `branch` (defaults to 'main').
 */
export class RegistriesService {
  constructor(sdk) { this.sdk = sdk; }

  // ─── Registries ───────────────────────────────────────────────────────────

  /**
   * List registry configurations, each annotated with whether its robot secret
   * exists on the target cluster.
   *
   * @param {object} params
   * @param {string} params.container - Container name (e.g. 'app1').
   * @returns {Promise<{ registries: Array<{
   *   id: string, name: string, type: string, cluster: string, project: string,
   *   robot: string, robotId: string|null, host: string, isDefault: boolean,
   *   createdAt: string, hasSecret: boolean }> }>}
   * @example
   * const { registries } = await sdk.registries.list({ container: 'app1' });
   */
  list({ container }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/registries`, 'GET');
  }

  /**
   * Create a registry configuration. The first registry in a container becomes the
   * default automatically; otherwise pass `isDefault` to make it the default.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name - Display name (required).
   * @param {string} params.type - Registry type (required, e.g. 'harbor').
   * @param {string} params.cluster - Cluster the registry lives on (required).
   * @param {string} params.project - Registry project/namespace (required).
   * @param {string} [params.robot] - Push robot account name.
   * @param {string} [params.robotId] - Push robot account id (links the stored secret).
   * @param {string} [params.pullRobot] - Pull robot account name — environments inherit it for image pull secrets.
   * @param {string} [params.pullRobotId] - Pull robot account id (links the stored secret).
   * @param {string} [params.host] - Registry host.
   * @param {boolean} [params.isDefault] - Make this the default registry.
   * @returns {Promise<{ id: string, name: string, type: string, cluster: string,
   *   project: string, robot: string, robotId: string|null, host: string,
   *   isDefault: boolean, createdAt: string }>} The created entry (HTTP 201).
   * @example
   * await sdk.registries.create({ container: 'app1', name: 'prod', type: 'harbor', cluster: 'z-01', project: 'app1' });
   */
  create({ container, name, type, cluster, project, robot, robotId, pullRobot, pullRobotId, host, isDefault }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/registries`, 'POST', {
      body: { name, type, cluster, project, robot, robotId, pullRobot, pullRobotId, host, isDefault },
    });
  }

  /**
   * Update a registry configuration (shallow merge). Setting `isDefault: true`
   * clears the default flag on all other entries.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.id - Registry id.
   * @param {object} params.patch - Fields to merge (e.g. `{ name, project, isDefault }`). The `id` is preserved.
   * @returns {Promise<object>} The updated entry.
   * @example
   * await sdk.registries.update({ container: 'app1', id: 'reg_123', patch: { isDefault: true } });
   */
  update({ container, id, patch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/registries/${encodeURIComponent(id)}`,
      'PUT',
      { body: patch },
    );
  }

  /**
   * Delete a registry configuration. If the deleted entry was the default, the
   * first remaining entry is promoted to default.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.id - Registry id.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.registries.delete({ container: 'app1', id: 'reg_123' });
   */
  delete({ container, id }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/registries/${encodeURIComponent(id)}`,
      'DELETE',
    );
  }

  /**
   * Set per-environment Harbor project overrides for a registry. The override is
   * stored on each environment record (`registryProjects[id]`). Map environment
   * name → project; an empty-string project clears the override (workspace default
   * applies).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.id - Registry id.
   * @param {Record<string, string>} params.projects - envName → project map (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ ok: true, projects: Record<string, *> }>} Per-env save results.
   * @example
   * await sdk.registries.setEnvProjects({ container: 'app1', id: 'reg_123', projects: { prod: 'app1-prod', dev: '' } });
   */
  setEnvProjects({ container, id, projects, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/registries/${encodeURIComponent(id)}/env-projects`,
      'PUT',
      { body: { projects, branch } },
    );
  }

  // ─── Pull secrets ─────────────────────────────────────────────────────────

  /**
   * List registry pull-secret presence keyed by `"envName/clusterName"`. The raw
   * secret is never returned — each key maps to `{ hasSecret }`. Optionally filter
   * to a single environment.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.env] - Filter to keys for this environment name.
   * @returns {Promise<Record<string, { hasSecret: boolean }>>}
   * @example
   * const secrets = await sdk.registries.listPullSecrets({ container: 'app1', env: 'prod' });
   * // → { 'prod/z-01': { hasSecret: true } }
   */
  listPullSecrets({ container, env }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/registry-pull-secrets`,
      'GET',
      { query: { env } },
    );
  }

  /**
   * Set (or clear) a registry pull secret for an env/cluster pair. Pass an empty /
   * omitted `secret` to clear it. The value is encrypted at rest.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.envName - Environment name (required).
   * @param {string} params.clusterName - Cluster name (required).
   * @param {string} [params.secret] - The pull secret; empty/omitted clears it.
   * @returns {Promise<{ ok: true, hasSecret: boolean }>}
   * @example
   * await sdk.registries.setPullSecret({ container: 'app1', envName: 'prod', clusterName: 'z-01', secret: '...' });
   */
  setPullSecret({ container, envName, clusterName, secret }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/registry-pull-secrets`,
      'POST',
      { body: { envName, clusterName, secret } },
    );
  }
}
