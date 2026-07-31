# `sdk.settings` — instance administration

`SettingsService` groups instance-admin endpoints into sub-namespaces. Every
method returns the route's literal JSON body (no unwrapping) and throws on HTTP
4xx/5xx.

```js
const { builders } = await sdk.settings.builders.list();
const { users }    = await sdk.settings.auth.listUsers();
```

| Sub-namespace            | Covers                                           |
|--------------------------|--------------------------------------------------|
| `sdk.settings.auth`          | auth/Firebase config, sessions, users (admin only) |
| `sdk.settings.builders`      | image builders, templates, cache volumes         |
| `sdk.settings.github`        | stored GitHub token connections                  |
| `sdk.settings.mail`          | outbound email config (admin only)               |
| `sdk.settings.npmTokens`     | npm/registry tokens                              |
| `sdk.settings.serviceTokens` | Zeus API service tokens (`zeus_...`)             |
| `sdk.settings.pricing`       | cloud price-cache config + refresh/cron          |
| `sdk.settings.system`        | instance-wide system-settings document           |

---

## `sdk.settings.auth` — auth config, sessions, users (admin only)

| Method | Route | Notes |
|--------|-------|-------|
| `getConfig()` | GET `/settings/auth/config` | → `{ config }` (Firebase web config + session TTL) |
| `saveConfig({ firebase?, sessionTtlHours? })` | PUT `/settings/auth/config` | → `{ config }` |
| `revokeAllSessions()` | POST `/settings/auth/config` `action:'revoke-all'` | → `{ ok }` — sign out everywhere |
| `listSessions({ userId? })` | GET `/settings/auth/sessions` | → `{ sessions, currentSid }` |
| `revokeSession({ sid })` | DELETE `/settings/auth/sessions/[sid]` | → `{ ok }` (404 if unknown) |
| `listUsers()` | GET `/settings/auth/users` | → `{ users }` (sanitized) |
| `createUser({ username, fullName?, email?, role?, password?, sendInvite?, includePassword? })` | POST `/settings/auth/users` | → `{ user, emailWarning }`. `sendInvite` (needs email) emails a set-password link instead of setting a password |
| `sendInvite({ id })` | PUT `/settings/auth/users/[id]` `action:'send-invite'` | → `{ ok }` |
| `sendReset({ id })` | PUT `/settings/auth/users/[id]` `action:'send-reset'` | → `{ ok }` |
| `revokeUserSessions({ id })` | PUT `/settings/auth/users/[id]` `action:'revoke-sessions'` | → `{ ok }` |
| `approveUser({ id })` | PUT `/settings/auth/users/[id]` `action:'approve'` | → `{ user }` |
| `setRole({ id, role })` | PUT `/settings/auth/users/[id]` `action:'set-role'` | → `{ user }` |
| `setStatus({ id, status })` | PUT `/settings/auth/users/[id]` `action:'set-status'` | → `{ user }`; non-active also revokes sessions |
| `setPassword({ id, password })` | PUT `/settings/auth/users/[id]` `action:'set-password'` | → `{ user }` (admin-set) |
| `updateProfile({ id, fullName?, email? })` | PUT `/settings/auth/users/[id]` `action:'update-profile'` | → `{ user }` |
| `deleteUser({ id })` | DELETE `/settings/auth/users/[id]` | → `{ ok }`; refuses last active admin |

```js
await sdk.settings.auth.createUser({ username: 'cam', email: 'c@x.com', sendInvite: true });
const { sessions, currentSid } = await sdk.settings.auth.listSessions();
```

---

## `sdk.settings.builders` — image-build infrastructure

| Method | Route | Notes |
|--------|-------|-------|
| `list()` | GET `/settings/builders` | → `{ builders, localEnabled, localCachePath, localUnavailable, localUnavailableMessage, runtimeEnv }`; reconciles remote base images |
| `create(params)` | POST `/settings/builders` | → `{ builder }`; requires `name` + `type` (`local`/`aws-spot`/`gcp-spot`) |
| `setLocalEnabled({ enabled? })` | POST `/settings/builders` `action:'setLocalEnabled'` | → `{ ok }` |
| `setLocalCachePath({ path? })` | POST `/settings/builders` `action:'setLocalCachePath'` | → `{ ok }` |
| `clearGlobalDefault()` | POST `/settings/builders` `action:'clearGlobalDefault'` | → `{ ok }` |
| `get({ id })` | GET `/settings/builders/[id]` | → `{ builder }` |
| `update({ id, patch })` | PUT `/settings/builders/[id]` | → `{ builder }` |
| `delete({ id })` | DELETE `/settings/builders/[id]` | → `{ ok }` |
| `listCacheVolumes({ id })` | GET `/settings/builders/[id]/cache-volumes` | → `{ volumes }` |
| `deleteCacheVolume({ id, volumeId, service?, arch? })` | DELETE `/settings/builders/[id]/cache-volumes/[volumeId]` | → `{ ok }`; `service`/`arch` are query params |
| `templateStatus({ id })` | GET `/settings/builders/[id]/template` | → provision status |
| `provisionTemplate({ id, arch? })` | POST `/settings/builders/[id]/template` | → `{ ok, ... }`; local builders rejected (400) |

```js
const { builders } = await sdk.settings.builders.list();
await sdk.settings.builders.provisionTemplate({ id: 'bld-123', arch: 'arm64' });
```

---

## `sdk.settings.github` — GitHub connections

| Method | Route | Notes |
|--------|-------|-------|
| `list()` | GET `/settings/github/connections` | → `{ connections }` (no raw tokens) |
| `test({ token })` | POST `/settings/github/connections` `action:'test'` | → `{ result }`; probe without saving |
| `create({ token, name? })` | POST `/settings/github/connections` | → `{ connection }` |
| `reprobe({ id })` | PUT `/settings/github/connections/[id]` `action:'reprobe'` | → `{ connection }` |
| `rename({ id, name })` | PUT `/settings/github/connections/[id]` `action:'rename'` | → `{ connection }` |
| `testById({ id })` | PUT `/settings/github/connections/[id]` `action:'test'` | → raw test result |
| `listRepos({ id })` | GET `/settings/github/connections/[id]?action=repos` | → `{ repos }` |
| `delete({ id })` | DELETE `/settings/github/connections/[id]` | → `{ ok }` |

```js
const { result } = await sdk.settings.github.test({ token: 'ghp_...' });
const { connection } = await sdk.settings.github.create({ token: 'ghp_...', name: 'CI' });
```

---

## `sdk.settings.mail` — email config (admin only)

| Method | Route | Notes |
|--------|-------|-------|
| `get()` | GET `/settings/mail/config` | → `{ config }` (SMTP password omitted) |
| `save({ provider, fromName, fromAddress, smtp?, ses? })` | PUT `/settings/mail/config` | → `{ config }` |
| `test({ to })` | POST `/settings/mail/config` `action:'test'` | → `{ ok }`; sends a test email |

```js
await sdk.settings.mail.test({ to: 'me@example.com' });
```

---

## `sdk.settings.npmTokens` — npm/registry tokens

| Method | Route | Notes |
|--------|-------|-------|
| `list()` | GET `/settings/npm-tokens` | → `{ tokens }` (no raw values) |
| `test({ token, registryUrl? })` | POST `/settings/npm-tokens` `action:'test'` | → probe result; no save |
| `create({ name, token, expiresAt?, registryUrl?, scope? })` | POST `/settings/npm-tokens` | → `{ npmToken }` |
| `get({ id })` | GET `/settings/npm-tokens/[id]` | → `{ npmToken }` |
| `update({ id, name?, token?, expiresAt?, registryUrl?, scope? })` | PUT `/settings/npm-tokens/[id]` | → `{ npmToken }` |
| `testStored({ id })` | POST `/settings/npm-tokens/[id]` `action:'test'` | → probe stored token |
| `delete({ id })` | DELETE `/settings/npm-tokens/[id]` | → `{ ok }` |

```js
const { npmToken } = await sdk.settings.npmTokens.create({ name: 'ci', token: 'npm_...' });
```

---

## `sdk.settings.serviceTokens` — Zeus API tokens

| Method | Route | Notes |
|--------|-------|-------|
| `list()` | GET `/settings/service-tokens` | → `{ tokens }` (masked) |
| `create({ name })` | POST `/settings/service-tokens` | → `{ token }` incl. `plaintext` (shown once) |
| `reveal({ id })` | GET `/settings/service-tokens/[id]` | → `{ token }` (full plaintext) |
| `rename({ id, name })` | PUT `/settings/service-tokens/[id]` | → `{ token }` |
| `delete({ id })` | DELETE `/settings/service-tokens/[id]` | → `{ ok }` |

```js
const { token } = await sdk.settings.serviceTokens.create({ name: 'sdk' });
// token.plaintext — store now; not shown again in list().
```

---

## `sdk.settings.pricing` — price-cache config

| Method | Route | Notes |
|--------|-------|-------|
| `get()` | GET `/settings/pricing` | → `{ config, resolvedCacheDir, status[] }` |
| `save({ cacheDir?, aws?, gcp? })` | PUT `/settings/pricing` | → same shape as `get()` |
| `cronStatus()` | GET `/settings/pricing/cron` | → `{ registered, schedule, line }` |
| `registerCron()` | POST `/settings/pricing/cron` | → `{ registered, schedule, line }` |
| `refreshStatus()` | GET `/settings/pricing/refresh` | → refresh job status |
| `startRefresh()` | POST `/settings/pricing/refresh` | → initial running status |

```js
await sdk.settings.pricing.save({ aws: { enabled: true, regions: ['us-east-2'] } });
await sdk.settings.pricing.startRefresh();
```

---

## `sdk.settings.system` — system settings doc

| Method | Route | Notes |
|--------|-------|-------|
| `get()` | GET `/settings/system` | → `{ settings }` |
| `update(patch)` | PUT `/settings/system` | → `{ settings }` (partial merge) |

```js
const { settings } = await sdk.settings.system.get();
await sdk.settings.system.update({ defaultRegion: 'us-east-2' });
```
