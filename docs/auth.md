# `sdk.auth` — AuthService

Authentication, session, and account bootstrap. Zeus uses server-side sessions
backed by an `authToken` cookie. In the browser the cookie is sent automatically
(`credentials:'include'`); in Node these are mainly useful with a service token,
since cookie login isn't persisted across SDK calls.

Methods throw `ZeusApiError` on HTTP 4xx/5xx — you don't handle errors yourself.

## Methods

### `login({ username, password })`
Local username/password login. **`POST /api/auth/login`**

On success the server sets the session cookie. If a forced password change is
pending, no session is issued and a single-use reset token is returned instead.

- Params: `username`, `password`
- Returns: `{ ok: true, user }` **or** `{ mustChangePassword: true, token }`

```js
const res = await sdk.auth.login({ username: 'cameron', password: 'hunter2' });
if (res.mustChangePassword) await sdk.auth.reset({ token: res.token, password: 'new-pass-1234' });
```

### `me()`
Current authenticated principal from the session. **`GET /api/auth/me`**

- Returns: `{ user: object | null }` (`null` when unauthenticated — does not error)

```js
const { user } = await sdk.auth.me();
```

### `setup({ username, password, fullName?, email? })`
First-run bootstrap — create the initial admin. **`POST /api/auth/setup`**

Allowed ONLY while no users exist (else HTTP 403). Logs the creator straight in.

- Params: `username`, `password`, optional `fullName`, `email`
- Returns: `{ ok: true, user }`

```js
await sdk.auth.setup({ username: 'admin', password: 'changeme-now', email: 'admin@co.com' });
```

### `forgot({ usernameOrEmail })`
Request a password-reset link for a local user. **`POST /api/auth/forgot`**

Always resolves `{ ok: true }` (never reveals whether the account exists).
Firebase-only users are silently ignored.

- Params: `usernameOrEmail`
- Returns: `{ ok: true }`

```js
await sdk.auth.forgot({ usernameOrEmail: 'cameron@backv.co' });
```

### `reset({ token, password })`
Set a password using a single-use invite/reset token. **`POST /api/auth/reset`**

No session required (the token authorizes). Used by the invite flow, the forgot
flow, and after a forced password change. Password must be ≥ 8 chars.

- Params: `token`, `password`
- Returns: `{ ok: true }`

```js
await sdk.auth.reset({ token: 'abc123...', password: 'my-new-password' });
```

### `sendVerification({ userId? })`
Trigger the console's email-verification message for a user's address.
**`POST /api/auth/send-verification`**

Verification is a console concern — the emailed code/link lands on the console
UI, and the instance mirrors the result at the next SSO login. Alert email only
flows to console-verified (and opted-in) addresses; the console resolves alert
recipients. Triggers for the caller's own address by default; admins may pass
`userId`. 404 when the email has no console user in the org; 503 when the
instance isn't connected to the console.

- Params: `userId` (optional, admin only)
- Returns: `{ ok: true, sent?: boolean, alreadyVerified?: boolean }`

```js
await sdk.auth.sendVerification();
```

### `firebase({ idToken })`
Firebase social sign-in (Google / Azure). **`POST /api/auth/firebase`**

Complete the Firebase popup on the client, post the ID token here. Active email →
session issued; unknown → pending user created (403, awaiting approval);
pending/disabled → 403.

- Params: `idToken`
- Returns: `{ ok: true, user }`. Non-active accounts throw (403) with
  `{ error, status: 'pending' | 'disabled' }` in the error body.

```js
const { user } = await sdk.auth.firebase({ idToken });
```

### `directory()`
Minimal user directory for recipient pickers (any authenticated user).
**`GET /api/auth/directory`**

Only id + name + email for users with a **verified** email — no
roles/status/providers, and no unverified addresses (they'd bounce).

- Returns: `{ directory: Array<{ id, fullName, email }> }`

```js
const { directory } = await sdk.auth.directory();
```

### `logout()`
Revoke the current session and clear the cookie. **`POST /api/logout`**

The route responds with a 302 redirect to `/login` (no JSON body); the followed
redirect returns the login page. Treat a non-throwing call as success.

- Returns: followed-redirect response body (login page text)

```js
await sdk.auth.logout();
```

### `whoami()`
Public IP of the caller, as seen by Zeus. **`GET /api/whoami`**

Also on `sdk.system.whoami()`; duplicated here for discoverability.

- Returns: `{ ip: string }`

```js
const { ip } = await sdk.auth.whoami();
```
