// @ts-nocheck
/**
 * NpmTokensService — stored npm registry tokens (`sdk.settings.npmTokens`).
 *
 * Tokens used by builds to authenticate to npm (or a private registry). Raw
 * token values are never returned (records are sanitized). Lifecycle: test
 * (probe without saving) → create → update / probe-stored → delete.
 *
 * Routes: /api/settings/npm-tokens/**
 */
export class NpmTokensService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List all npm tokens (sanitized — no raw token values).
   *
   * @returns {Promise<{ tokens: Array<object> }>}
   * @route GET /api/settings/npm-tokens
   * @example
   * const { tokens } = await sdk.settings.npmTokens.list();
   */
  list() { return this.sdk._fetch('/settings/npm-tokens', 'GET'); }

  /**
   * Probe a token against a registry WITHOUT saving it.
   *
   * @param {object} params
   * @param {string} params.token
   * @param {string} [params.registryUrl]
   * @returns {Promise<object>} Probe result (reachability/identity).
   * @route POST /api/settings/npm-tokens  (action: 'test')
   * @example
   * const result = await sdk.settings.npmTokens.test({ token: 'npm_...' });
   */
  test({ token, registryUrl }) {
    return this.sdk._fetch('/settings/npm-tokens', 'POST', { body: { action: 'test', token, registryUrl } });
  }

  /**
   * Create a new npm token record.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.token
   * @param {string} [params.expiresAt] - ISO timestamp.
   * @param {string} [params.registryUrl]
   * @param {string} [params.scope] - npm scope routed to this registry (e.g. '@tiptap-pro').
   * @returns {Promise<{ npmToken: object }>} Sanitized record.
   * @route POST /api/settings/npm-tokens
   * @example
   * const { npmToken } = await sdk.settings.npmTokens.create({ name: 'ci', token: 'npm_...' });
   */
  create({ name, token, expiresAt, registryUrl, scope }) {
    return this.sdk._fetch('/settings/npm-tokens', 'POST', { body: { name, token, expiresAt, registryUrl, scope } });
  }

  /**
   * Get one npm token (sanitized).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ npmToken: object }>}
   * @route GET /api/settings/npm-tokens/[id]
   * @example
   * const { npmToken } = await sdk.settings.npmTokens.get({ id: 'tok-1' });
   */
  get({ id }) { return this.sdk._fetch(`/settings/npm-tokens/${encodeURIComponent(id)}`, 'GET'); }

  /**
   * Update an npm token's fields.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} [params.name]
   * @param {string} [params.token]
   * @param {string} [params.expiresAt]
   * @param {string} [params.registryUrl]
   * @param {string} [params.scope] - npm scope routed to this registry (e.g. '@tiptap-pro').
   * @returns {Promise<{ npmToken: object }>} Updated sanitized record.
   * @route PUT /api/settings/npm-tokens/[id]
   * @example
   * await sdk.settings.npmTokens.update({ id: 'tok-1', name: 'renamed' });
   */
  update({ id, name, token, expiresAt, registryUrl, scope }) {
    return this.sdk._fetch(`/settings/npm-tokens/${encodeURIComponent(id)}`, 'PUT', { body: { name, token, expiresAt, registryUrl, scope } });
  }

  /**
   * Probe the stored token against its configured registry.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<object>} Probe result.
   * @route POST /api/settings/npm-tokens/[id]  (action: 'test')
   * @example
   * const result = await sdk.settings.npmTokens.testStored({ id: 'tok-1' });
   */
  testStored({ id }) {
    return this.sdk._fetch(`/settings/npm-tokens/${encodeURIComponent(id)}`, 'POST', { body: { action: 'test' } });
  }

  /**
   * Delete an npm token.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/npm-tokens/[id]
   * @example
   * await sdk.settings.npmTokens.delete({ id: 'tok-1' });
   */
  delete({ id }) { return this.sdk._fetch(`/settings/npm-tokens/${encodeURIComponent(id)}`, 'DELETE'); }
}
