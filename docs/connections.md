# `sdk.connections` — connection providers, categories & mesh connections

`ConnectionsService` covers two layers. Every method returns the route's literal
JSON body (no unwrapping) and throws on HTTP 4xx/5xx.

1. **Container-scoped providers** — named credential bundles ("providers") that
   hold "objects" with encrypted "fields"; services link to a provider and pick an
   object per environment. Grouped under user-defined connection categories.
2. **Top-level operator connections** — `edge-tenant`, `nats-gateway`,
   `netbird-overlay`. These take `container`/`branch` via query (GET/DELETE) or body
   (POST), defaulting to `app1`/`main` server-side.

Container-scoped methods take `{ container, ... }` plus optional `branch`
(default `'main'`, sent as `?branch=`). Top-level methods take optional
`{ container, branch, ... }`.

```js
const { providers } = await sdk.connections.list({ container: 'app1' });
await sdk.connections.linkService({ container: 'app1', provider: 'main-db', serviceName: 'api' });
const { records } = await sdk.connections.listNatsGateways();
```

---

## Container-scoped providers

| Method | Route | Notes |
|--------|-------|-------|
| `list({ container, branch? })` | GET `/v2configs/[container]/connections` | → `{ providers: [{ ...provider, linkedCount }] }` |
| `create({ container, name, data?, branch? })` | POST `/v2configs/[container]/connections` | → `{ provider }`. `data` defaults to `{ objects: [] }`; `name` required+validated |
| `get({ container, provider, branch? })` | GET `/v2configs/[container]/connections/[provider]` | → `{ provider }` (masked); 404 if missing |
| `save({ container, provider, data, branch? })` | PUT `/v2configs/[container]/connections/[provider]` | → `{ provider }`. Field values encrypted at rest |
| `delete({ container, provider, branch? })` | DELETE `/v2configs/[container]/connections/[provider]` | → `{ success: true }`. 409 (throws, `body.linkedServices`) if a service still links to it |
| `reveal({ container, provider, object, field, branch? })` | POST `/v2configs/[container]/connections/[provider]/reveal` | → `{ value }` (single decrypted field); 404 if object/field missing |
| `cloneObject({ container, provider, sourceName, newName?, branch? })` | POST `/v2configs/[container]/connections/[provider]/clone-object` | → `{ provider, clone: { fields } }`. `newName` auto-picked when omitted |
| `linkedServices({ container, provider, branch? })` | GET `/v2configs/[container]/connections/[provider]/linked-services` | → `{ services }` |
| `linkService({ container, provider, serviceName, branch? })` | POST `.../linked-services` `action:'link'` | → link result |
| `unlinkService({ container, provider, serviceName, branch? })` | POST `.../linked-services` `action:'unlink'` | → `{ removed }` |
| `swapObject({ container, provider, serviceName, envName?, objectName?, branch? })` | POST `.../linked-services` (default action) | → `{ entry }`. `envName:null` sets the default; `objectName:null` clears |

```js
const { clone } = await sdk.connections.cloneObject({ container: 'app1', provider: 'main-db', sourceName: 'primary' });
await sdk.connections.swapObject({ container: 'app1', provider: 'main-db', serviceName: 'api', envName: 'prod', objectName: 'primary' });
```

## Connection categories

| Method | Route | Notes |
|--------|-------|-------|
| `listCategories({ container, branch? })` | GET `/v2configs/[container]/connection-categories` | → `{ categories }` |
| `createCategory({ container, name, branch? })` | POST `/v2configs/[container]/connection-categories` | → `{ category }` |
| `renameCategory({ container, name, newName, branch? })` | PUT `/v2configs/[container]/connection-categories/[name]` | → `{ category }` |
| `deleteCategory({ container, name, branch? })` | DELETE `/v2configs/[container]/connection-categories/[name]` | → `{ success: true }`; 404 if missing |

```js
await sdk.connections.createCategory({ container: 'app1', name: 'Databases' });
```

---

## Top-level — edge-tenant

All take optional `{ container, branch }` (default `app1`/`main`); read from query
on GET/DELETE, from body on POST.

| Method | Route | Notes |
|--------|-------|-------|
| `listEdgeTenants({ container?, branch? })` | GET `/connections/edge-tenant` | → `{ records }` (masked) |
| `getEdgeTenantBundle({ name, container?, branch? })` | GET `/connections/edge-tenant?bundle=1` | → `{ bundle }` (plaintext download) |
| `saveEdgeTenant({ name, customer?, acl?, edges?, rateLimits?, container?, branch? })` | POST `/connections/edge-tenant` | → `{ record }` (HTTP 201); `name` required |
| `rotateEdgeTenant({ name, container?, branch? })` | POST `/connections/edge-tenant` `action:'rotate'` | → `{ record }` (rotates account seed) |
| `deleteEdgeTenant({ name, container?, branch? })` | DELETE `/connections/edge-tenant` | → `{ deleted }`; 404 if missing |

## Top-level — nats-gateway

| Method | Route | Notes |
|--------|-------|-------|
| `listNatsGateways({ container?, branch? })` | GET `/connections/nats-gateway` | → `{ records }` (masked) |
| `saveNatsGateway({ name, advertise?, peers?, operatorJwt?, accountJwt?, container?, branch? })` | POST `/connections/nats-gateway` | → `{ record }` (HTTP 201); `name` required |
| `rotateNatsGateway({ name, container?, branch? })` | POST `/connections/nats-gateway` `action:'rotate'` | → `{ record }` (rotates user seed) |
| `deleteNatsGateway({ name, container?, branch? })` | DELETE `/connections/nats-gateway` | → `{ deleted }`; 404 if missing |

## Top-level — netbird-overlay

| Method | Route | Notes |
|--------|-------|-------|
| `listNetbirdOverlays({ container?, branch? })` | GET `/connections/netbird-overlay` | → `{ records }` (masked) |
| `saveNetbirdOverlay({ name, mgmtUrl?, apiToken?, groupPrefix?, container?, branch? })` | POST `/connections/netbird-overlay` | → `{ record }` (HTTP 201); `apiToken` stored encrypted; `name` required |
| `deleteNetbirdOverlay({ name, container?, branch? })` | DELETE `/connections/netbird-overlay` | → `{ deleted }`; 404 if missing |

```js
await sdk.connections.saveNetbirdOverlay({ name: 'mesh', mgmtUrl: 'https://netbird.example.com', apiToken: '...' });
await sdk.connections.deleteEdgeTenant({ name: 'acme' });
```
