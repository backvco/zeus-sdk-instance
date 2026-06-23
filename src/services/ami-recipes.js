// @ts-nocheck
/**
 * AmiRecipesService — machine-image (AMI) recipes, builds, and distribution.
 *
 * Accessed as `sdk.amiRecipes`.
 *
 * A "recipe" is a named, versioned definition of how to bake a custom EC2 AMI
 * (base image + source ref + per-region distribution). Typical lifecycle:
 *   1. {@link create} / {@link save} a recipe definition.
 *   2. {@link plan} a build to preview inputs, then {@link startBuild} (SSE) to bake.
 *   3. Watch progress with {@link streamBuild}; cancel with {@link cancelBuild}.
 *   4. {@link distribute} the finished AMI to other AWS accounts (SSE COPY).
 *   5. {@link attach} the AMI to a cluster node group, then run the apply pipeline.
 *   6. Manage live AMIs (make-current / retention) via {@link cloudImages}.
 *
 * The builder EC2 instance profile is provisioned per-account with
 * {@link builderProfile}.
 *
 * Streaming methods ({@link startBuild}, {@link distribute}, {@link streamBuild})
 * return an SSE stream handle (async-iterable + onOpen/onMessage/onError/onDone
 * callbacks + close()). They emit `progress`-style events (info/heartbeat/error/done).
 */
export class AmiRecipesService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List all AMI recipes, each enriched with its latest build, the AWS accounts
   * (+ regions) it currently has AMIs in, and how many node groups reference it.
   *
   * @returns {Promise<{ recipes: Array<{
   *   name: string,
   *   displayName?: string,
   *   description?: string,
   *   arch?: string,
   *   type?: string,
   *   _system?: boolean,
   *   provider?: string,
   *   baseAmi?: string,
   *   source?: object,
   *   latestBuild: null | { buildId: string, status: string, startedAt?: string, finishedAt?: string, regionalAmiIds: object | null },
   *   accounts: Array<{ accountId: string, label: string, regions: string[] }>,
   *   targetCount: number,
   *   error?: string,
   * }> }>}
   * @example
   * const { recipes } = await sdk.amiRecipes.list();
   * // → { recipes: [{ name: 'rtpengine', latestBuild: {...}, targetCount: 2 }] }
   */
  list() { return this.sdk._fetch('/ami-recipes', 'GET'); }

  /**
   * Create a new AMI recipe, optionally cloning an existing one.
   *
   * @param {object} params
   * @param {string} params.name        - New recipe name (validated slug).
   * @param {string} [params.cloneFrom] - Existing recipe name to seed from.
   * @returns {Promise<{ created: object }>}
   * @example
   * await sdk.amiRecipes.create({ name: 'my-base' });
   * await sdk.amiRecipes.create({ name: 'my-base-arm', cloneFrom: 'my-base' });
   */
  create({ name, cloneFrom }) {
    return this.sdk._fetch('/ami-recipes', 'POST', { body: { name, cloneFrom } });
  }

  /**
   * Get a single recipe with its README, recent build records (with AMI-exists
   * annotations), and node-group targets. Pass `bundle: true` to instead fetch
   * the full editable bundle (recipe JSON + scripts) for the recipe editor.
   *
   * @param {object} params
   * @param {string} params.name      - Recipe name.
   * @param {boolean} [params.bundle]  - When true, return the editable bundle (`?bundle=1`).
   * @returns {Promise<
   *   { recipe: object, readme: string|null, builds: Array<object>, targets: Array<object> }
   *   | object // bundle shape when bundle:true → { ..., _system: boolean }
   * >}
   * @example
   * const { recipe, builds } = await sdk.amiRecipes.get({ name: 'rtpengine' });
   * const bundle = await sdk.amiRecipes.get({ name: 'rtpengine', bundle: true });
   */
  get({ name, bundle }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}`, 'GET', {
      query: { bundle: bundle ? '1' : undefined },
    });
  }

  /**
   * Save (create-or-update) a recipe's definition. System recipes are read-only.
   *
   * @param {object} params
   * @param {string} params.name    - Recipe name.
   * @param {object} params.recipe  - Recipe fields to persist (the rest of the object is the body).
   * @returns {Promise<{ saved: object }>}
   * @example
   * await sdk.amiRecipes.save({ name: 'my-base', recipe: { description: 'updated', arch: 'arm64' } });
   */
  save({ name, recipe }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}`, 'PUT', { body: recipe });
  }

  /**
   * Delete a recipe. Refuses (HTTP 409) if it has build records on disk or if any
   * node group still references it.
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @returns {Promise<object>} The delete result (e.g. `{ deleted: true }`).
   * @example
   * await sdk.amiRecipes.delete({ name: 'my-base' });
   */
  delete({ name }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}`, 'DELETE');
  }

  /**
   * Attach a built AMI to a cluster node group. The server resolves the cluster's
   * account and selects the AMI that exists in THAT account (refusing a
   * cross-account mismatch). Only `success`/`partial` builds can be attached.
   * After attaching, run the node-group apply pipeline to roll it out.
   *
   * @param {object} params
   * @param {string} params.name        - Recipe name (path).
   * @param {string} params.container   - Workspace container that owns the cluster.
   * @param {string} params.buildId     - Build to attach.
   * @param {string} params.clusterName - Target cluster name.
   * @param {string} params.ngName      - Target node-group name.
   * @param {string} params.region      - AWS region of the node group.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ attached: object, note: string }>}
   * @example
   * await sdk.amiRecipes.attach({
   *   name: 'rtpengine', container: 'app1', buildId: '2026-...-abcd1234',
   *   clusterName: 'z-01', ngName: 'rtp', region: 'us-east-2',
   * });
   */
  attach({ name, container, buildId, clusterName, ngName, region, branch = 'main' }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}/attach`, 'POST', {
      body: { container, buildId, clusterName, ngName, region, branch },
    });
  }

  /**
   * List recent build records for a recipe (with AMI-exists annotations).
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @returns {Promise<{ builds: Array<object> }>}
   * @example
   * const { builds } = await sdk.amiRecipes.builds({ name: 'rtpengine' });
   */
  builds({ name }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}/builds`, 'GET');
  }

  /**
   * Start an AMI build. STREAMING — returns an SSE stream handle emitting build
   * progress events (info/heartbeat/error/done). HTTP 409 if a run with the same
   * computed buildId is already in flight.
   *
   * @param {object} params
   * @param {string} params.name                  - Recipe name.
   * @param {string} params.sourceRegion          - Required. Region to bake the source AMI in.
   * @param {string} [params.sourceRef]           - Source ref (defaults to recipe's default; `rtpengineRef` accepted as alias).
   * @param {string[]} [params.copyToRegions]     - Regions to copy the AMI to after baking.
   * @param {string} [params.subnetId]            - Subnet for the builder instance.
   * @param {string[]} [params.securityGroupIds]  - Security groups for the builder instance.
   * @param {string} [params.accountId]           - Single AWS account to build in (null → default account).
   * @param {string[]} [params.targetAccountIds]  - Multiple accounts to fan the build out across.
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.amiRecipes.startBuild({ name: 'rtpengine', sourceRegion: 'us-east-2' });
   * for await (const ev of stream) console.log(ev.type, ev.message);
   */
  startBuild({ name, sourceRegion, sourceRef, copyToRegions, subnetId, securityGroupIds, accountId, targetAccountIds }) {
    return this.sdk._stream(`/ami-recipes/${encodeURIComponent(name)}/builds`, 'POST', {
      body: { sourceRegion, sourceRef, copyToRegions, subnetId, securityGroupIds, accountId, targetAccountIds },
    });
  }

  /**
   * Get a single build record.
   *
   * @param {object} params
   * @param {string} params.name    - Recipe name.
   * @param {string} params.buildId - Build id.
   * @returns {Promise<{ build: object }>}
   * @example
   * const { build } = await sdk.amiRecipes.getBuild({ name: 'rtpengine', buildId: '2026-...-abcd1234' });
   */
  getBuild({ name, buildId }) {
    return this.sdk._fetch(
      `/ami-recipes/${encodeURIComponent(name)}/builds/${encodeURIComponent(buildId)}`, 'GET',
    );
  }

  /**
   * Request cancellation of an in-flight build run.
   *
   * @param {object} params
   * @param {string} params.name    - Recipe name.
   * @param {string} params.buildId - Build id.
   * @returns {Promise<{ cancelled: boolean }>}
   * @example
   * await sdk.amiRecipes.cancelBuild({ name: 'rtpengine', buildId: '2026-...-abcd1234' });
   */
  cancelBuild({ name, buildId }) {
    return this.sdk._fetch(
      `/ami-recipes/${encodeURIComponent(name)}/builds/${encodeURIComponent(buildId)}/cancel`, 'POST',
    );
  }

  /**
   * Distribute a finished AMI to other AWS accounts by COPY (share +
   * cross-account CopyImage). STREAMING — returns an SSE stream handle emitting
   * progress events. HTTP 409 if a distribute run is already in flight for this build.
   *
   * @param {object} params
   * @param {string} params.name    - Recipe name.
   * @param {string} params.buildId - Build id to distribute.
   * @param {Array<{ accountId: string, regions?: string[] }>} params.targets
   *   - Target accounts; omit `regions` to copy every region the source AMI exists in.
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.amiRecipes.distribute({
   *   name: 'rtpengine', buildId: '2026-...-abcd1234',
   *   targets: [{ accountId: '111122223333' }],
   * });
   * stream.onMessage = (ev) => console.log(ev.type, ev.data);
   */
  distribute({ name, buildId, targets }) {
    return this.sdk._stream(
      `/ami-recipes/${encodeURIComponent(name)}/builds/${encodeURIComponent(buildId)}/distribute`, 'POST',
      { body: { targets } },
    );
  }

  /**
   * Reattach to an in-flight build's live + buffered output, or replay a completed
   * build's JSONL log from disk. STREAMING — returns an SSE stream handle.
   * HTTP 404 if there's neither an in-flight run nor a log file.
   *
   * @param {object} params
   * @param {string} params.name    - Recipe name.
   * @param {string} params.buildId - Build id.
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.amiRecipes.streamBuild({ name: 'rtpengine', buildId: '2026-...-abcd1234' });
   * for await (const ev of stream) console.log(ev);
   */
  streamBuild({ name, buildId }) {
    return this.sdk._stream(
      `/ami-recipes/${encodeURIComponent(name)}/builds/${encodeURIComponent(buildId)}/stream`, 'GET',
    );
  }

  /**
   * List the live AMIs for a recipe in an account (region-aware), plus the active
   * retention policy.
   *
   * @param {object} params
   * @param {string} params.name        - Recipe name.
   * @param {string} [params.accountId] - AWS account (null → default account).
   * @returns {Promise<{ regions: string[], images: object, keepVersions: number, autoMakeCurrent: boolean }>}
   * @example
   * const { images, keepVersions } = await sdk.amiRecipes.cloudImages({ name: 'rtpengine' });
   */
  cloudImages({ name, accountId }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}/cloud-images`, 'GET', {
      query: { accountId },
    });
  }

  /**
   * Manage a recipe's live AMIs / retention policy. Action-routed.
   * Returns the refreshed image list + policy.
   *
   * @param {object} params
   * @param {('makeCurrent'|'useLatest'|'delete'|'protect'|'unprotect'|'setPolicy')} params.action
   * @param {string} [params.accountId]      - AWS account (null → default).
   * @param {string} [params.region]         - Region (required for makeCurrent/useLatest/delete/protect/unprotect).
   * @param {string} [params.image]          - AMI id (required for makeCurrent/delete/protect/unprotect).
   * @param {boolean} [params.force]          - For `delete`: force-delete a protected/in-use image.
   * @param {boolean} [params.autoMakeCurrent] - For `setPolicy`.
   * @param {number} [params.keepVersions]    - For `setPolicy`.
   * @returns {Promise<{ ok: true, regions: string[], images: object, keepVersions: number, autoMakeCurrent: boolean }>}
   * @example
   * await sdk.amiRecipes.cloudImageAction({ name: 'rtpengine', action: 'makeCurrent', region: 'us-east-2', image: 'ami-0abc' });
   * await sdk.amiRecipes.cloudImageAction({ name: 'rtpengine', action: 'setPolicy', keepVersions: 3, autoMakeCurrent: true });
   */
  cloudImageAction({ name, action, accountId, region, image, force, autoMakeCurrent, keepVersions }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}/cloud-images`, 'POST', {
      body: { action, accountId, region, image, force, autoMakeCurrent, keepVersions },
    });
  }

  /**
   * Preview (plan) a build for a recipe — resolves inputs/region/AMI selection
   * without baking anything.
   *
   * @param {object} params
   * @param {string} params.name - Recipe name.
   * @param {object} [params.input] - Plan inputs (forwarded as the request body; e.g. sourceRegion, sourceRef, accountId).
   * @returns {Promise<{ plan: object }>}
   * @example
   * const { plan } = await sdk.amiRecipes.plan({ name: 'rtpengine', input: { sourceRegion: 'us-east-2' } });
   */
  plan({ name, input = {} }) {
    return this.sdk._fetch(`/ami-recipes/${encodeURIComponent(name)}/plan`, 'POST', { body: input });
  }

  /**
   * Check or provision the AMI-builder EC2 instance profile in an account.
   *
   * @param {object} params
   * @param {string} [params.accountId]            - AWS account (null → default).
   * @param {('check'|'ensure')} [params.action='check'] - `check` reports state; `ensure` creates role + instance profile (idempotent).
   * @returns {Promise<{ ok: true, action: 'check'|'ensure', result: object }>}
   *   `check` result → `{ exists, hasRole }`; `ensure` result → `{ steps, ... }`.
   * @example
   * const { result } = await sdk.amiRecipes.builderProfile({ accountId: '111122223333', action: 'check' });
   * await sdk.amiRecipes.builderProfile({ accountId: '111122223333', action: 'ensure' });
   */
  builderProfile({ accountId, action = 'check' }) {
    return this.sdk._fetch('/ami-recipes/builder-profile', 'POST', { body: { accountId, action } });
  }
}
