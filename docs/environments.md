# `sdk.environments` — EnvironmentsService

Container-scoped v2configs **environments**. An environment is a deployment
target that tracks its clusters, owned namespaces (and their secrets/configMaps),
white-label domains, backup profiles, and per-service networking.

Every method takes a single destructured object whose first field is
`container`; most also take the environment `name`. Routes that read `?branch=`
accept an optional `branch` (server default `'main'`). Methods return the route's
literal JSON response — no unwrapping. Errors throw `ZeusApiError`.

All routes live under `/api/v2configs/[container]/environments/...`.

## Collection

### `list({ container, branch? })`
List environments. → `GET /environments`
Returns `{ environments: object[] }`.
```js
const { environments } = await sdk.environments.list({ container: 'app1' });
```

### `create({ container, name, data?, branch? })`
Create/overwrite an environment by name. → `POST /environments`
Returns `{ environment }`.
```js
await sdk.environments.create({ container: 'app1', name: 'dev-d00', data: {} });
```

## Single environment

### `get({ container, name, branch? })`
→ `GET /environments/[name]` · Returns `{ environment }` (404 if missing).

### `update({ container, name, data?, branch?, baseRev? })`
→ `PUT /environments/[name]` · Returns `{ environment }` (includes the new `_rev`).
Optimistic concurrency: the route **requires** `baseRev` — the `_rev` the doc had when you
read it (defaults from `data._rev`, present whenever `data` came from `get()`; `null`
asserts "no doc exists yet"). A mismatch returns HTTP 409 `{ kind: 'stale-save',
currentRev }` and writes nothing — re-fetch, re-apply your change, retry (or use
`mutate()`, which does exactly that).

### `mutate({ container, name, branch?, retries? }, fn)`
Read-mutate-write with automatic stale-save retry: fetches the current doc, applies `fn`
(edit in place or return a replacement), saves with the fetched `_rev`; on a stale-save
409 it re-fetches and re-applies `fn` against the fresh doc (CAS retry — never a merge of
stale state). `retries` defaults to 3. Returns the successful `update()` result.
```js
await sdk.environments.mutate({ container: 'app1', name: 'dev-d00' }, (env) => { env.suspended = false; });
```

### `delete({ container, name, branch? })`
→ `DELETE /environments/[name]` (branch via query) · Returns `{ success: true }`.

### `duplicate({ container, name, targetName, branch? })`
Copy to a new env. → `POST /environments/[name]/duplicate` · Returns `{ environment }`.
```js
await sdk.environments.duplicate({ container: 'app1', name: 'dev-d00', targetName: 'dev-d01' });
```

## Namespaces

### `discoverNamespaces({ container, name, cluster, branch? })`
List every namespace on `cluster`, each tagged with which env (if any) owns it.
→ `GET /environments/[name]/discover-namespaces?cluster=...`
Returns `{ namespaces: [{ name, status, createdAt, trackedBy }] }`.
```js
const { namespaces } = await sdk.environments.discoverNamespaces({
  container: 'app1', name: 'system', cluster: 'z-01' });
```

### `moveNamespace({ container, name, namespace, targetContainer, targetEnvironment, branch? })`
Move a namespace + its secrets/configMaps to another env (409 if target owns it).
→ `POST /environments/[name]/move-namespace`
Returns `{ ok, moved, from, to, secretsMoved, configMapsMoved }`.

## Cluster teardown — `cluster-teardown` route (action-routed)

### `scanClusterTeardown({ container, name, clusterName, branch? })`
Preview everything the env installed on a cluster (`action: 'scan'`).
→ `POST /environments/[name]/cluster-teardown` · Returns the inventory object.

### `clusterTeardown({ container, name, clusterName, force?, deleteVolumes?, branch? })` **[SSE]**
Execute teardown and unlink the cluster on success (`action: 'execute'`).
→ `POST /environments/[name]/cluster-teardown` (SSE run stream).
Returns a stream handle (async-iterable + `onMessage/onDone/onError` + `close()`);
emits run `info`/`step`/`error`/`done` events. Cluster left linked on failure.
```js
const s = sdk.environments.clusterTeardown({ container: 'app1', name: 'dev-d00', clusterName: 'z-01' });
s.onMessage = (ev) => console.log(ev.data);
```

## Environment DNS

### `dns({ container, name, branch? })`
Desired vs. live env DNS records with status. → `GET /environments/[name]/dns`
Returns `{ records: object[] }`.

### `applyDns({ container, name, action, changes?, wlEntry? })`
→ `POST /environments/[name]/dns` (branch fixed to 'main' server-side). Actions:
- `'apply'` (`changes`) → `{ results, applied }`
- `'list-whitelabel'` (`wlEntry`) → `{ domain, zone, records }`
- `'delete-whitelabel'` (`wlEntry`) → `{ domain, zone, deleted, failed, ok }`

## Backup profiles

### `backupProfiles({ container, name, branch? })`
→ `GET /environments/[name]/backup-profiles`
Returns `{ profiles, defaultProfile, usage }` (secrets stripped).

### `backupProfileAction({ container, name, action, ...fields })`
Action-routed mutations. → `POST /environments/[name]/backup-profiles`.
`action` ∈ `upsert | remove | set-default | test | list-buckets |
describe-bucket | create-bucket | list-iam-users | create-iam-keys |
preview-policy | list-usage | plan-reconcile | apply-reconcile | drift-snapshot`.
Pass that action's fields (`name`, `profile`, `defaultProfile`, `region`,
`bucketName`, `pathPrefix`, `rotate`, `deleteOrphans`, `branch`, …). Response
shape depends on the action.
```js
await sdk.environments.backupProfileAction({
  container: 'app1', name: 'dev-d00', action: 'set-default', defaultProfile: 'primary' });
```

### `migrateBackupDeployments({ container, name, dryRun?, branch? })` **[SSE]**
Assign a backup profile to legacy backup-enabled deployments. Dry-run by default.
→ `POST /environments/[name]/backup-profiles/migrate-deployments` (SSE).
Returns a stream handle; terminal payload `{ dryRun, planned, skipped, summary }`.

## Per-service DNS & static IPs

### `serviceDns({ container, name, service, branch? })`
→ `GET /environments/[name]/services/[service]/dns`
Returns `{ records, dnsConfig, bindings?, isMultiCluster?, warnings?, applyEnabled?, message? }`.

### `applyServiceDns({ container, name, service, changes })`
Apply per-service DNS (`action: 'apply'` only; branch fixed 'main').
→ `POST /environments/[name]/services/[service]/dns` · Returns `{ results, applied }`.

### `serviceStaticIps({ container, name, service, cloud, region, cluster, branch? })`
List the (env, service, cluster) static-IP pool + region quota.
→ `GET /environments/[name]/services/[service]/static-ips?cloud=&region=&cluster=`
Returns `{ ips, quota, cloud, region, cluster }`.

### `allocateServiceStaticIp({ container, name, service, cloud, region, cluster, eipName?, branch? })`
Allocate a static IP. → `POST .../static-ips` · Returns `{ ip }`.
`eipName` pins an ordinal Name tag (e.g. `dev-d00-sip-0`).

### `releaseServiceStaticIp({ container, name, service, cloud, region, id })`
Release a static IP. → `DELETE .../static-ips?cloud=&region=&id=` · Returns `{ released: true }`.
