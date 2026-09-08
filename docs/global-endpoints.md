# `sdk.globalEndpoints` — external DNS failover overrides

`GlobalEndpointsService` covers the manual-failover surface of `/api/global-endpoints/[name]/external/**`.
A record is one published hostname whose weighted/failover members are clusters. Health automation
sets weights; manual overrides are applied LAST and always win, and are **per record** — holding a
cluster at weight 0 on `portals.example.com` never touches `api.example.com`. Each method returns the
route's literal JSON and throws on HTTP 4xx/5xx.

| Method | Route | Notes |
|--------|-------|-------|
| `override({ name, type, cluster?, value? })` | POST `/global-endpoints/{name}/external/override` | `type` ∈ `drain`, `clear-drain`, `pin`, `clear-pin`, `weight`, `clear-weight`, `restore`, `clear-restore`, `failback`, `clear-failback`. → `{ overrides, applied }` (reconcile runs immediately) |
| `externalStatus({ name })` | GET `/global-endpoints/{name}/external/status` | Per-cluster weights, health verdicts, active overrides |

Join gate for an in-cluster agent (stay out of one hostname until ready, e.g. certs synced):

```js
await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'weight', cluster: 'z-01', value: 0 });
// ... become ready ...
await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'clear-weight', cluster: 'z-01' });
const status = await sdk.globalEndpoints.externalStatus({ name: 'portals.example.com' });
```
