// @ts-nocheck
import { GcpAccountsService } from './gcp/accounts.js';
import { GcpImagesService } from './gcp/images.js';

/**
 * GcpService — the GCP / GKE provider namespace.
 *
 * Accessed as `sdk.providers.gcp`.
 *
 * Covers the CLI-driven account-link flow, identity probe, region/project/
 * machine-type catalogs, per-provider settings (favorited regions), the IAM
 * permission coverage check + tier registry + API-enable + permission-fix flow,
 * and the Workload-Identity binding helper. The linked-account store + per-account
 * project registry / GKE discovery / server-config live on
 * `sdk.providers.gcp.accounts`; the GCE custom-image recipe/build system is
 * `sdk.providers.gcp.images`.
 *
 * A linked GCP account is a service-account credential; `accountId` scopes most
 * calls (omit → default account). GCP work is also project-scoped — many methods
 * take a `project` (defaults to the account's operator project where applicable).
 */
export class GcpService {
  constructor(sdk) {
    this.sdk = sdk;
    this.accounts = new GcpAccountsService(sdk);
    this.images = new GcpImagesService(sdk);
  }

  // ── Account link (CLI flow) ─────────────────────────────────

  /**
   * Start the CLI account-link flow. Returns the one-liner the operator pastes
   * into a terminal (the bootstrap creates Zeus's SA + key and posts it back).
   *
   * @returns {Promise<{ token: string, expiresAt: string, command: string, zeusUrl: string }>}
   * @example
   * const { command, token } = await sdk.providers.gcp.linkInit();
   */
  linkInit() { return this.sdk._fetch('/providers/gcp/accounts/link/init', 'POST'); }

  /**
   * CLI claim beacon (anonymous; token is the auth). Normally called by the
   * bootstrap script.
   *
   * @param {object} params
   * @param {string} params.token - The pairing token.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.gcp.linkClaim({ token });
   */
  linkClaim({ token }) {
    return this.sdk._fetch('/providers/gcp/accounts/link/claim', 'POST', { body: { token } });
  }

  /**
   * CLI completion beacon — posts the freshly-minted SA key to register the
   * account (anonymous; token is the auth). The key may be sent base64 via
   * `serviceAccountKeyB64`.
   *
   * @param {object} params
   * @param {string} params.token              - The pairing token.
   * @param {string} params.accountId          - New account id.
   * @param {string} [params.alias]             - Account alias.
   * @param {string} [params.projectId]         - Operator project id.
   * @param {string} [params.clientEmail]       - SA client email.
   * @param {string} [params.serviceAccountKey] - SA key JSON.
   * @param {string} [params.serviceAccountKeyB64] - SA key JSON, base64-encoded.
   * @param {string} [params.projectsCsv]       - CSV of projects to register.
   * @returns {Promise<{ ok: true, account: object, registered: Array<string>, skipped: Array<{ projectId: string, reason: string }> }>}
   * @example
   * await sdk.providers.gcp.linkComplete({ token, accountId: 'prod', serviceAccountKey: '{…}' });
   */
  linkComplete({ token, accountId, alias, projectId, clientEmail, serviceAccountKey, serviceAccountKeyB64, projectsCsv }) {
    return this.sdk._fetch('/providers/gcp/accounts/link/complete', 'POST', {
      body: { token, accountId, alias, projectId, clientEmail, serviceAccountKey, serviceAccountKeyB64, projectsCsv },
    });
  }

  /**
   * Poll a link flow's status.
   *
   * @param {object} params
   * @param {string} params.token - The pairing token.
   * @returns {Promise<{ status: string, expiresAt?: string, claimedAt?: string, result?: object, error?: string }>}
   * @example
   * const { status } = await sdk.providers.gcp.linkStatus({ token });
   */
  linkStatus({ token }) {
    return this.sdk._fetch('/providers/gcp/accounts/link/status', 'GET', { query: { token } });
  }

  // ── Identity / catalogs ─────────────────────────────────────

  /**
   * GCP caller-identity probe for the resolved account. Returns 200 with
   * `{ ok:false, error }` on credential failure (never throws).
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Scope to one linked account.
   * @returns {Promise<{ accountId: string, ok: boolean, email?: string, projectId?: string, credentialType?: string, error?: string }>}
   * @example
   * const id = await sdk.providers.gcp.identity({ accountId: 'prod' });
   */
  identity({ accountId } = {}) {
    return this.sdk._fetch('/providers/gcp/identity', 'GET', { query: { accountId } });
  }

  /**
   * All GCP regions (compute.regions.list) overlaid with zeus GKE clusters.
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Scope to one linked account.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ regions: Array<{ name: string, status: string, zones: Array<string>, hasClusters: boolean, clusters: Array<object> }>> }>}
   * @example
   * const { regions } = await sdk.providers.gcp.regions();
   */
  regions({ accountId, branch } = {}) {
    return this.sdk._fetch('/providers/gcp/regions', 'GET', { query: { accountId, branch } });
  }

  /**
   * List the registered GCP projects (static registry; no GCP calls).
   *
   * @returns {Promise<{ operatorProject: string|null, projects: Array<{ projectId: string, displayName: string|null }> }>}
   * @example
   * const { projects } = await sdk.providers.gcp.projects();
   */
  projects() { return this.sdk._fetch('/providers/gcp/projects', 'GET'); }

  /**
   * GCE machine types for a region (live specs merged with cached pricing).
   *
   * @param {object} params
   * @param {string} params.region      - GCP region (required).
   * @param {string} [params.accountId] - Scope to one linked account.
   * @param {string} [params.project]   - Project override.
   * @returns {Promise<{ region: string, project: string, regionZones: Array<string>, machineTypes: Array<{ name: string, vcpus: number, memoryMb: number, sharedCpu: boolean, arch: string, description: string, zones: Array<string>, priceHourly: number|null, spotPriceHourly: number|null }> }>}
   * @example
   * const { machineTypes } = await sdk.providers.gcp.machineTypes({ region: 'us-central1' });
   */
  machineTypes({ region, accountId, project }) {
    return this.sdk._fetch('/providers/gcp/machine-types', 'GET', { query: { region, accountId, project } });
  }

  // ── Settings ────────────────────────────────────────────────

  /**
   * Get GCP provider settings (favorited regions; auto-seeded on first read).
   *
   * @param {object} [params]
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ settings: { favoritedRegions: Array<string> } }>}
   * @example
   * const { settings } = await sdk.providers.gcp.getSettings();
   */
  getSettings({ branch } = {}) {
    return this.sdk._fetch('/providers/gcp/settings', 'GET', { query: { branch } });
  }

  /**
   * Replace the favorited-regions list.
   *
   * @param {object} params
   * @param {string[]} params.favoritedRegions - Region names.
   * @param {string} [params.branch='main']    - Config branch (query).
   * @returns {Promise<{ settings: { favoritedRegions: Array<string> } }>}
   * @example
   * await sdk.providers.gcp.saveSettings({ favoritedRegions: ['us-central1'] });
   */
  saveSettings({ favoritedRegions, branch }) {
    return this.sdk._fetch('/providers/gcp/settings', 'PUT', { body: { favoritedRegions }, query: { branch } });
  }

  // ── Permissions / setup ─────────────────────────────────────

  /**
   * IAM coverage check (single projects.testIamPermissions call — plain JSON, not
   * SSE). Returns 200 with `{ ok:false, error }` on a check failure (never throws).
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Linked account to check.
   * @param {string} [params.projectId] - Project to check coverage on.
   * @returns {Promise<{ ok: boolean, accountId?: string, error?: string, [k: string]: any }>}
   * @example
   * const r = await sdk.providers.gcp.permissionsCheck({ accountId: 'prod', projectId: 'my-proj' });
   */
  permissionsCheck({ accountId, projectId } = {}) {
    return this.sdk._fetch('/providers/gcp/permissions-check', 'POST', { body: { accountId, projectId } });
  }

  /**
   * Enable required Google APIs on a project, in-app (admin). Only zeus's known
   * required APIs are enableable here.
   *
   * @param {object} params
   * @param {string} params.projectId    - Project id (required).
   * @param {string[]} params.services    - API service ids to enable.
   * @param {string} [params.accountId]  - Linked account whose SA to use.
   * @returns {Promise<{ ok: true, enabled: Array<string> }>}
   * @example
   * await sdk.providers.gcp.enableApis({ projectId: 'my-proj', services: ['container.googleapis.com'] });
   */
  enableApis({ projectId, services, accountId }) {
    return this.sdk._fetch('/providers/gcp/setup/enable-apis', 'POST', { body: { projectId, services, accountId } });
  }

  /**
   * List the GCP capability tiers (static metadata; includes `roles[]`).
   *
   * @returns {Promise<{ tiers: Array<{ id: string, label: string, summary: string, scope: string, recommended: boolean, roles: Array<string> }> }>}
   * @example
   * const { tiers } = await sdk.providers.gcp.setupTiers();
   */
  setupTiers() { return this.sdk._fetch('/providers/gcp/setup/tiers', 'GET'); }

  /**
   * Start a GCP "fix permissions" session (admin). Returns the one-time token +
   * curl command that grants the selected per-project roles to zeus's SA.
   *
   * @param {object} params
   * @param {Array<{ projectId: string, roles: Array<string> }>} params.grants - Per-project role grants.
   * @param {string} [params.accountId] - Linked account (resolves the SA email).
   * @returns {Promise<{ token: string, expiresAt: string, command: string }>}
   * @example
   * const { command } = await sdk.providers.gcp.fixInit({ accountId: 'prod', grants: [{ projectId: 'my-proj', roles: ['roles/container.admin'] }] });
   */
  fixInit({ grants, accountId }) {
    return this.sdk._fetch('/providers/gcp/setup/fix/init', 'POST', { body: { grants, accountId } });
  }

  /**
   * CLI claim for the GCP fix flow (anonymous; token is the auth).
   *
   * @param {object} params
   * @param {string} params.token - The fix-session token.
   * @returns {Promise<{ saEmail: string|null, grants: Array<{ projectId: string, roles: Array<string> }> }>}
   * @example
   * const { grants } = await sdk.providers.gcp.fixClaim({ token });
   */
  fixClaim({ token }) {
    return this.sdk._fetch('/providers/gcp/setup/fix/claim', 'POST', { body: { token } });
  }

  /**
   * CLI completion beacon for the GCP fix flow (anonymous; token is the auth).
   *
   * @param {object} params
   * @param {string} params.token   - The fix-session token.
   * @param {string} [params.error] - Error string if the grant failed.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.gcp.fixComplete({ token });
   */
  fixComplete({ token, error }) {
    return this.sdk._fetch('/providers/gcp/setup/fix/complete', 'POST', { body: { token, error } });
  }

  /**
   * Poll a GCP fix session's status (admin).
   *
   * @param {object} params
   * @param {string} params.token - The fix-session token.
   * @returns {Promise<{ status: string, error?: string }>}
   * @example
   * const s = await sdk.providers.gcp.fixStatus({ token });
   */
  fixStatus({ token }) {
    return this.sdk._fetch('/providers/gcp/setup/fix/status', 'GET', { query: { token } });
  }

  // ── Workload Identity ───────────────────────────────────────

  /**
   * Workload-Identity binding helper for a GKE cluster (action-dispatched). The
   * full body is passed through; `action` selects the operation:
   *   - `'search'`         { container, clusterName, gcpRoles?, k8sNamespace?, k8sSaName?, branch? } → { serviceAccounts, project }
   *   - `'create'`         { container, clusterName, saId, displayName?, gcpRoles?, k8sNamespace?, k8sSaName? } → { email, bindingUpdated }
   *   - `'ensure-binding'` { container, clusterName, saEmail, k8sNamespace, k8sSaName } → { updated }
   *
   * @param {object} body - Must include `action`, `container`, `clusterName`; remaining fields depend on `action`. `branch` defaults to 'main'.
   * @returns {Promise<object>} Shape depends on `action`.
   * @example
   * const { serviceAccounts } = await sdk.providers.gcp.workloadIdentity({ action: 'search', container: 'app1', clusterName: 'z-03' });
   */
  workloadIdentity(body) { return this.sdk._fetch('/gcp/workload-identity', 'POST', { body }); }
}
