// @ts-nocheck
/**
 * GithubService — stored GitHub connections (`sdk.settings.github`).
 *
 * A connection is a saved GitHub token whose scopes + reachable repos Zeus has
 * discovered. Raw token values are never returned. Lifecycle: test (probe a
 * token without saving) → create → reprobe / rename / list repos → delete.
 *
 * Routes: /api/settings/github/connections/**
 */
export class GithubService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List all stored GitHub connections (sanitized — no raw tokens).
   *
   * @returns {Promise<{ connections: Array<object> }>}
   * @route GET /api/settings/github/connections
   * @example
   * const { connections } = await sdk.settings.github.list();
   */
  list() { return this.sdk._fetch('/settings/github/connections', 'GET'); }

  /**
   * Verify a token WITHOUT storing it, returning what it can reach.
   *
   * @param {object} params
   * @param {string} params.token - GitHub token to probe.
   * @returns {Promise<{ result: { user: object, scopes: string[], repoCounts: object, suggestedName: string } }>}
   * @route POST /api/settings/github/connections  (action: 'test')
   * @example
   * const { result } = await sdk.settings.github.test({ token: 'ghp_...' });
   */
  test({ token }) {
    return this.sdk._fetch('/settings/github/connections', 'POST', { body: { action: 'test', token } });
  }

  /**
   * Verify a token, discover its scopes, and store it as a connection.
   *
   * @param {object} params
   * @param {string} params.token
   * @param {string} [params.name] - Optional display name.
   * @returns {Promise<{ connection: object }>} Sanitized connection (user + scopes).
   * @route POST /api/settings/github/connections
   * @example
   * const { connection } = await sdk.settings.github.create({ token: 'ghp_...', name: 'CI' });
   */
  create({ token, name }) {
    return this.sdk._fetch('/settings/github/connections', 'POST', { body: { token, name } });
  }

  /**
   * Re-discover a connection's scopes + repo counts.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ connection: object }>}
   * @route PUT /api/settings/github/connections/[id]  (action: 'reprobe')
   * @example
   * await sdk.settings.github.reprobe({ id: 'conn-1' });
   */
  reprobe({ id }) {
    return this.sdk._fetch(`/settings/github/connections/${encodeURIComponent(id)}`, 'PUT', { body: { action: 'reprobe' } });
  }

  /**
   * Rename a connection.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @returns {Promise<{ connection: object }>}
   * @route PUT /api/settings/github/connections/[id]  (action: 'rename')
   * @example
   * await sdk.settings.github.rename({ id: 'conn-1', name: 'Prod CI' });
   */
  rename({ id, name }) {
    return this.sdk._fetch(`/settings/github/connections/${encodeURIComponent(id)}`, 'PUT', { body: { action: 'rename', name } });
  }

  /**
   * Re-test a stored connection's token (live probe).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<object>} The raw test result (user/scopes/repoCounts).
   * @route PUT /api/settings/github/connections/[id]  (action: 'test')
   * @example
   * const result = await sdk.settings.github.testById({ id: 'conn-1' });
   */
  testById({ id }) {
    return this.sdk._fetch(`/settings/github/connections/${encodeURIComponent(id)}`, 'PUT', { body: { action: 'test' } });
  }

  /**
   * List the repositories reachable through a stored connection.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ repos: Array<object> }>}
   * @route GET /api/settings/github/connections/[id]?action=repos
   * @example
   * const { repos } = await sdk.settings.github.listRepos({ id: 'conn-1' });
   */
  listRepos({ id }) {
    return this.sdk._fetch(`/settings/github/connections/${encodeURIComponent(id)}`, 'GET', { query: { action: 'repos' } });
  }

  /**
   * Delete a connection.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/github/connections/[id]
   * @example
   * await sdk.settings.github.delete({ id: 'conn-1' });
   */
  delete({ id }) {
    return this.sdk._fetch(`/settings/github/connections/${encodeURIComponent(id)}`, 'DELETE');
  }
}
