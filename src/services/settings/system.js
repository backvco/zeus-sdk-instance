// @ts-nocheck
/**
 * SystemSettingsService — instance-wide system settings (`sdk.settings.system`).
 *
 * A small key/value settings document for the whole Zeus instance. Distinct from
 * the read-only utility endpoints on `sdk.system`.
 *
 * Routes: /api/settings/system
 */
export class SystemSettingsService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Get the current system settings document.
   *
   * @returns {Promise<{ settings: object }>}
   * @route GET /api/settings/system
   * @example
   * const { settings } = await sdk.settings.system.get();
   */
  get() { return this.sdk._fetch('/settings/system', 'GET'); }

  /**
   * Update system settings (partial merge; fields forwarded as the body).
   *
   * @param {object} patch - Settings fields to update.
   * @returns {Promise<{ settings: object }>}
   * @route PUT /api/settings/system
   * @example
   * await sdk.settings.system.update({ defaultRegion: 'us-east-2' });
   */
  update(patch) { return this.sdk._fetch('/settings/system', 'PUT', { body: patch }); }
}
