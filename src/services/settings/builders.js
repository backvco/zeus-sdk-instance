// @ts-nocheck
/**
 * BuildersService — image-build infrastructure (`sdk.settings.builders`).
 *
 * Builders are the machines/configs Zeus uses to build container images:
 * a `local` builder (the Zeus host's own Docker), plus remote `aws-spot` /
 * `gcp-spot` ephemeral builders backed by a baked base image (AMI / GCE image).
 * Remote builders carry a provisioned "template" (the base image) and may keep
 * per-service build-cache volumes.
 *
 * Lifecycle: list → create → (provision template) → use → delete. The list call
 * reconciles each remote builder's baked image against the cloud and stamps
 * `templateStatuses` (ready/missing/none).
 *
 * Routes: /api/settings/builders/**
 */
export class BuildersService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List all builders and the local-builder settings. Reconciles remote
   * builders' baked images against the cloud before returning.
   *
   * @returns {Promise<{
   *   builders: Array<object>,
   *   localEnabled: boolean,
   *   localCachePath: string|null,
   *   localUnavailable: boolean,
   *   localUnavailableMessage: string|null,
   *   runtimeEnv: string,
   * }>}
   * @route GET /api/settings/builders
   * @example
   * const { builders, localEnabled } = await sdk.settings.builders.list();
   */
  list() { return this.sdk._fetch('/settings/builders', 'GET'); }

  /**
   * Create a new builder. `name` and `type` are required.
   *
   * @param {object} params - Builder definition (forwarded as the request body).
   * @param {string} params.name - Display name.
   * @param {string} params.type - 'local' | 'aws-spot' | 'gcp-spot'.
   * @param {string[]} [params.archs] - Architectures, e.g. ['amd64','arm64'].
   * @param {boolean} [params.isGlobalDefault]
   * @returns {Promise<{ builder: object }>}
   * @route POST /api/settings/builders
   * @example
   * const { builder } = await sdk.settings.builders.create({ name: 'gcp', type: 'gcp-spot' });
   */
  create(params) { return this.sdk._fetch('/settings/builders', 'POST', { body: params }); }

  /**
   * Enable/disable the local (Zeus-host Docker) builder.
   *
   * @param {object} params
   * @param {boolean} [params.enabled=true]
   * @returns {Promise<{ ok: true }>}
   * @route POST /api/settings/builders  (action: 'setLocalEnabled')
   * @example
   * await sdk.settings.builders.setLocalEnabled({ enabled: false });
   */
  setLocalEnabled({ enabled = true } = {}) {
    return this.sdk._fetch('/settings/builders', 'POST', { body: { action: 'setLocalEnabled', enabled } });
  }

  /**
   * Set (or clear) the local builder's build-cache path.
   *
   * @param {object} params
   * @param {string|null} [params.path] - Absolute path, or null to clear.
   * @returns {Promise<{ ok: true }>}
   * @route POST /api/settings/builders  (action: 'setLocalCachePath')
   * @example
   * await sdk.settings.builders.setLocalCachePath({ path: '/var/lib/zeus-cache' });
   */
  setLocalCachePath({ path = null } = {}) {
    return this.sdk._fetch('/settings/builders', 'POST', { body: { action: 'setLocalCachePath', path } });
  }

  /**
   * Clear the `isGlobalDefault` flag from every builder.
   *
   * @returns {Promise<{ ok: true }>}
   * @route POST /api/settings/builders  (action: 'clearGlobalDefault')
   * @example
   * await sdk.settings.builders.clearGlobalDefault();
   */
  clearGlobalDefault() {
    return this.sdk._fetch('/settings/builders', 'POST', { body: { action: 'clearGlobalDefault' } });
  }

  /**
   * Get one builder by id.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ builder: object }>}
   * @route GET /api/settings/builders/[id]
   * @example
   * const { builder } = await sdk.settings.builders.get({ id: 'bld-123' });
   */
  get({ id }) { return this.sdk._fetch(`/settings/builders/${encodeURIComponent(id)}`, 'GET'); }

  /**
   * Update a builder (partial; fields forwarded as the body).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {object} params.patch - Fields to update.
   * @returns {Promise<{ builder: object }>}
   * @route PUT /api/settings/builders/[id]
   * @example
   * await sdk.settings.builders.update({ id: 'bld-123', patch: { name: 'renamed' } });
   */
  update({ id, patch }) {
    return this.sdk._fetch(`/settings/builders/${encodeURIComponent(id)}`, 'PUT', { body: patch });
  }

  /**
   * Delete a builder (best-effort cleanup of its managed template recipe).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/builders/[id]
   * @example
   * await sdk.settings.builders.delete({ id: 'bld-123' });
   */
  delete({ id }) { return this.sdk._fetch(`/settings/builders/${encodeURIComponent(id)}`, 'DELETE'); }

  /**
   * List a builder's per-service build-cache volumes.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ volumes: Array<object> }>}
   * @route GET /api/settings/builders/[id]/cache-volumes
   * @example
   * const { volumes } = await sdk.settings.builders.listCacheVolumes({ id: 'bld-123' });
   */
  listCacheVolumes({ id }) {
    return this.sdk._fetch(`/settings/builders/${encodeURIComponent(id)}/cache-volumes`, 'GET');
  }

  /**
   * Delete one cache volume from a builder.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.volumeId
   * @param {string} [params.service] - Service the volume belongs to.
   * @param {string} [params.arch] - Architecture the volume belongs to.
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/builders/[id]/cache-volumes/[volumeId]
   * @example
   * await sdk.settings.builders.deleteCacheVolume({ id: 'bld-123', volumeId: 'vol-1', service: 'api', arch: 'amd64' });
   */
  deleteCacheVolume({ id, volumeId, service, arch }) {
    return this.sdk._fetch(
      `/settings/builders/${encodeURIComponent(id)}/cache-volumes/${encodeURIComponent(volumeId)}`,
      'DELETE',
      { query: { service, arch } },
    );
  }

  /**
   * Get a remote builder's template (base-image) provisioning status.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<object>} Provision status (shape per builder type).
   * @route GET /api/settings/builders/[id]/template
   * @example
   * const status = await sdk.settings.builders.templateStatus({ id: 'bld-123' });
   */
  templateStatus({ id }) {
    return this.sdk._fetch(`/settings/builders/${encodeURIComponent(id)}/template`, 'GET');
  }

  /**
   * Start (or re-start) template provisioning for a remote builder. Local
   * builders reject this (HTTP 400 — no template needed).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} [params.arch] - Provision only this architecture (e.g. 'arm64').
   * @returns {Promise<{ ok: true, [k: string]: any }>} `ok` plus the start result.
   * @route POST /api/settings/builders/[id]/template
   * @example
   * await sdk.settings.builders.provisionTemplate({ id: 'bld-123', arch: 'arm64' });
   */
  provisionTemplate({ id, arch }) {
    return this.sdk._fetch(`/settings/builders/${encodeURIComponent(id)}/template`, 'POST', {
      body: arch ? { arch } : {},
    });
  }
}
