// @ts-nocheck
/**
 * ConnectionsNatsSuperclusterService — NATS supercluster connections.
 *
 * One object per supercluster: `members` (cluster names, >=1) + a shared
 * gateway username/password credential every member is configured with
 * identically. Replaces the earlier per-cluster nats-gateway connection
 * pair. Accessed as `sdk.connections.natsSupercluster`.
 */
export class ConnectionsNatsSuperclusterService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List NATS supercluster connection records (masked).
   *
   * @param {object} [params]
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ records: Array<object> }>}
   * @example
   * const { records } = await sdk.connections.natsSupercluster.list();
   */
  list({ container, branch } = {}) {
    return this.sdk._fetch('/connections/nats-supercluster', 'GET', { query: { container, branch } });
  }

  /**
   * Create or update a NATS supercluster connection.
   *
   * @param {object} params
   * @param {string} params.name - Supercluster name (required).
   * @param {Array<string>} [params.members] - Member cluster names (>=1).
   * @param {string} [params.username] - Shared gateway username.
   * @param {string} [params.password] - Shared gateway password.
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object }>} The saved (masked) record (HTTP 201).
   * @example
   * await sdk.connections.natsSupercluster.save({ name: 'nats-01', members: ['z-01', 'z-02'] });
   */
  save({ name, members, username, password, container, branch }) {
    return this.sdk._fetch('/connections/nats-supercluster', 'POST', {
      body: { name, members, username, password, container, branch },
    });
  }

  /**
   * Rotate a NATS supercluster's shared credential.
   *
   * @param {object} params
   * @param {string} params.name - Supercluster name (required).
   * @param {string} [params.container='app1'] - Container name (body).
   * @param {string} [params.branch='main'] - Config branch (body).
   * @returns {Promise<{ record: object, warning: string }>} The rotated (masked) record.
   * @example
   * await sdk.connections.natsSupercluster.rotate({ name: 'nats-01' });
   */
  rotate({ name, container, branch }) {
    return this.sdk._fetch('/connections/nats-supercluster', 'POST', {
      body: { name, action: 'rotate', container, branch },
    });
  }

  /**
   * Delete a NATS supercluster connection.
   *
   * @param {object} params
   * @param {string} params.name - Supercluster name (required).
   * @param {string} [params.container='app1'] - Container name (query).
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ deleted: * }>}
   * @example
   * await sdk.connections.natsSupercluster.delete({ name: 'nats-01' });
   */
  delete({ name, container, branch }) {
    return this.sdk._fetch('/connections/nats-supercluster', 'DELETE', {
      query: { container, branch, name },
    });
  }
}
