# `sdk.providers.gcp` — GCP / GKE provider

`GcpService` covers the CLI account-link flow, identity probe, region / project /
machine-type catalogs, provider settings, the IAM permission coverage check +
tiers + API-enable + permission-fix flow, and the Workload-Identity binding
helper. Two sub-namespaces hang off it:

| Sub-namespace | Class | Covers |
|---|---|---|
| `.accounts` | `GcpAccountsService` | account CRUD + default + verify, per-account project registry, GKE cluster discovery, GKE server-config |
| `.images` | `GcpImagesService` | GCE custom-image recipes, builds (SSE), live-image lifecycle |

Every method takes a single destructured object and returns the route's JSON
verbatim. `accountId` scopes most calls (omit → default account); GCP work is
also project-scoped (`project` defaults to the account's operator project where
applicable). Streaming methods return an SSE handle (async-iterable +
`onMessage/onDone/onError` + `close()`).

```js
const { accounts } = await sdk.providers.gcp.accounts.list();
const { channels } = await sdk.providers.gcp.accounts.serverConfig({ accountId:'prod', project:'my-proj', location:'us-central1' });
const s = sdk.providers.gcp.images.build({ name:'gke-base', accountId:'prod' });
s.onMessage = (ev) => console.log(ev.type, ev.data);
```

---

## `.accounts` — `GcpAccountsService`

| Method | Route | Returns |
|---|---|---|
| `list()` | `GET /providers/gcp/accounts` | `{ accounts, defaultAccountId }` |
| `create({ accountId, alias, displayName, projectId, credentialType, serviceAccountKey })` | `POST /providers/gcp/accounts` | `{ account }` |
| `get({ accountId })` | `GET …/[accountId]` | `{ account }` |
| `update({ accountId, fields })` | `PUT …/[accountId]` | `{ account }` |
| `setDefault({ accountId })` | `PUT …/[accountId]` (action=set-default) | `{ account, defaulted }` |
| `delete({ accountId, force })` | `DELETE …/[accountId]?force=1` | `{ ok }` |
| `verify({ accountId, serviceAccountKey?, projectId? })` | `POST …/[accountId]/verify` | `{ ok, projectId?, zoneCount?, error? }` |
| `availableProjects({ accountId })` | `GET …/[accountId]/available-projects` | `{ ok, projects }` |
| `projects({ accountId })` | `GET …/[accountId]/projects` | `{ operatorProject, projects }` |
| `registerProject({ accountId, projectId, displayName? })` | `POST …/[accountId]/projects` | `{ ok, projects }` |
| `unregisterProject({ accountId, projectId })` | `DELETE …/[accountId]/projects?projectId` | `{ ok, projects }` |
| `clusters({ accountId, project, location? })` | `GET …/[accountId]/clusters` | `{ clusters }` |
| `serverConfig({ accountId, project, location? })` | `GET …/[accountId]/server-config` | `{ validVersions, defaultVersion, channels }` |

`verify` with a `serviceAccountKey` verifies pre-save; never throws (200
`{ ok:false }` on failure). `availableProjects` lists projects the SA can see;
`clusters` discovers live GKE clusters (`location='-'` = all).

## `.images` — `GcpImagesService`

| Method | Route | Returns |
|---|---|---|
| `list()` | `GET /providers/gcp/images` | `{ recipes }` |
| `create({ name, cloneFrom? })` | `POST /providers/gcp/images` | `{ created }` |
| `get({ name, bundle? })` | `GET /providers/gcp/images/[name]` | `{ recipe, readme, builds }` or bundle |
| `save({ name, recipe?, readme? })` | `PUT …/[name]` | `{ saved }` |
| `delete({ name })` | `DELETE …/[name]` | `{ deleted }` (409 if it has builds) |
| `builds({ name })` | `GET …/[name]/builds` | `{ builds }` |
| `build({ name, accountId?, zone?, machineType?, network?, subnetwork?, serviceAccount?, maxRuntimeMinutes?, serialPortEnabled? })` | `POST …/[name]/builds` | **SSE** (early `info` carries `buildId`; 409 if in-flight) |
| `getBuild({ name, id })` | `GET …/[name]/builds/[id]` | `{ build }` |
| `cancelBuild({ name, id })` | `POST …/[name]/builds/[id]/cancel` | `{ cancelled }` |
| `streamBuild({ name, id })` | `GET …/[name]/builds/[id]/stream` | **SSE** log replay |
| `cloudImages({ name, accountId? })` | `GET …/[name]/cloud-images` | `{ project, current, pinned, images, keepVersions, autoMakeCurrent }` |
| `cloudImageAction({ name, action, accountId?, image?, force?, autoMakeCurrent?, keepVersions? })` | `POST …/[name]/cloud-images` | `{ ok, … }` |
| `plan({ name, accountId?, zone?, machineType?, network?, subnetwork?, serviceAccount?, maxRuntimeMinutes? })` | `POST …/[name]/plan` | `{ plan }` |
| `networks({ region, accountId? })` | `GET /providers/gcp/images/networks` | `{ networks }` |

`cloudImageAction` `action`: `makeCurrent` | `useLatest` | `delete` | `protect` |
`unprotect` | `setPolicy`.

---

## Identity & catalogs (`sdk.providers.gcp`)

| Method | Route | Returns |
|---|---|---|
| `identity({ accountId? })` | `GET /providers/gcp/identity` | `{ accountId, ok, email?, projectId?, error? }` |
| `regions({ accountId?, branch? })` | `GET /providers/gcp/regions` | `{ regions }` |
| `projects()` | `GET /providers/gcp/projects` | `{ operatorProject, projects }` |
| `machineTypes({ region, accountId?, project? })` | `GET /providers/gcp/machine-types` | `{ region, project, regionZones, machineTypes }` |

`identity` returns 200 `{ ok:false }` on credential failure.

## Account link (CLI flow)

| Method | Route | Returns |
|---|---|---|
| `linkInit()` | `POST /providers/gcp/accounts/link/init` | `{ token, expiresAt, command, zeusUrl }` |
| `linkClaim({ token })` | `POST …/link/claim` | `{ ok }` |
| `linkComplete({ token, accountId, alias?, projectId?, clientEmail?, serviceAccountKey?|serviceAccountKeyB64?, projectsCsv? })` | `POST …/link/complete` | `{ ok, account, registered, skipped }` |
| `linkStatus({ token })` | `GET …/link/status?token` | `{ status, … }` |

## Permissions & setup

| Method | Route | Returns |
|---|---|---|
| `permissionsCheck({ accountId?, projectId? })` | `POST /providers/gcp/permissions-check` | `{ ok, accountId?, … }` (plain JSON, not SSE) |
| `enableApis({ projectId, services, accountId? })` | `POST /providers/gcp/setup/enable-apis` | `{ ok, enabled }` |
| `setupTiers()` | `GET /providers/gcp/setup/tiers` | `{ tiers }` (includes `roles[]`) |
| `fixInit({ grants, accountId? })` | `POST /providers/gcp/setup/fix/init` | `{ token, expiresAt, command }` |
| `fixClaim({ token })` | `POST …/fix/claim` | `{ saEmail, grants }` |
| `fixComplete({ token, error? })` | `POST …/fix/complete` | `{ ok }` |
| `fixStatus({ token })` | `GET …/fix/status?token` | `{ status, error? }` |

`fixInit` `grants` = `[{ projectId, roles: [...] }]`. Unlike AWS, the GCP coverage
check is a single API call returning plain JSON (not SSE).

## Workload Identity

| Method | Route | Returns |
|---|---|---|
| `workloadIdentity(body)` | `POST /gcp/workload-identity` | depends on `action` |

Full body passed through; requires `action`, `container`, `clusterName`
(`branch` defaults `main`). `action`:
- `search` `{ gcpRoles?, k8sNamespace?, k8sSaName? }` → `{ serviceAccounts, project }`
- `create` `{ saId, displayName?, gcpRoles?, k8sNamespace?, k8sSaName? }` → `{ email, bindingUpdated }`
- `ensure-binding` `{ saEmail, k8sNamespace, k8sSaName }` → `{ updated }`
