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
   * @param {string} [params.clusterName]    - Cluster name (with `addonName` → mode 2).
   * @param {string} [params.releaseName]    - Release name for orphaned/uninstalled deployments.
   * @param {string} [params.branch]         - Config branch (default 'main').
   * @returns {Promise<object>} Scan summary (mode 1) or backup list (mode 2).
   * @example
   * const all = await sdk.infrastructure.backups.list({ container: 'app1', environmentName: 'prod', profileName: 'default' });
   * const one = await sdk.infrastructure.backups.list({
   *   container: 'app1', environmentName: 'prod', profileName: 'default',
   *   addonName: 'mysql-innodbcluster', clusterName: 'z-01'
   * });
   */
  list({ container, environmentName, profileName, addonName, clusterName, releaseName, branch }) {
    return this.sdk._fetch(this._base(container), 'GET', {
      query: { environmentName, profileName, addonName, clusterName, releaseName, branch },
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
}
