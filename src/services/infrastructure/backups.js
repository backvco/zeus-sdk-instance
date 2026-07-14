// @ts-nocheck
/**
 * InfrastructureBackupsService — backup browsing + manual operations for
 * database addon deployments. Accessed as `sdk.infrastructure.backups`.
 *
 * Backups land in S3 via an environment "backup profile" (bucket + credentials,
 * decrypted at request time). This namespace lets you list what's in S3,
 * trigger an on-demand backup, backfill the `backup-info.json` index, and
 * rotate the zeus-managed backup-user credential.
 *
 * All methods are container-scoped (first param `container`).
 */
export class InfrastructureBackupsService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container) {
    return `/v2configs/${encodeURIComponent(container)}/infrastructure/backups`;
  }

  /**
   * List backups from S3. With no `addonName`/`clusterName`, scans ALL backup
   * sources in the environment; with both, lists backups for that specific
   * addon+cluster deployment. Requires a `profileName` (env backup profile).
   *
   * @param {object} params
   * @param {string} params.container        - Container name.
   * @param {string} params.environmentName  - Environment name.
   * @param {string} params.profileName      - Backup profile name (provides bucket + creds).
   * @param {string} [params.addonName]      - Addon id (with `clusterName` → mode 2).
   * @param {string} [params.clusterName]    - Cluster name (with `addonName` → mode 2). Not required when `setName` is given.
   * @param {string} [params.releaseName]    - Release name for orphaned/uninstalled deployments.
   * @param {string} [params.setName]        - Replication-set name — routes mode 2 to the shared `sets/<setName>` subtree instead of a standalone `<cluster>/<release>` path (backup-identity-per-set.md v2). Required for set sources with no resolvable `clusterName`.
   * @param {string} [params.serverName]     - CNPG member folder name within a set (postgresql-cluster set sources only) — which member's barman folder to list.
   * @param {string} [params.branch]         - Config branch (default 'main').
   * @returns {Promise<object>} Scan summary (mode 1) or backup list (mode 2).
   * @example
   * const all = await sdk.infrastructure.backups.list({ container: 'app1', environmentName: 'prod', profileName: 'default' });
   * const one = await sdk.infrastructure.backups.list({
   *   container: 'app1', environmentName: 'prod', profileName: 'default',
   *   addonName: 'mysql-innodbcluster', clusterName: 'z-01'
   * });
   */
  list({ container, environmentName, profileName, addonName, clusterName, releaseName, setName, serverName, branch }) {
    return this.sdk._fetch(this._base(container), 'GET', {
      query: { environmentName, profileName, addonName, clusterName, releaseName, setName, serverName, branch },
    });
  }

  /**
   * Trigger a manual backup for a DB addon deployment (creates a CNPG Backup CRD
   * or a one-off Job from the backup CronJob).
   *
   * @param {object} params
   * @param {string} params.container        - Container name.
   * @param {string} params.addonName        - DB addon id.
   * @param {string} params.environmentName  - Environment name.
   * @param {string} params.clusterName      - Cluster name.
   * @param {string} [params.deploymentName] - Deployment name (auto-resolved if omitted).
   * @returns {Promise<{ success: true, jobName: string, addonName: string, releaseName: string, namespace: string, type: 'manual', message: string }>}
   * @example
   * await sdk.infrastructure.backups.trigger({
   *   container: 'app1', addonName: 'postgresql-cluster', environmentName: 'prod', clusterName: 'z-01'
   * });
   */
  trigger({ container, addonName, environmentName, clusterName, deploymentName }) {
    return this.sdk._fetch(`${this._base(container)}/trigger`, 'POST', {
      body: { addonName, environmentName, clusterName, deploymentName },
    });
  }

  /**
   * Backfill `backup-info.json` for backup-enabled deployments (one env or all).
   * Deployments without an assigned backup profile are skipped and reported.
   * `environmentName` is passed as a query param.
   *
   * @param {object} params
   * @param {string} params.container         - Container name.
   * @param {string} [params.environmentName] - Limit to one environment (else all).
   * @param {string} [params.branch]          - Config branch (default 'main').
   * @returns {Promise<{ written: string[], skipped: string[], errors: string[], summary: string }>}
   * @example
   * const r = await sdk.infrastructure.backups.backfill({ container: 'app1', environmentName: 'prod' });
   */
  backfill({ container, environmentName, branch }) {
    return this.sdk._fetch(`${this._base(container)}/backfill`, 'POST', {
      query: { environmentName, branch },
    });
  }

  /**
   * Rotate the zeus-managed backup-user password (mysql-innodbcluster only):
   * deletes the backup-creds Secret and triggers a helm upgrade to regenerate
   * it. Returns synchronous JSON.
   *
   * @param {object} params
   * @param {string} params.container        - Container name.
   * @param {string} params.addonName        - Must be 'mysql-innodbcluster'.
   * @param {string} params.environmentName  - Environment name.
   * @param {string} params.clusterName      - Cluster name.
   * @param {string} [params.deploymentName] - Deployment name (auto-resolved if omitted).
   * @returns {Promise<{ success: true, releaseName: string, namespace: string, message: string }>}
   * @example
   * await sdk.infrastructure.backups.rotateCredentials({
   *   container: 'app1', addonName: 'mysql-innodbcluster', environmentName: 'prod', clusterName: 'z-01'
   * });
   */
  rotateCredentials({ container, addonName, environmentName, clusterName, deploymentName }) {
    return this.sdk._fetch(`${this._base(container)}/rotate-credentials`, 'POST', {
      body: { addonName, environmentName, clusterName, deploymentName },
    });
  }

  /**
   * YugabyteDB point-in-time recovery bounds — `[now - retentionMinutes, now]`
   * from the deployment's own `pitr.retentionMinutes` config, plus a
   * best-effort live snapshot-schedule id (see the API route's own caveat
   * about yb-admin's text-output parsing).
   *
   * @param {object} params
   * @param {string} params.container        - Container name.
   * @param {string} params.environmentName  - Environment name.
   * @param {string} params.clusterName      - Cluster name.
   * @param {string} [params.branch]         - Config branch (default 'main').
   * @returns {Promise<{ pitrEnabled: boolean, pitrRange: {earliest:string,latest:string}|null, scheduleId?: string|null, scheduleError?: string|null }>}
   * @example
   * const { pitrRange } = await sdk.infrastructure.backups.pitrRange({
   *   container: 'app1', environmentName: 'prod', clusterName: 'z-01'
   * });
   */
  pitrRange({ container, environmentName, clusterName, branch }) {
    return this.sdk._fetch(`${this._base(container)}/yugabyte-pitr`, 'GET', {
      query: { environmentName, clusterName, branch },
    });
  }

  /**
   * Restore a YugabyteDB universe to a point in time via its snapshot
   * schedule (`yb-admin restore_snapshot_schedule`) — an IN-PLACE action on
   * the already-installed universe, not a new install (unlike CNPG/NDB
   * restore, which reinstall from an S3 dump). **Streaming** — returns an
   * SSE stream handle. Emits `step`/`error` events and a final `done`
   * payload `{ ok, message?, error?, raw? }`. Throws HTTP 409 if a PITR
   * restore is already in flight for this deployment.
   *
   * @param {object} params
   * @param {string} params.container        - Container name.
   * @param {string} params.environmentName  - Environment name.
   * @param {string} params.clusterName      - Cluster name.
   * @param {string} params.targetTime       - ISO-8601 timestamp to restore to (within the retention window).
   * @param {string} [params.branch]         - Config branch (default 'main').
   * @returns {ReturnType<import('../base.js').BaseSDK['_stream']>} SSE stream handle.
   * @example
   * const stream = sdk.infrastructure.backups.pitrRestore({
   *   container: 'app1', environmentName: 'prod', clusterName: 'z-01',
   *   targetTime: '2026-07-12T14:00:00.000Z'
   * });
   * stream.onDone((res) => console.log('done', res));
   */
  pitrRestore({ container, environmentName, clusterName, branch, targetTime }) {
    return this.sdk._stream(`${this._base(container)}/yugabyte-pitr`, 'POST', {
      body: { environmentName, clusterName, branch, targetTime },
    });
  }
}
