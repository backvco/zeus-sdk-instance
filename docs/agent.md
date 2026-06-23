# `sdk.agent` — zeus-agent enrollment & credentials

`AgentService` covers the host-side enrollment handshake, agent credential
rotation, and the internal dialer-verify callback. The zeus-agent runs on a
Proxmox/bare-metal host and dials out to Zeus over the zeus-dialer tunnel.

These routes are anonymous to the session layer (the token / secret IS the
auth), but calling through the SDK still attaches any configured token/devKey.
Each method returns the route's literal JSON and throws on HTTP 4xx/5xx.

| Method | Route | Notes |
|--------|-------|-------|
| `claim({ token })` | POST `/agent/enroll/claim` | → `{ ok: true }`. "I'm running" beacon; validates site token (or 48-hex builder token) WITHOUT consuming it |
| `complete({ token, hostname?, facts? })` | POST `/agent/enroll/complete` | → `{ agentId, agentSecret, siteId }`. Adds host to the token's site + mints a durable credential. Builder tokens return `siteId:'__builder__'` |
| `rekey({ siteId, agentId, currentSecret })` | POST `/agent/rekey` | → `{ agentSecret, agentId, siteId }`. Rotate secret; authenticates with the current one (401 on bad secret) |
| `verifyDialer({ siteId, agentId, secret, dialerSecret?, headers? })` | POST `/internal/agent/verify` | → `{ ok: boolean, error? }`. **INTERNAL** — for the zeus-dialer sidecar. Requires the shared secret via `x-dialer-secret` (set it via `dialerSecret`). 401 if mismatch, 503 if server has none configured |

A site token is reusable across every host in the site (not single-use). Builder
spot-instance tokens are 48 hex chars, ephemeral, and single-use (consumed by
`complete`).

```js
// host enrollment
await sdk.agent.claim({ token: siteToken });
const cred = await sdk.agent.complete({ token: siteToken, hostname: 'pve-01', facts });
// → { agentId, agentSecret, siteId }

// rotate
const { agentSecret } = await sdk.agent.rekey({ siteId, agentId, currentSecret });

// dialer sidecar authorizing a connection
const { ok } = await sdk.agent.verifyDialer({
  siteId, agentId, secret, dialerSecret: process.env.ZEUS_DIALER_SECRET
});
```
