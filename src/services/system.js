// @ts-nocheck
/**
 * SystemService — instance-wide utility endpoints.
 *
 * Accessed as `sdk.system`.
 *
 * Small, mostly read-only helpers that don't belong to a single resource:
 * the caller's egress/public IP, available CLI tooling (helm), instance pricing
 * lookups, security-group presets, geocoding, and server-side filesystem
 * browsing (used by path-picker UIs).
 */
export class SystemService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Get this Zeus instance's outbound (egress) public IP — the address AWS/GCP
   * see when Zeus calls their APIs. Useful for allow-listing.
   *
   * @returns {Promise<{ ip: string, cached?: boolean }>}
   * @example
   * const { ip } = await sdk.system.egressIp(); // → { ip: '203.0.113.7' }
   */
  egressIp() { return this.sdk._fetch('/system/egress-ip', 'GET'); }

  /**
   * Get the public IP of the *caller* (your browser/client), as seen by Zeus.
   *
   * @returns {Promise<{ ip: string }>}
   * @example
   * const { ip } = await sdk.system.whoami();
   */
  whoami() { return this.sdk._fetch('/whoami', 'GET'); }

  /**
   * Report installed CLI tool status (currently helm — version + path).
   *
   * @returns {Promise<{ helm: { installed: boolean, version?: string, path?: string } }>}
   * @example
   * const { helm } = await sdk.system.tools();
   */
  tools() { return this.sdk._fetch('/system/tools', 'GET'); }

  /**
   * Install / refresh a managed CLI tool on the instance host.
   *
   * @param {object} params
   * @param {string} params.tool - Tool id, e.g. 'helm'.
   * @returns {Promise<{ ok: boolean, helm?: object }>}
   * @example
   * await sdk.system.installTool({ tool: 'helm' });
   */
  installTool({ tool }) { return this.sdk._fetch('/system/tools', 'POST', { body: { tool } }); }

  /**
   * Look up on-demand hourly prices for instance/machine types.
   *
   * @param {object} params
   * @param {string[]} params.types - Instance/machine type names (max 50), e.g. ['m5.large','e2-standard-4'].
   * @returns {Promise<{ prices: Record<string, number | null> }>}
   *   A null value means no price was found for that type.
   * @example
   * const { prices } = await sdk.system.pricing({ types: ['m5.large', 't3.medium'] });
   * // → { prices: { 'm5.large': 0.096, 't3.medium': 0.0416 } }
   */
  pricing({ types }) {
    return this.sdk._fetch('/pricing', 'GET', { query: { types: (types || []).join(',') } });
  }

  /**
   * Get the built-in security-group rule presets (common port bundles).
   *
   * @returns {Promise<{ presets: Record<string, object> }>}
   * @example
   * const { presets } = await sdk.system.sgPresets();
   */
  sgPresets() { return this.sdk._fetch('/sg-presets', 'GET'); }

  /**
   * Geocode a free-text place query (used by the connectivity geo map).
   *
   * @param {object} params
   * @param {string} params.query - Place name / address.
   * @returns {Promise<object>} Geocode result (lat/lng + display fields).
   * @example
   * const geo = await sdk.system.geocode({ query: 'Indianapolis, IN' });
   */
  geocode({ query }) { return this.sdk._fetch('/geo/geocode', 'POST', { body: { query } }); }

  /**
   * Browse the instance host filesystem (directory listing for path pickers).
   *
   * @param {object} [params]
   * @param {string} [params.path='/'] - Absolute directory path.
   * @returns {Promise<{ path: string, parent: string, entries: Array<{ name: string, path: string }> }>}
   * @example
   * const { entries } = await sdk.system.browseFilesystem({ path: '/docker' });
   */
  browseFilesystem({ path = '/' } = {}) {
    return this.sdk._fetch('/filesystem/browse', 'GET', { query: { path } });
  }

  /**
   * List dashboard workspaces (container summaries for the landing dashboard).
   *
   * @returns {Promise<{ workspaces: Array<object> }>}
   * @example
   * const { workspaces } = await sdk.system.dashboardWorkspaces();
   */
  dashboardWorkspaces() { return this.sdk._fetch('/dashboard/workspaces', 'GET'); }
}
