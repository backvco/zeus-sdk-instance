// @ts-nocheck
/**
 * InfrastructureRotateService — credential rotation for database / addon
 * deployments. Accessed as `sdk.infrastructure.rotate`.
 *
 * Rotation is per-deployment (addon + environment + cluster + deployment) and
 * always handles ONE credential ("role") at a time. The typical lifecycle:
 *
 *   1. {@link roles}     — discover the rotatable credentials on the deployment.
 *   2. {@link preflight} — dry-run the driver's safety checks for one role.
 *   3. {@link run}       — start the rotation (SSE stream of progress events).
 *   4. {@link history}   — replay the on-disk audit log for past runs.
 *
 * Crash recovery: an interrupted run leaves an encrypted orphan run-state blob;
 * {@link listOrphans} lists them and {@link recover} discards or resumes one
 * (resume re-streams from the recorded cursor).
 *
 * All methods are container-scoped (first param `container`).
 */
export class InfrastructureRotateService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container) {
    return `/v2configs/${encodeURIComponent(container)}/infrastructure/rotate`;
  }

  /**
   * Discover the rotatable credentials ("roles") on a deployment, each enriched
   * with `lastRotatedAt` from the audit log.
   *
   * @param {object} params
   * @param {string} params.container       - Container name.
   * @param {string} params.addonName       - Addon id (must support rotation, e.g. 'mysql-innodbcluster').
   * @param {string} params.environmentName - Environment name.
   * @param {string} params.clusterName     - Cluster name.
   * @param {string} params.deploymentName  - Deployment (instance) name within the addon.
   * @returns {Promise<{ roles: Array<{ key: string, label?: string, lastRotatedAt?: string, [k:string]: any }> }>}
   * @example
   * const { roles } = await sdk.infrastructure.rotate.roles({
   *   container: 'app1', addonName: 'mysql-innodbcluster',
   *   environmentName: 'prod', clusterName: 'z-01', deploymentName: 'primary'
   * });
   * // → { roles: [{ key: 'root', lastRotatedAt: '2026-06-01T...' }, ...] }
   */
  roles({ container, addonName, environmentName, clusterName, deploymentName }) {
    return this.sdk._fetch(`${this._base(container)}/roles`, 'POST', {
      body: { addonName, environmentName, clusterName, deploymentName },
    });
  }

  /**
   * Run the rotation driver's preflight checks against exactly ONE role
   * (without mutating anything). Validates secret readability, current-
   * credential validity, and rotation order.
   *
   * @param {object} params
   * @param {string} params.container       - Container name.
   * @param {string} params.addonName       - Addon id.
   * @param {string} params.environmentName - Environment name.
   * @param {string} params.clusterName     - Cluster name.
   * @param {string} params.deploymentName  - Deployment name.
   * @param {Array<string|{key:string}>} params.roles - Exactly one role (key string or `{key}`).
   * @returns {Promise<{ checks: Array<{ name: string, ok: boolean, detail?: string }>, orderValid: boolean, orderError: string|null }>}
   * @example
   * const pf = await sdk.infrastructure.rotate.preflight({
   *   container: 'app1', addonName: 'mysql-innodbcluster',
   *   environmentName: 'prod', clusterName: 'z-01', deploymentName: 'primary',
   *   roles: ['root']
   * });
   * // → { checks: [{ name: 'secret-readable', ok: true }], orderValid: true, orderError: null }
   */
  preflight({ container, addonName, environmentName, clusterName, deploymentName, roles }) {
    return this.sdk._fetch(`${this._base(container)}/preflight`, 'POST', {
      body: { addonName, environmentName, clusterName, deploymentName, roles },
    });
  }

  /**
   * Start a rotation run for exactly ONE role. **Streaming** — returns a stream
   * handle (async-iterable + `onMessage/onDone/onError/close()`). Emits
   * `progress.*` events (info/step/success/warn/error) and a final `done`
   * payload `{ ok, completed, failed, newPasswords?, runId }`. A `revealOnce`
   * frame carries the freshly-generated password(s). Returns HTTP 409 (thrown)
   * if a rotation for the same deployment is already in flight.
   *
   * @param {object} params
   * @param {string} params.container       - Container name.
   * @param {string} params.addonName       - Addon id.
   * @param {string} params.environmentName - Environment name.
   * @param {string} params.clusterName     - Cluster name.
   * @param {string} params.deploymentName  - Deployment name.
   * @param {Array<string|{key:string}>} params.roles - Exactly one role.
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.rotate.run({
   *   container: 'app1', addonName: 'mysql-innodbcluster',
   *   environmentName: 'prod', clusterName: 'z-01', deploymentName: 'primary',
   *   roles: ['root']
   * });
   * stream.onMessage = (ev) => console.log(ev.type, ev.data);
   * stream.onDone((res) => console.log('done', res)); // → { ok: true, completed: ['root'], ... }
   */
  run({ container, addonName, environmentName, clusterName, deploymentName, roles }) {
    return this.sdk._stream(`${this._base(container)}/rotate`, 'POST', {
      body: { addonName, environmentName, clusterName, deploymentName, roles },
    });
  }

  /**
   * Reattach to an in-flight (or recently-finished) rotation run by its runKey.
   * **Streaming** — returns a stream handle. The runKey has the shape
   * `rotate:<container>:<env>:<cluster>:<addon>:<deployment>`. Throws HTTP 404
   * if no such run exists.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.runKey    - The run key to reattach to.
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.rotate.attach({
   *   container: 'app1',
   *   runKey: 'rotate:app1:prod:z-01:mysql-innodbcluster:primary'
   * });
   */
  attach({ container, runKey }) {
    return this.sdk._stream(`${this._base(container)}/rotate`, 'GET', { query: { runKey } });
  }

  /**
   * Read rotation history from the on-disk JSONL audit logs for an addon +
   * environment + cluster. With `runId`, returns that run's full event list;
   * without it, returns the list of run ids + timestamps.
   *
   * @param {object} params
   * @param {string} params.container       - Container name.
   * @param {string} params.addonName       - Addon id.
   * @param {string} params.environmentName - Environment name.
   * @param {string} params.clusterName     - Cluster name.
   * @param {string} [params.runId]         - A specific run id to fetch its events.
   * @returns {Promise<{ runs: Array<{ runId: string, at: string }> } | { runId: string, events: Array<object> }>}
   * @example
   * const { runs } = await sdk.infrastructure.rotate.history({
   *   container: 'app1', addonName: 'mysql-innodbcluster',
   *   environmentName: 'prod', clusterName: 'z-01'
   * });
   * const { events } = await sdk.infrastructure.rotate.history({
   *   container: 'app1', addonName: 'mysql-innodbcluster',
   *   environmentName: 'prod', clusterName: 'z-01', runId: runs[0].runId
   * });
   */
  history({ container, addonName, environmentName, clusterName, runId }) {
    return this.sdk._fetch(`${this._base(container)}/history`, 'GET', {
      query: { addonName, environmentName, clusterName, runId },
    });
  }

  /**
   * List orphaned rotation run-state files (encrypted blobs left by crashed
   * runs) belonging to this container.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @returns {Promise<{ orphans: Array<{ runId: string, addonName: string, environmentName: string, clusterName: string, container: string, [k:string]: any }> }>}
   * @example
   * const { orphans } = await sdk.infrastructure.rotate.listOrphans({ container: 'app1' });
   */
  listOrphans({ container }) {
    return this.sdk._fetch(`${this._base(container)}/recover`, 'GET');
  }

  /**
   * Discard an orphaned rotation run-state (synchronous JSON).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.runId    - Orphan run id to discard.
   * @returns {Promise<{ ok: true, discarded: string }>}
   * @example
   * await sdk.infrastructure.rotate.discard({ container: 'app1', runId: '...' });
   */
  discard({ container, runId }) {
    return this.sdk._fetch(`${this._base(container)}/recover`, 'POST', {
      body: { action: 'discard', runId },
    });
  }

  /**
   * Resume an orphaned rotation run from its recorded cursor. **Streaming** —
   * returns a stream handle that re-runs the remaining stages with the
   * persisted old/new passwords and emits a final `done`
   * `{ ok, resumedFrom, completed, failed, runId }`.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.runId    - Orphan run id to resume.
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.rotate.recover({ container: 'app1', runId: '...' });
   * stream.onDone((res) => console.log(res)); // → { ok: true, resumedFrom: '...', completed: [...], ... }
   */
  recover({ container, runId }) {
    return this.sdk._stream(`${this._base(container)}/recover`, 'POST', {
      body: { action: 'resume', runId },
    });
  }
}
