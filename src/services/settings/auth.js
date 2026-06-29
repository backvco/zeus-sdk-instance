// @ts-nocheck
/**
 * AuthService — session management (`sdk.settings.auth`). Admin only.
 *
 * Auth is handled exclusively via SSO from the Zeus Console — there are no
 * local users or auth config managed here. These endpoints let admins inspect
 * and revoke live sessions.
 *
 * Routes: /api/settings/auth/sessions, /api/settings/auth/sessions/[sid]
 */
export class AuthService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List active sessions. Admin only. `currentSid` flags the caller's own
   * session; raw cookie ids are never exposed.
   *
   * @param {object} [params]
   * @param {string} [params.userId] - Filter to one user's sessions.
   * @returns {Promise<{
   *   sessions: Array<{ sid: string, user: object, ip: string, browser: string, os: string, createdAt: string, lastSeen: string }>,
   *   currentSid: string|null,
   * }>}
   * @route GET /api/settings/auth/sessions
   */
  listSessions({ userId } = {}) {
    return this.sdk._fetch('/settings/auth/sessions', 'GET', { query: { userId } });
  }

  /**
   * Revoke one session by its public sid. Admin only.
   *
   * @param {object} params
   * @param {string} params.sid
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/auth/sessions/[sid]
   */
  revokeSession({ sid }) {
    return this.sdk._fetch(`/settings/auth/sessions/${encodeURIComponent(sid)}`, 'DELETE');
  }
}
