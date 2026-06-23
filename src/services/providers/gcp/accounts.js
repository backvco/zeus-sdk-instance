// @ts-nocheck
/**
 * GcpAccountsService — the linked-GCP-account store + everything scoped to one.
 *
 * Accessed as `sdk.providers.gcp.accounts`.
 *
 * A GCP account is a service-account credential. Besides CRUD + a default pointer
 * + Cloud-DNS-based verification, this covers the per-account project registry,
 * available-project discovery, live GKE cluster discovery, and GKE server-config
 * (k8s versions per release channel). The SA key is never returned by reads. The
 * CLI-driven account-link flow lives on the parent `sdk.providers.gcp` service.
 */
export class GcpAccountsService {
  constructor(sdk) { this.sdk = sdk; }

  _a(id) { return encodeURIComponent(id); }
  _base(id) { return `/providers/gcp/accounts/${this._a(id)}`; }

  /**
   * List linked GCP accounts (sanitized — the SA key is never returned).
   *
   * @returns {Promise<{ accounts: Array<object>, defaultAccountId: string|null }>}
   * @example
   * const { accounts } = await sdk.providers.gcp.accounts.list();
   */
  list() { return this.sdk._fetch('/providers/gcp/accounts', 'GET'); }

  /**
   * Create / update a linked GCP account.
   *
   * @param {object} params
   * @param {string} params.accountId          - Account id.
   * @param {string} [params.alias]             - Short alias.
   * @param {string} [params.displayName]       - Friendly name.
   * @param {string} [params.projectId]         - Operator project id.
   * @param {string} [params.credentialType]    - e.g. 'service-account'.
   * @param {string} [params.serviceAccountKey] - SA key JSON (encrypted at rest).
   * @returns {Promise<{ account: object }>}
   * @example
   * await sdk.providers.gcp.accounts.create({ accountId: 'prod', projectId: 'my-proj', serviceAccountKey: '{…}' });
   */
  create(params) { return this.sdk._fetch('/providers/gcp/accounts', 'POST', { body: params }); }

  /**
   * Get one linked account (sanitized).
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @returns {Promise<{ account: object }>}
   * @example
   * const { account } = await sdk.providers.gcp.accounts.get({ accountId: 'prod' });
   */
  get({ accountId }) { return this.sdk._fetch(this._base(accountId), 'GET'); }

  /**
   * Update a linked account's fields. Empty `serviceAccountKey` is dropped
   * server-side (leave the stored key as-is).
   *
   * @param {object} params
   * @param {string} params.accountId - Account id (path; wins over body).
   * @param {object} [params.fields]  - Fields to update.
   * @returns {Promise<{ account: object }>}
   * @example
   * await sdk.providers.gcp.accounts.update({ accountId: 'prod', fields: { displayName: 'Production' } });
   */
  update({ accountId, fields = {} }) { return this.sdk._fetch(this._base(accountId), 'PUT', { body: fields }); }

  /**
   * Make a linked account the default (PUT action=set-default).
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @returns {Promise<{ account: object|null, defaulted: true }>}
   * @example
   * await sdk.providers.gcp.accounts.setDefault({ accountId: 'prod' });
   */
  setDefault({ accountId }) {
    return this.sdk._fetch(this._base(accountId), 'PUT', { body: { action: 'set-default' } });
  }

  /**
   * Delete a linked account.
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @param {boolean} [params.force]  - Force delete (?force=1).
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.gcp.accounts.delete({ accountId: 'prod', force: true });
   */
  delete({ accountId, force }) {
    return this.sdk._fetch(this._base(accountId), 'DELETE', { query: { force: force ? '1' : undefined } });
  }

  /**
   * Verify an account's credentials by listing Cloud DNS managed zones. Pass a
   * `serviceAccountKey` to verify ad-hoc pre-save; omit to verify the saved
   * account. Never throws on bad creds — returns `{ ok:false }`.
   *
   * @param {object} params
   * @param {string} params.accountId          - Account id (path).
   * @param {string} [params.serviceAccountKey] - Ad-hoc SA key JSON to verify.
   * @param {string} [params.projectId]         - Project override for the check.
   * @returns {Promise<{ ok: boolean, projectId?: string, zoneCount?: number, error?: string }>}
   * @example
   * const r = await sdk.providers.gcp.accounts.verify({ accountId: 'prod' });
   */
  verify({ accountId, serviceAccountKey, projectId }) {
    return this.sdk._fetch(`${this._base(accountId)}/verify`, 'POST', { body: { serviceAccountKey, projectId } });
  }

  /**
   * List the GCP projects this account's SA can see (Cloud Resource Manager
   * search), annotated with registration state/ownership.
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @returns {Promise<{ ok: true, projects: Array<{ projectId: string, displayName: string, registered: boolean, registeredTo: string|null, registeredToThisAccount: boolean }> }>}
   * @example
   * const { projects } = await sdk.providers.gcp.accounts.availableProjects({ accountId: 'prod' });
   */
  availableProjects({ accountId }) {
    return this.sdk._fetch(`${this._base(accountId)}/available-projects`, 'GET');
  }

  /**
   * List the projects registered to this account.
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @returns {Promise<{ operatorProject: string|null, projects: Array<object> }>}
   * @example
   * const { projects } = await sdk.providers.gcp.accounts.projects({ accountId: 'prod' });
   */
  projects({ accountId }) { return this.sdk._fetch(`${this._base(accountId)}/projects`, 'GET'); }

  /**
   * Register a project to this account (admin). 409 if owned by another account.
   *
   * @param {object} params
   * @param {string} params.accountId      - Account id.
   * @param {string} params.projectId      - Project id to register.
   * @param {string} [params.displayName]  - Optional display name.
   * @returns {Promise<{ ok: true, projects: Array<object> }>}
   * @example
   * await sdk.providers.gcp.accounts.registerProject({ accountId: 'prod', projectId: 'my-proj' });
   */
  registerProject({ accountId, projectId, displayName }) {
    return this.sdk._fetch(`${this._base(accountId)}/projects`, 'POST', { body: { projectId, displayName } });
  }

  /**
   * Unregister a project from this account (admin). Cannot unregister the
   * operator project.
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @param {string} params.projectId - Project id (query).
   * @returns {Promise<{ ok: true, projects: Array<object> }>}
   * @example
   * await sdk.providers.gcp.accounts.unregisterProject({ accountId: 'prod', projectId: 'my-proj' });
   */
  unregisterProject({ accountId, projectId }) {
    return this.sdk._fetch(`${this._base(accountId)}/projects`, 'DELETE', { query: { projectId } });
  }

  /**
   * Discover live GKE clusters in a project + location.
   *
   * @param {object} params
   * @param {string} params.accountId      - Account id.
   * @param {string} params.project        - Project id (required).
   * @param {string} [params.location='-'] - Location ('-' = all).
   * @returns {Promise<{ clusters: Array<{ name: string, location: string, version: string, channel: string, status: string, nodePoolCount: number }> }>}
   * @example
   * const { clusters } = await sdk.providers.gcp.accounts.clusters({ accountId: 'prod', project: 'my-proj' });
   */
  clusters({ accountId, project, location }) {
    return this.sdk._fetch(`${this._base(accountId)}/clusters`, 'GET', { query: { project, location } });
  }

  /**
   * GKE server config: k8s versions per release channel for a location.
   *
   * @param {object} params
   * @param {string} params.accountId               - Account id.
   * @param {string} params.project                 - Project id (required).
   * @param {string} [params.location='us-central1'] - Location.
   * @returns {Promise<{ validVersions: Array<string>, defaultVersion: string|null, channels: Record<string, { validVersions: Array<string>, defaultVersion: string|null }> }>}
   * @example
   * const { channels } = await sdk.providers.gcp.accounts.serverConfig({ accountId: 'prod', project: 'my-proj', location: 'us-central1' });
   */
  serverConfig({ accountId, project, location }) {
    return this.sdk._fetch(`${this._base(accountId)}/server-config`, 'GET', { query: { project, location } });
  }
}
