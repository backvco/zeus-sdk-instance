// @ts-nocheck
/**
 * AuthService — authentication config, sessions, and users (`sdk.settings.auth`).
 *
 * All endpoints are admin-only. Covers:
 *   - config:   Firebase web config + session TTL, plus a "revoke everything".
 *   - sessions: list active sessions (public sids only) and revoke them.
 *   - users:    list/create local users and run per-user actions
 *               (approve, set-role/status/password, profile, invite/reset
 *               links, revoke that user's sessions, delete).
 *
 * Routes: /api/settings/auth/{config, sessions, sessions/[sid], users, users/[id]}
 */
export class AuthService {
  constructor(sdk) { this.sdk = sdk; }

  // ── config ────────────────────────────────────────────────────────────────

  /**
   * Get the auth/Firebase config (Firebase web config + session TTL). Admin only.
   *
   * @returns {Promise<{ config: object }>}
   * @route GET /api/settings/auth/config
   * @example
   * const { config } = await sdk.settings.auth.getConfig();
   */
  getConfig() { return this.sdk._fetch('/settings/auth/config', 'GET'); }

  /**
   * Update the auth config. Admin only.
   *
   * @param {object} params
   * @param {object} [params.firebase] - Firebase web config object.
   * @param {number} [params.sessionTtlHours] - Session lifetime in hours.
   * @returns {Promise<{ config: object }>}
   * @route PUT /api/settings/auth/config
   * @example
   * await sdk.settings.auth.saveConfig({ sessionTtlHours: 168 });
   */
  saveConfig({ firebase, sessionTtlHours } = {}) {
    return this.sdk._fetch('/settings/auth/config', 'PUT', { body: { firebase, sessionTtlHours } });
  }

  /**
   * Sign out every session everywhere. Admin only.
   *
   * @returns {Promise<{ ok: true }>}
   * @route POST /api/settings/auth/config  (action: 'revoke-all')
   * @example
   * await sdk.settings.auth.revokeAllSessions();
   */
  revokeAllSessions() {
    return this.sdk._fetch('/settings/auth/config', 'POST', { body: { action: 'revoke-all' } });
  }

  // ── sessions ────────────────────────────────────────────────────────────────

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
   * @example
   * const { sessions, currentSid } = await sdk.settings.auth.listSessions();
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
   * @example
   * await sdk.settings.auth.revokeSession({ sid: 'sid-abc' });
   */
  revokeSession({ sid }) {
    return this.sdk._fetch(`/settings/auth/sessions/${encodeURIComponent(sid)}`, 'DELETE');
  }

  // ── users ────────────────────────────────────────────────────────────────

  /**
   * List all users (sanitized). Admin only.
   *
   * @returns {Promise<{ users: Array<object> }>}
   * @route GET /api/settings/auth/users
   * @example
   * const { users } = await sdk.settings.auth.listUsers();
   */
  listUsers() { return this.sdk._fetch('/settings/auth/users', 'GET'); }

  /**
   * Create a local user. With `sendInvite` (+ email) no password is set and an
   * invite link is emailed; otherwise `password` is required. Admin only.
   *
   * @param {object} params
   * @param {string} params.username
   * @param {string} [params.fullName]
   * @param {string} [params.email]
   * @param {string} [params.role] - e.g. 'admin' | 'user'.
   * @param {string} [params.password] - Required unless sendInvite.
   * @param {boolean} [params.sendInvite] - Email a set-password invite instead of setting a password.
   * @param {boolean} [params.includePassword] - In password mode, include the password in the welcome email (default true).
   * @returns {Promise<{ user: object, emailWarning: string|null }>}
   * @route POST /api/settings/auth/users
   * @example
   * await sdk.settings.auth.createUser({ username: 'cam', email: 'c@x.com', sendInvite: true });
   */
  createUser(params) { return this.sdk._fetch('/settings/auth/users', 'POST', { body: params }); }

  /**
   * Email a set-password invite link to a local user. Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'send-invite')
   * @example
   * await sdk.settings.auth.sendInvite({ id: 'usr-1' });
   */
  sendInvite({ id }) { return this._userAction(id, { action: 'send-invite' }); }

  /**
   * Email a password-reset link to a local user. Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'send-reset')
   * @example
   * await sdk.settings.auth.sendReset({ id: 'usr-1' });
   */
  sendReset({ id }) { return this._userAction(id, { action: 'send-reset' }); }

  /**
   * Revoke all live sessions for one user. Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'revoke-sessions')
   * @example
   * await sdk.settings.auth.revokeUserSessions({ id: 'usr-1' });
   */
  revokeUserSessions({ id }) { return this._userAction(id, { action: 'revoke-sessions' }); }

  /**
   * Approve a pending user. Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ user: object }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'approve')
   * @example
   * await sdk.settings.auth.approveUser({ id: 'usr-1' });
   */
  approveUser({ id }) { return this._userAction(id, { action: 'approve' }); }

  /**
   * Set a user's role. Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.role - e.g. 'admin' | 'user'.
   * @returns {Promise<{ user: object }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'set-role')
   * @example
   * await sdk.settings.auth.setRole({ id: 'usr-1', role: 'admin' });
   */
  setRole({ id, role }) { return this._userAction(id, { action: 'set-role', role }); }

  /**
   * Set a user's status (non-active statuses also revoke their sessions). Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.status - e.g. 'active' | 'suspended'.
   * @returns {Promise<{ user: object }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'set-status')
   * @example
   * await sdk.settings.auth.setStatus({ id: 'usr-1', status: 'suspended' });
   */
  setStatus({ id, status }) { return this._userAction(id, { action: 'set-status', status }); }

  /**
   * Admin-set a user's password. Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.password
   * @returns {Promise<{ user: object }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'set-password')
   * @example
   * await sdk.settings.auth.setPassword({ id: 'usr-1', password: 's3cret' });
   */
  setPassword({ id, password }) { return this._userAction(id, { action: 'set-password', password }); }

  /**
   * Update a user's profile (full name / email). Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} [params.fullName]
   * @param {string} [params.email]
   * @returns {Promise<{ user: object }>}
   * @route PUT /api/settings/auth/users/[id]  (action: 'update-profile')
   * @example
   * await sdk.settings.auth.updateProfile({ id: 'usr-1', fullName: 'Cam W' });
   */
  updateProfile({ id, fullName, email }) {
    return this._userAction(id, { action: 'update-profile', fullName, email });
  }

  /**
   * Delete a user (refuses to remove the last active admin). Admin only.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true }>}
   * @route DELETE /api/settings/auth/users/[id]
   * @example
   * await sdk.settings.auth.deleteUser({ id: 'usr-1' });
   */
  deleteUser({ id }) { return this.sdk._fetch(`/settings/auth/users/${encodeURIComponent(id)}`, 'DELETE'); }

  /**
   * Generic user mutation — dispatches any `{ action, ... }` to the user-[id]
   * PUT endpoint. Convenience for UIs that drive several actions through one
   * handler; the named methods above (approveUser, setRole, …) are preferred
   * when the action is known.
   *
   * @param {object} params
   * @param {string} params.id     - User id.
   * @param {string} params.action - Action name (approve, set-role, set-status, …).
   * @param {object} [params....]  - Action-specific fields.
   * @returns {Promise<{ user: object } | { ok: true }>}
   * @route PUT /api/settings/auth/users/[id]
   * @example
   * await sdk.settings.auth.updateUser({ id: 'usr-1', action: 'set-role', role: 'admin' });
   */
  updateUser({ id, ...body }) { return this._userAction(id, body); }

  /** @private — shared PUT for the user-[id] action endpoint. */
  _userAction(id, body) {
    return this.sdk._fetch(`/settings/auth/users/${encodeURIComponent(id)}`, 'PUT', { body });
  }
}
