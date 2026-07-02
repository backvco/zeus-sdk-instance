# CLAUDE.md — zeus-sdk-instance

`@zeusk8s/sdk-instance` — JS client for the **Zeus instance API** (a deployed Zeus
app: clusters/EKS/GKE/k3s/Proxmox, environments, services, infra add-ons,
networking, provider accounts). Distinct from `@zeusk8s/sdk` (Console API,
billing/licensing) — this drives a single instance. Consumed by core Zeus
(`zeus/package.json` → `file:../sdks/zeus-sdk-instance` in dev) and any
Node/LLM tooling that talks to an instance over its public API.

## Layout

```
src/index.js         — ZeusInstanceSDK: composes every service onto sdk.<name>
src/base.js          — BaseSDK: baseURL/instance resolution, auth headers, _fetch, openStream wiring
src/errors.js        — ZeusApiError, ReachabilityAckRequiredError (412 gate)
src/stream.js        — openStream: SSE/async-iterable handle (onMessage/onDone/close)
src/services/<svc>.js    — one file per API surface, thin wrappers over this.sdk._fetch(endpoint, method, {body, query})
src/services/<svc>/*.js  — sub-namespaces for large surfaces (clusters, providers, infrastructure, settings)
docs/<svc>.md        — per-service method reference (kept in sync with JSDoc; read before guessing a method name)
```

Pure API client, no frontend.

## Adding/changing a method

1. Add the method to the matching `src/services/<svc>.js` (or sub-namespace file): `return this.sdk._fetch('/endpoint', 'METHOD', { body, query })`.
2. Keep the JSDoc block (`@param`/`@returns`/`@example`) — it's the only docs; also update `docs/<svc>.md`.
3. New surface: create the service class, register it in `src/index.js` constructor, add to the `sdk.<name>` doc list in the file-header comment.
4. `node --check src/services/<svc>.js` (and any file touched) before done.
5. Method names map 1:1 onto the instance API route — no independent API design here.

## Auth (two modes, resolved in `base.js`)

- **Browser**: no token; session cookie sent via `credentials:'include'`; instance auto-derived from `window.location`; baseURL defaults to same-origin `/api`.
- **Node**: pass `token` (`zeus_...` service token → `Authorization: Bearer`) or `devKey` (→ `x-dev-key` header, see zeus-project `reference_dev_key`); baseURL resolved to `https://<instance>.<rootUrl>/api`.
- `rootUrl` defaults to `my.zeusk8s.com` (prod); override via `ZEUS_ROOT_URL` or the `rootUrl` ctor option for dev (`my-dev.zeusk8s.com`).

## Gotchas

- **412 reachability gate**: some routes throw `ReachabilityAckRequiredError` instead of running — caller must re-issue with an explicit ack. Don't swallow this into a generic error path.
- **Streaming methods** (provision/destroy, image builds, helm rollouts, k8s logs/watch, runs log, help chat) return an `openStream` handle, not a plain promise — check `docs/<svc>.md` or the JSDoc `@returns` before assuming a normal `await`.
- **Already over-cap**: `connections.js` (561), `deploy.js` (542), `infrastructure.js` (533), `environments.js` (469), `k8s.js` (444). Don't add to them; split into a `services/<svc>/*.js` sub-namespace instead (pattern already used by `clusters.js` → `clusters/core.js|nodegroups.js|security.js|...`).
- `// @ts-nocheck` on every file (`jsconfig.json`: `checkJs: false`). Keep it on new files.
- No test suite (`npm test` is a no-op echo), no lint script — `node --check` per file is the only gate; see the `check` skill.
- Published to npm as `@zeusk8s/sdk-instance` (public); in dev, consumers link via `file:../sdks/zeus-sdk-instance` — edits are picked up immediately, no publish/build step. Use `sdks/scripts/switch-sdk-mode.sh` to flip modes.
