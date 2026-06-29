// @ts-nocheck
/**
 * ServiceTokensService — Zeus API service tokens (`sdk.settings.serviceTokens`).
 *
 * These are the `zeus_...` bearer tokens that authenticate SDK/API callers (the
 * same kind this SDK uses). The collection list returns masked values; the full
 * plaintext is returned ONCE on create and is re-viewable via `reveal()`.
 * Lifecycle: create → list → reveal / rename → delete.
 *
 * Routes: /api/settings/service-tokens/**
 */
export class ServiceTokensService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List service tokens (masked — full values not returned here).
   *
   * @returns {Promise<{ tokens: Array<{ id: string, name: string, tokenMasked: string, createdAt: string, lastUsedAt: string|null }> }>}
   * @route GET /api/settings/service-tokens
   * @example
   * const { tokens } = await sdk.settings.serviceTokens.list();
   */
  list() { return this.sdk._fetch('/settings/service-tokens', 'GET'); }

  /**
   * Create an auto-generated service token. The plaintext is returned once.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string[]} [params.policies]  e.g. ['mcp:read'] or ['mcp:read','mcp:write']
   * @returns {Promise<{ token: { id: string, name: string, createdAt: string, plaintext: string } }>}
   * @route POST /api/settings/service-tokens
   * @example
   * const { token } = await sdk.settings.serviceTokens.create({ name: 'Claude Desktop', policies: ['mcp:read'] });
   * // token.plaintext → store it now; it won't be shown again in the list.
   */
  create({ name, policies }) {
    return this.sdk._fetch('/settings/service-tokens', 'POST', { body: { name, policies } });
  }

  /**
   * Reveal a token's full plaintext value.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ token: string }>}
   * @route GET /api/settings/service-tokens/[id]
   * @example
   * const { token } = await sdk.settings.serviceTokens.reveal({ id: 'tok-1' });
   */
  reveal({ id }) { return this.sdk._fetch(`/settings/service-tokens/${encodeURIComponent(id)}`, 'GET'); }

  /**
   * Rename a service token (value unchanged).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @returns {Promise<{ token: object }>}
   * @route PUT /api/settings/service-tokens/[id]
   * @example
   * await sdk.settings.serviceTokens.rename({ id: 'tok-1', name: 'renamed' });
   */
  rename({ id, name }) {
    return this.sdk._fetch(`/settings/service-tokens/${encodeURIComponent(id)}`, 'PUT', { body: { name } });
  }

  /**
   * Revoke (delete) a service token.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/service-tokens/[id]
   * @example
   * await sdk.settings.serviceTokens.delete({ id: 'tok-1' });
   */
  delete({ id }) { return this.sdk._fetch(`/settings/service-tokens/${encodeURIComponent(id)}`, 'DELETE'); }
}
