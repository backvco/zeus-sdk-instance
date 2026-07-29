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

  /**
   * Get this instance's running Zeus version vs. the latest known to the
   * console (from the last heartbeat) — used to surface an "update available"
   * indicator in the sidebar.
   *
   * @returns {Promise<{ current: string, latest: string | null, updateAvailable: boolean }>}
   * @example
   * const { current, latest, updateAvailable } = await sdk.system.version();
   */
  version() { return this.sdk._fetch('/system/version', 'GET'); }

  /**
   * Kick off an in-app self-upgrade via the console (host agent pulls the
   * latest image and recreates this container — migrations auto-run on
   * boot). Enters a server-owned "pending" countdown first — every logged-in
   * user of this instance sees the same countdown (broadcast on the
   * `system:upgrade` SSE channel, see {@link upgradePendingStatus}) and any
   * of them can abort it via {@link abortUpgrade}. This process may die
   * mid-upgrade; poll {@link upgradeStatus} and eventually {@link version}
   * rather than waiting on this call's response to mean "done".
   *
   * @returns {Promise<{ started: boolean, upToDate?: boolean, pending?: boolean, deadline?: string|null, initiator?: string, countdownSeconds?: number }>}
   * @example
   * const { started, pending, deadline } = await sdk.system.upgrade();
   */
  upgrade() { return this.sdk._fetch('/system/upgrade', 'POST'); }

  /**
   * Get the current instance-wide pending-upgrade countdown state (in-memory,
   * this process). Used to catch up late-joining tabs/users who weren't
   * connected to the `system:upgrade` SSE channel when the countdown began.
   *
   * @returns {Promise<{ phase: 'pending'|'aborted'|'started'|null, deadline: string|null, initiator: string|null, abortedBy: string|null, countdownSeconds: number|null }>}
   * @example
   * const { phase, deadline, initiator } = await sdk.system.upgradePendingStatus();
   */
  upgradePendingStatus() { return this.sdk._fetch('/system/upgrade/pending', 'GET'); }

  /**
   * Abort a pending (not-yet-started) self-upgrade countdown. Any
   * authenticated user of this instance may call this — deliberately not
   * admin-gated, since an in-progress countdown interrupts everyone's work.
   * A 409 means the upgrade already left the pending phase (already running,
   * or already aborted) — safe to ignore and let SSE/poll settle.
   *
   * @returns {Promise<{ aborted: boolean }>}
   * @example
   * await sdk.system.abortUpgrade();
   */
  abortUpgrade() { return this.sdk._fetch('/system/upgrade/abort', 'POST'); }

  /**
   * Poll the console-reported status of the current/last self-upgrade run.
   *
   * @returns {Promise<{
   *   zeusVersion: string,
   *   currentImage: string,
   *   latestVersion: string,
   *   latestImage: string,
   *   upgradeStatus: 'running' | 'failed' | 'succeeded' | null,
   *   upgradeStep: string | null,
   *   upgradeError: string | null,
   *   lastUpgradeAt: string | null,
   * }>}
   * @example
   * const { upgradeStatus, upgradeStep } = await sdk.system.upgradeStatus();
   */
  upgradeStatus() { return this.sdk._fetch('/system/upgrade/status', 'GET'); }

  /**
   * Get the CALLING user's dismissed console-notice ids (companion read to
   * the write-only dismiss action below). Self-service — always scoped to
   * the session's own user, never another user's.
   *
   * @returns {Promise<{ dismissed: string[] }>}
   * @example
   * const { dismissed } = await sdk.system.dismissedNotices();
   */
  dismissedNotices() { return this.sdk._fetch('/console/dismissals', 'GET'); }

  /**
   * Dismiss a console notice for the CALLING user.
   *
   * @param {object} params
   * @param {string} params.noticeId - Notice id to dismiss.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.system.dismissNotice({ noticeId: 'plan-limit-vcpu' });
   */
  dismissNotice({ noticeId }) {
    return this.sdk._fetch('/console/dismiss', 'POST', { body: { noticeId } });
  }
}
