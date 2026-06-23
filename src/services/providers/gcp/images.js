// @ts-nocheck
/**
 * GcpImagesService — GCE custom-image recipes, builds, and live-image lifecycle.
 *
 * Accessed as `sdk.providers.gcp.images`.
 *
 * A "recipe" is a named image-build spec (base image, arch, type, customizations).
 * Building a recipe streams progress over SSE and produces a versioned GCE image;
 * the live-image lifecycle (make-current, retention policy, protect, delete) is
 * managed separately. The GKE analog of the AWS AMI recipe/build system.
 *
 * Typical lifecycle: `list` recipes → `create`/`save` a recipe → `plan` →
 * `build` (SSE) → manage versions via `cloudImages`.
 */
export class GcpImagesService {
  constructor(sdk) { this.sdk = sdk; }

  _n(name) { return encodeURIComponent(name); }
  _base(name) { return `/providers/gcp/images/${this._n(name)}`; }

  /**
   * List image recipes, each enriched with its latest build summary.
   *
   * @returns {Promise<{ recipes: Array<{ name: string, displayName?: string, description?: string, arch?: string, type?: string, _system?: boolean, baseImage?: string, latestBuild: object|null, error?: string }>> }>}
   * @example
   * const { recipes } = await sdk.providers.gcp.images.list();
   */
  list() { return this.sdk._fetch('/providers/gcp/images', 'GET'); }

  /**
   * Create a new image recipe, optionally cloning from an existing one.
   *
   * @param {object} params
   * @param {string} params.name        - New recipe name.
   * @param {string} [params.cloneFrom] - Existing recipe to clone.
   * @returns {Promise<{ created: object }>}
   * @example
   * await sdk.providers.gcp.images.create({ name: 'gke-base', cloneFrom: 'gce-general' });
   */
  create({ name, cloneFrom }) {
    return this.sdk._fetch('/providers/gcp/images', 'POST', { body: { name, cloneFrom } });
  }

  /**
   * Get one recipe + its readme + recent build records. Pass `bundle:true` to
   * instead return the full recipe bundle.
   *
   * @param {object} params
   * @param {string} params.name     - Recipe name.
   * @param {boolean} [params.bundle] - Return the recipe bundle instead (?bundle=1).
   * @returns {Promise<{ recipe: object, readme: string, builds: Array<object> } | object>}
   * @example
   * const { recipe, builds } = await sdk.providers.gcp.images.get({ name: 'gke-base' });
   */
  get({ name, bundle }) {
    return this.sdk._fetch(this._base(name), 'GET', { query: { bundle: bundle ? '1' : undefined } });
  }

  /**
   * Save (update) a recipe's spec and/or readme.
   *
   * @param {object} params
   * @param {string} params.name      - Recipe name.
   * @param {object} [params.recipe]  - Recipe spec to persist.
   * @param {string} [params.readme]  - Readme markdown.
   * @returns {Promise<{ saved: object }>}
   * @example
   * await sdk.providers.gcp.images.save({ name: 'gke-base', recipe: { arch: 'amd64', baseImage: '…' } });
   */
  save({ name, recipe, readme }) {
    return this.sdk._fetch(this._base(name), 'PUT', { body: { recipe, readme } });
  }

  /**
   * Delete a recipe. 409 if it has build records.
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @returns {Promise<{ deleted: true }>}
   * @example
   * await sdk.providers.gcp.images.delete({ name: 'gke-base' });
   */
  delete({ name }) { return this.sdk._fetch(this._base(name), 'DELETE'); }

  /**
   * List a recipe's build records (reconciles stale 'running' → 'interrupted').
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @returns {Promise<{ builds: Array<object> }>}
   * @example
   * const { builds } = await sdk.providers.gcp.images.builds({ name: 'gke-base' });
   */
  builds({ name }) { return this.sdk._fetch(`${this._base(name)}/builds`, 'GET'); }

  /**
   * Start a build for a recipe. **Streaming (SSE)** — progress events while the
   * GCE builder runs; an early `info` event carries the generated `buildId`.
   * Returns HTTP 409 if a build for this recipe is already in flight.
   *
   * @param {object} params
   * @param {string} params.name              - Recipe name.
   * @param {string} [params.accountId]        - Linked GCP account.
   * @param {string} [params.zone]             - Build zone override.
   * @param {string} [params.machineType]      - Builder machine type override.
   * @param {string} [params.network]          - Network override.
   * @param {string} [params.subnetwork]       - Subnetwork override.
   * @param {string} [params.serviceAccount]   - Builder service account override.
   * @param {number} [params.maxRuntimeMinutes] - Max build runtime.
   * @param {boolean} [params.serialPortEnabled] - Enable serial-port logging.
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE handle:
   *   async-iterable + `onOpen/onMessage/onError/onDone` + `close()`.
   * @example
   * const s = sdk.providers.gcp.images.build({ name: 'gke-base', accountId: 'acc1' });
   * s.onMessage = (ev) => console.log(ev.type, ev.data);
   */
  build({ name, accountId, zone, machineType, network, subnetwork, serviceAccount, maxRuntimeMinutes, serialPortEnabled }) {
    return this.sdk._stream(`${this._base(name)}/builds`, 'POST', {
      body: { accountId, zone, machineType, network, subnetwork, serviceAccount, maxRuntimeMinutes, serialPortEnabled },
    });
  }

  /**
   * Get one build record.
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @param {string} params.id   - Build id.
   * @returns {Promise<{ build: object }>}
   * @example
   * const { build } = await sdk.providers.gcp.images.getBuild({ name: 'gke-base', id });
   */
  getBuild({ name, id }) {
    return this.sdk._fetch(`${this._base(name)}/builds/${encodeURIComponent(id)}`, 'GET');
  }

  /**
   * Request cancellation of an in-flight build.
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @param {string} params.id   - Build id.
   * @returns {Promise<{ cancelled: boolean }>}
   * @example
   * await sdk.providers.gcp.images.cancelBuild({ name: 'gke-base', id });
   */
  cancelBuild({ name, id }) {
    return this.sdk._fetch(`${this._base(name)}/builds/${encodeURIComponent(id)}/cancel`, 'POST');
  }

  /**
   * Attach to a build's progress stream. **Streaming (SSE)** — replays the build
   * log (from a live run or the on-disk log) as progress events. 404 if unknown.
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @param {string} params.id   - Build id.
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE handle.
   * @example
   * const s = sdk.providers.gcp.images.streamBuild({ name: 'gke-base', id });
   * s.onMessage = (ev) => console.log(ev.data);
   */
  streamBuild({ name, id }) {
    return this.sdk._stream(`${this._base(name)}/builds/${encodeURIComponent(id)}/stream`, 'GET');
  }

  /**
   * Get the live GCE images for a recipe + retention policy.
   *
   * @param {object} params
   * @param {string} params.name        - Recipe name.
   * @param {string} [params.accountId] - Linked GCP account.
   * @returns {Promise<{ project: string, current: object|null, pinned: Array, images: Array<object>, keepVersions: number, autoMakeCurrent: boolean }>}
   * @example
   * const { images, current } = await sdk.providers.gcp.images.cloudImages({ name: 'gke-base' });
   */
  cloudImages({ name, accountId }) {
    return this.sdk._fetch(`${this._base(name)}/cloud-images`, 'GET', { query: { accountId } });
  }

  /**
   * Mutate a recipe's live images / policy (action-dispatched). `action`:
   * 'makeCurrent' | 'useLatest' | 'delete' | 'protect' | 'unprotect' | 'setPolicy'.
   *
   * @param {object} params
   * @param {string} params.action       - Action (see above).
   * @param {string} [params.accountId]  - Linked GCP account.
   * @param {string} [params.image]      - Image name (makeCurrent/delete/protect/unprotect).
   * @param {boolean} [params.force]     - Force delete.
   * @param {boolean} [params.autoMakeCurrent] - setPolicy flag.
   * @param {number} [params.keepVersions] - setPolicy retention count.
   * @returns {Promise<{ ok: true, project: string, current: object|null, pinned: Array, images: Array<object>, keepVersions: number, autoMakeCurrent: boolean }>}
   * @example
   * await sdk.providers.gcp.images.cloudImageAction({ name: 'gke-base', action: 'makeCurrent', image: 'gke-base-2026…' });
   */
  cloudImageAction({ name, action, accountId, image, force, autoMakeCurrent, keepVersions }) {
    return this.sdk._fetch(`${this._base(name)}/cloud-images`, 'POST', {
      body: { action, accountId, image, force, autoMakeCurrent, keepVersions },
    });
  }

  /**
   * Compute a build plan for a recipe (pure preview; no build).
   *
   * @param {object} params
   * @param {string} params.name              - Recipe name.
   * @param {string} [params.accountId]        - Linked GCP account.
   * @param {string} [params.zone]             - Zone override.
   * @param {string} [params.machineType]      - Machine type override.
   * @param {string} [params.network]          - Network override.
   * @param {string} [params.subnetwork]       - Subnetwork override.
   * @param {string} [params.serviceAccount]   - Service account override.
   * @param {number} [params.maxRuntimeMinutes] - Max runtime.
   * @param {boolean} [params.serialPortEnabled] - Enable serial-port logging on the build VM.
   * @param {object} [params.body] - Explicit verbatim body (overrides the named fields)
   *   for callers that assemble the full build payload themselves.
   * @returns {Promise<{ plan: object }>}
   * @example
   * const { plan } = await sdk.providers.gcp.images.plan({ name: 'gke-base' });
   */
  plan({ name, body, ...rest }) {
    return this.sdk._fetch(`${this._base(name)}/plan`, 'POST', { body: body ?? rest });
  }

  /**
   * List VPC networks + regional subnetworks for the image build modal.
   *
   * @param {object} params
   * @param {string} params.region      - GCP region (required).
   * @param {string} [params.accountId] - Linked GCP account.
   * @returns {Promise<{ networks: Array<{ name: string, autoSubnet: boolean, hasCloudNat: boolean, subnetworks: Array<{ name: string, cidr: string, privateGoogleAccess: boolean }> }>> }>}
   * @example
   * const { networks } = await sdk.providers.gcp.images.networks({ region: 'us-central1' });
   */
  networks({ region, accountId }) {
    return this.sdk._fetch('/providers/gcp/images/networks', 'GET', { query: { region, accountId } });
  }
}
