// @ts-nocheck
/**
 * ConnectionsService — third-party connection providers + connection categories,
 * plus the three top-level operator connection types (edge-tenant, NATS gateway,
 * NetBird overlay).
 *
 * Accessed as `sdk.connections`.
 *
 * ─── Two layers ────────────────────────────────────────────────────────────────
 *
 * 1. **Container-scoped providers** (`/v2configs/<container>/connections`): a
 *    "provider" is a named credential bundle (e.g. a database, an SMTP host) that
 *    holds one or more "objects", each carrying encrypted "fields". Services link
 *    to a provider and pick which object they use per environment. Providers are
 *    grouped under user-defined **connection categories**.
 *    Typical lifecycle: `list` → `create`/`save` → `linkService` → `swapObject`.
 *
 * 2. **Top-level operator connections** (`/connections/...`): cross-cutting mesh
 *    plumbing managed per Zeus instance (not per resource). These take `container`
 *    and `branch` via query (GET/DELETE) or body (POST), defaulting to `app1`/`main`
 *    server-side. Secrets are stored encrypted and masked in list responses.
 *
 * Container-scoped methods take `{ container, ... }` (and optional `branch`,
 * defaulting to 'main'); top-level methods take `{ container?, branch?, ... }`.
 */
export class ConnectionsService {
  constructor(sdk) { this.sdk = sdk; }

  // ─── Container-scoped providers ────────────────────────────────────────────

  /**
   * List all connection providers in a container, each annotated with how many
   * services link to it.
   *
   * @param {object} params
   * @param {string} params.container - Container name (e.g. 'app1').
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ providers: Array<{ name: string, category?: string, objects?: Array<object>, linkedCount: number }> }>}
   * @example
   * const { providers } = await sdk.connections.list({ container: 'app1' });
   * // → { providers: [{ name: 'main-db', category: 'Databases', linkedCount: 3 }] }
   */
  list({ container, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/connections`, 'GET', {
      query: { branch },
    });
  }

  /**
   * Create a connection provider (or overwrite one with the same name).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name - Provider name (validated; required).
   * @param {object} [params.data] - Provider payload (e.g. `{ objects: [], category }`). Defaults to `{ objects: [] }`.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ provider: object }>} The saved (masked) provider record.
   * @example
   * await sdk.connections.create({ container: 'app1', name: 'main-db', data: { category: 'Databases', objects: [] } });
   */
  create({ container, name, data, branch }) {
    return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/connections`, 'POST', {
      body: { name, data, branch },
    });
  }

  /**
   * Get a single connection provider by name (masked — secret field values are not
   * returned; use {@link reveal} for a single plaintext value).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ provider: object }>}
   * @example
   * const { provider } = await sdk.connections.get({ container: 'app1', provider: 'main-db' });
   */
  get({ container, provider, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}`,
      'GET',
      { query: { branch } },
    );
  }

  /**
   * Replace a connection provider's data (objects + fields). Field values you pass
   * are encrypted at rest.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {object} params.data - Full provider payload to persist.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ provider: object }>} The saved (masked) provider record.
   * @example
   * await sdk.connections.save({ container: 'app1', provider: 'main-db', data: { objects: [{ name: 'primary', fields: { host: 'db1' } }] } });
   */
  save({ container, provider, data, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}`,
      'PUT',
      { body: { data, branch } },
    );
  }

  /**
   * Delete a connection provider. Returns HTTP 409 (throws) if any service still
   * links to it — unlink those services first.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.connections.delete({ container: 'app1', provider: 'main-db' });
   */
  delete({ container, provider, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}`,
      'DELETE',
      { query: { branch } },
    );
  }

  /**
   * Reveal one saved field's plaintext value (the ObjectEditor "eye" toggle).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} params.object - Object name within the provider.
   * @param {string} params.field - Field name within the object.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ value: * }>} The decrypted field value.
   * @example
   * const { value } = await sdk.connections.reveal({ container: 'app1', provider: 'main-db', object: 'primary', field: 'password' });
   */
  reveal({ container, provider, object, field, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}/reveal`,
      'POST',
      { body: { object, field, branch } },
    );
  }

  /**
   * Clone one object inside a provider into a new object with a fresh name.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} params.sourceName - Object to clone (required).
   * @param {string} [params.newName] - New object name; auto-picked when omitted.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ provider: object, clone: { fields: object } }>}
   *   `provider` is the masked record; `clone.fields` carries plaintext for the new object.
   * @example
   * const { clone } = await sdk.connections.cloneObject({ container: 'app1', provider: 'main-db', sourceName: 'primary' });
   */
  cloneObject({ container, provider, sourceName, newName, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}/clone-object`,
      'POST',
      { body: { sourceName, newName, branch } },
    );
  }

  /**
   * List services linked to a provider (with their per-env object selections).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ services: Array<object> }>}
   * @example
   * const { services } = await sdk.connections.linkedServices({ container: 'app1', provider: 'main-db' });
   */
  linkedServices({ container, provider, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}/linked-services`,
      'GET',
      { query: { branch } },
    );
  }

  /**
   * Link a service to a provider (adds a connection entry to the service).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} params.serviceName - Service to link (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} The link result.
   * @example
   * await sdk.connections.linkService({ container: 'app1', provider: 'main-db', serviceName: 'api' });
   */
  linkService({ container, provider, serviceName, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}/linked-services`,
      'POST',
      { body: { action: 'link', serviceName, branch } },
    );
  }

  /**
   * Unlink a service from a provider (removes the service's entry for it).
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} params.serviceName - Service to unlink (required).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ removed: boolean }>}
   * @example
   * await sdk.connections.unlinkService({ container: 'app1', provider: 'main-db', serviceName: 'api' });
   */
  unlinkService({ container, provider, serviceName, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}/linked-services`,
      'POST',
      { body: { action: 'unlink', serviceName, branch } },
    );
  }

  /**
   * Swap which object a service uses for a provider — per environment, or the
   * default (`envName` null). Pass `objectName: null` to clear the selection.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.provider - Provider name.
   * @param {string} params.serviceName - Service to update (required).
   * @param {string|null} [params.envName=null] - Environment name; null sets the default.
   * @param {string|null} [params.objectName=null] - Object to use; null clears it.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ entry: object }>} The updated connection entry.
   * @example
   * await sdk.connections.swapObject({ container: 'app1', provider: 'main-db', serviceName: 'api', envName: 'prod', objectName: 'primary' });
   */
  swapObject({ container, provider, serviceName, envName = null, objectName = null, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connections/${encodeURIComponent(provider)}/linked-services`,
      'POST',
      { body: { serviceName, envName, objectName, branch } },
    );
  }

  // ─── Connection categories ──────────────────────────────────────────────────

  /**
   * List connection categories in a container.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ categories: Array<object> }>}
   * @example
   * const { categories } = await sdk.connections.listCategories({ container: 'app1' });
   */
  listCategories({ container, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connection-categories`,
      'GET',
      { query: { branch } },
    );
  }

  /**
   * Create a connection category.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name - Category name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ category: object }>}
   * @example
   * await sdk.connections.createCategory({ container: 'app1', name: 'Databases' });
   */
  createCategory({ container, name, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connection-categories`,
      'POST',
      { body: { name, branch } },
    );
  }

  /**
   * Rename a connection category.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name - Current category name.
   * @param {string} params.newName - New category name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ category: object }>}
   * @example
   * await sdk.connections.renameCategory({ container: 'app1', name: 'Databases', newName: 'Data Stores' });
   */
  renameCategory({ container, name, newName, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connection-categories/${encodeURIComponent(name)}`,
      'PUT',
      { body: { newName, branch } },
    );
  }

  /**
   * Delete a connection category.
   *
   * @param {object} params
   * @param {string} params.container - Container name.
   * @param {string} params.name - Category name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.connections.deleteCategory({ container: 'app1', name: 'Data Stores' });
   */
  deleteCategory({ container, name, branch }) {
    return this.sdk._fetch(
      `/v2configs/${encodeURIComponent(container)}/connection-categories/${encodeURIComponent(name)}`,
      'DELETE',
      { query: { branch } },
    );
  }

  // ─── Top-level: edge-tenant ───────────────────────────────────────────────

  /**
   * List edge-tenant connection records (masked).
   *
   * @param {object} [params]
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ records: Array<object> }>}
   * @example
   * const { records } = await sdk.connections.listEdgeTenants();
   */
  listEdgeTenants({ container, branch } = {}) {
    return this.sdk._fetch('/connections/edge-tenant', 'GET', { query: { container, branch } });
  }

  /**
   * Download a downloadable edge-tenant bundle (plaintext) for one tenant.
   *
   * @param {object} params
   * @param {string} params.name - Tenant name.
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ bundle: object }>}
   * @example
   * const { bundle } = await sdk.connections.getEdgeTenantBundle({ name: 'acme' });
   */
  getEdgeTenantBundle({ name, container, branch }) {
    return this.sdk._fetch('/connections/edge-tenant', 'GET', {
      query: { container, branch, name, bundle: '1' },
    });
  }

  /**
   * Create or update an edge-tenant connection.
   *
   * @param {object} params
   * @param {string} params.name - Tenant name (required).
   * @param {string} [params.customer] - Customer identifier.
   * @param {object} [params.acl] - Access-control list.
   * @param {Array<object>} [params.edges] - Edge definitions.
   * @param {object} [params.rateLimits] - Rate-limit config.
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object }>} The saved (masked) record (HTTP 201).
   * @example
   * await sdk.connections.saveEdgeTenant({ name: 'acme', customer: 'acme-co', acl: {} });
   */
  saveEdgeTenant({ name, customer, acl, edges, rateLimits, container, branch }) {
    return this.sdk._fetch('/connections/edge-tenant', 'POST', {
      body: { name, customer, acl, edges, rateLimits, container, branch },
    });
  }

  /**
   * Rotate an edge-tenant's account seed.
   *
   * @param {object} params
   * @param {string} params.name - Tenant name (required).
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object }>} The rotated (masked) record.
   * @example
   * await sdk.connections.rotateEdgeTenant({ name: 'acme' });
   */
  rotateEdgeTenant({ name, container, branch }) {
    return this.sdk._fetch('/connections/edge-tenant', 'POST', {
      body: { name, action: 'rotate', container, branch },
    });
  }

  /**
   * Delete an edge-tenant connection.
   *
   * @param {object} params
   * @param {string} params.name - Tenant name (required).
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ deleted: * }>}
   * @example
   * await sdk.connections.deleteEdgeTenant({ name: 'acme' });
   */
  deleteEdgeTenant({ name, container, branch }) {
    return this.sdk._fetch('/connections/edge-tenant', 'DELETE', {
      query: { container, branch, name },
    });
  }

  // ─── Top-level: nats-gateway ──────────────────────────────────────────────

  /**
   * List NATS gateway connection records (masked).
   *
   * @param {object} [params]
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ records: Array<object> }>}
   * @example
   * const { records } = await sdk.connections.listNatsGateways();
   */
  listNatsGateways({ container, branch } = {}) {
    return this.sdk._fetch('/connections/nats-gateway', 'GET', { query: { container, branch } });
  }

  /**
   * Create or update a NATS gateway connection.
   *
   * @param {object} params
   * @param {string} params.name - Gateway name (required).
   * @param {string} [params.advertise] - Advertised address.
   * @param {Array<object>} [params.peers] - Peer gateway definitions.
   * @param {string} [params.operatorJwt] - Operator JWT.
   * @param {string} [params.accountJwt] - Account JWT.
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object }>} The saved (masked) record (HTTP 201).
   * @example
   * await sdk.connections.saveNatsGateway({ name: 'mesh-gw', advertise: 'nats.example.com:7222' });
   */
  saveNatsGateway({ name, advertise, peers, operatorJwt, accountJwt, container, branch }) {
    return this.sdk._fetch('/connections/nats-gateway', 'POST', {
      body: { name, advertise, peers, operatorJwt, accountJwt, container, branch },
    });
  }

  /**
   * Rotate a NATS gateway's user seed.
   *
   * @param {object} params
   * @param {string} params.name - Gateway name (required).
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object }>} The rotated (masked) record.
   * @example
   * await sdk.connections.rotateNatsGateway({ name: 'mesh-gw' });
   */
  rotateNatsGateway({ name, container, branch }) {
    return this.sdk._fetch('/connections/nats-gateway', 'POST', {
      body: { name, action: 'rotate', container, branch },
    });
  }

  /**
   * Delete a NATS gateway connection.
   *
   * @param {object} params
   * @param {string} params.name - Gateway name (required).
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ deleted: * }>}
   * @example
   * await sdk.connections.deleteNatsGateway({ name: 'mesh-gw' });
   */
  deleteNatsGateway({ name, container, branch }) {
    return this.sdk._fetch('/connections/nats-gateway', 'DELETE', {
      query: { container, branch, name },
    });
  }

  // ─── Top-level: netbird-overlay ───────────────────────────────────────────

  /**
   * List NetBird overlay connection records (masked).
   *
   * @param {object} [params]
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ records: Array<object> }>}
   * @example
   * const { records } = await sdk.connections.listNetbirdOverlays();
   */
  listNetbirdOverlays({ container, branch } = {}) {
    return this.sdk._fetch('/connections/netbird-overlay', 'GET', { query: { container, branch } });
  }

  /**
   * Create or update a NetBird overlay connection (mgmt URL + API token).
   *
   * @param {object} params
   * @param {string} params.name - Overlay name (required).
   * @param {string} [params.mgmtUrl] - NetBird Management API URL.
   * @param {string} [params.apiToken] - NetBird API token (stored encrypted).
   * @param {string} [params.groupPrefix] - Group-name prefix.
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object }>} The saved (masked) record (HTTP 201).
   * @example
   * await sdk.connections.saveNetbirdOverlay({ name: 'mesh', mgmtUrl: 'https://netbird.example.com', apiToken: '...' });
   */
  saveNetbirdOverlay({ name, mgmtUrl, apiToken, groupPrefix, container, branch }) {
    return this.sdk._fetch('/connections/netbird-overlay', 'POST', {
      body: { name, mgmtUrl, apiToken, groupPrefix, container, branch },
    });
  }

  /**
   * Delete a NetBird overlay connection.
   *
   * @param {object} params
   * @param {string} params.name - Overlay name (required).
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ deleted: * }>}
   * @example
   * await sdk.connections.deleteNetbirdOverlay({ name: 'mesh' });
   */
  deleteNetbirdOverlay({ name, container, branch }) {
    return this.sdk._fetch('/connections/netbird-overlay', 'DELETE', {
      query: { container, branch, name },
    });
  }
}
