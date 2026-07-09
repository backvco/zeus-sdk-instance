// @ts-nocheck
/**
 * AuthService — authentication, session, and account bootstrap.
 *
 * Accessed as `sdk.auth`.
 *
 * Zeus uses server-side sessions backed by an `authToken` cookie. The flows here
 * cover the full local + Firebase lifecycle:
 *
 *   - First run:  setup() mints the initial admin (only while no users exist).
 *   - Sign in:    login() (local username/password) or firebase() (Google/Azure).
 *   - Session:    me() reads the current principal; logout() revokes it.
 *   - Recovery:   forgot() emails a reset link; reset() sets a password from an
 *                 invite/reset token (also used after a forced password change).
 *   - Email:      sendVerification() asks the CONSOLE to email its
 *                 verification code/link (verification lives at the console;
 *                 alert email only flows to console-verified addresses).
 *   - Pickers:    directory() returns a minimal name+email list of users.
 *
 * In the browser the session cookie is sent automatically (`credentials:'include'`);
 * in Node these methods are typically only useful with a service token, since
 * cookie-based login isn't persisted across SDK calls.
 */
export class AuthService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Local username/password login. On success the server sets the session
   * cookie and returns the sanitized user. If the account has a forced password
   * change pending (admin-set / temporary password), no session is issued —
   * instead a single-use `reset` token is returned for use with {@link reset}.
   *
   * @param {object} params
   * @param {string} params.username - Username.
   * @param {string} params.password - Password.
   * @returns {Promise<{ ok: true, user: object } | { mustChangePassword: true, token: string }>}
   * @example
   * const res = await sdk.auth.login({ username: 'cameron', password: 'hunter2' });
   * if (res.mustChangePassword) await sdk.auth.reset({ token: res.token, password: 'new-pass-1234' });
   * // → { ok: true, user: { id, username, fullName, email, role, ... } }
   */
  login({ username, password }) {
    return this.sdk._fetch('/auth/login', 'POST', { body: { username, password } });
  }

  /**
   * Get the current authenticated principal (from the session). Returns
   * `{ user: null }` when unauthenticated rather than erroring.
   *
   * @returns {Promise<{ user: object | null }>}
   * @example
   * const { user } = await sdk.auth.me();
   * if (user?.role === 'admin') { ... }
   */
  me() { return this.sdk._fetch('/auth/me', 'GET'); }

  /**
   * First-run bootstrap: create the initial admin. Allowed ONLY when no users
   * exist yet (otherwise HTTP 403). Logs the creator straight in (sets session
   * cookie).
   *
   * @param {object} params
   * @param {string} params.username   - Admin username.
   * @param {string} params.password   - Admin password.
   * @param {string} [params.fullName] - Display name.
   * @param {string} [params.email]    - Email address.
   * @returns {Promise<{ ok: true, user: object }>}
   * @example
   * await sdk.auth.setup({ username: 'admin', password: 'changeme-now', email: 'admin@co.com' });
   * // → { ok: true, user: { id, username, role: 'admin', status: 'active', ... } }
   */
  setup({ username, password, fullName, email }) {
    return this.sdk._fetch('/auth/setup', 'POST', { body: { username, password, fullName, email } });
  }

  /**
   * Forgot-password: request a reset link for a local user. Always resolves with
   * `{ ok: true }` (never reveals whether the username/email exists). Firebase-only
   * users are silently ignored — they sign in via their provider.
   *
   * @param {object} params
   * @param {string} params.usernameOrEmail - Username or email to look up.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.auth.forgot({ usernameOrEmail: 'cameron@backv.co' });
   */
  forgot({ usernameOrEmail }) {
    return this.sdk._fetch('/auth/forgot', 'POST', { body: { usernameOrEmail } });
  }

  /**
   * Set a password using a single-use invite or reset token (no session
   * required — the token authorizes). Used by the invite flow, the forgot flow,
   * and after a forced password change from {@link login}. Password must be at
   * least 8 characters.
   *
   * @param {object} params
   * @param {string} params.token    - Single-use invite/reset token.
   * @param {string} params.password - New password (min 8 chars).
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.auth.reset({ token: 'abc123...', password: 'my-new-password' });
   */
  reset({ token, password }) {
    return this.sdk._fetch('/auth/reset', 'POST', { body: { token, password } });
  }

  /**
   * Trigger the CONSOLE's email-verification message for a user's address
   * (verification is a console concern — the emailed code/link lands on the
   * console UI, and the instance mirrors the result at the next SSO login).
   * Triggers for the caller's own address by default; admins may pass
   * `userId` for another account. 404 when the email has no console user in
   * the org; 503 when the instance isn't connected to the console.
   *
   * @param {object} [params]
   * @param {string} [params.userId] - (Admin only) target user id; defaults to self.
   * @returns {Promise<{ ok: true, sent?: boolean, alreadyVerified?: boolean }>}
   * @example
   * await sdk.auth.sendVerification();
   * await sdk.auth.sendVerification({ userId: 'a1b2c3d4e5f60708' }); // admin re-trigger
   */
  sendVerification({ userId } = {}) {
    return this.sdk._fetch('/auth/send-verification', 'POST', { body: { userId } });
  }

  /**
   * Firebase social sign-in (Google / Azure). Complete the Firebase popup on the
   * client, then post the resulting ID token here. The email is mapped to a Zeus
   * user: active → session issued; unknown → a pending user is created (HTTP 403,
   * awaiting admin approval); pending/disabled → HTTP 403.
   *
   * @param {object} params
   * @param {string} params.idToken - Firebase ID token from the client popup.
   * @returns {Promise<{ ok: true, user: object }>}
   *   On non-active accounts the request throws (403) with
   *   `{ error, status: 'pending' | 'disabled' }` in the error body.
   * @example
   * const { user } = await sdk.auth.firebase({ idToken });
   */
  firebase({ idToken }) {
    return this.sdk._fetch('/auth/firebase', 'POST', { body: { idToken } });
  }

  /**
   * Minimal user directory for recipient pickers (any authenticated user).
   * Returns only id + name + email for users with a VERIFIED email — no roles,
   * status, providers, password state, or unverified addresses (they'd bounce).
   *
   * @returns {Promise<{ directory: Array<{ id: string, fullName: string, email: string }> }>}
   * @example
   * const { directory } = await sdk.auth.directory();
   */
  directory() { return this.sdk._fetch('/auth/directory', 'GET'); }

  /**
   * Log out: revoke the current session and clear the session cookie. The route
   * responds with a 302 redirect to `/login`; in the browser the cookie is
   * cleared as a side effect. (No JSON body — the followed redirect returns the
   * login page; treat a non-throwing call as success.)
   *
   * @returns {Promise<*>} The followed-redirect response body (login page text).
   * @example
   * await sdk.auth.logout();
   */
  logout() { return this.sdk._fetch('/logout', 'POST'); }

  /**
   * Get the public IP of the *caller* (your browser/client), as seen by Zeus.
   * Also available as {@link SystemService.whoami}; duplicated here for
   * discoverability alongside the other auth/identity helpers.
   *
   * @returns {Promise<{ ip: string }>}
   * @example
   * const { ip } = await sdk.auth.whoami();
   */
  whoami() { return this.sdk._fetch('/whoami', 'GET'); }
}
