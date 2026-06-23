# `sdk.services` — ServicesService

Container-scoped service (workload) configs plus two sub-namespaces:
`sdk.services.identities` (cloud identities) and `sdk.services.registry`
(image build / registry / scan / deploy — the legacy `/api/services/**` surface).

All container-scoped methods take `{ container, name, ... }`. `branch` is
optional and defaults to `main` on the server when omitted.

---

## Core — `sdk.services`

### `list({ container, branch })`
List all services. `GET /api/v2configs/[container]/services` → `{ services }`.
```js
const { services } = await sdk.services.list({ container: 'app1' });
```

### `create({ container, name, data, branch })`
Create/replace a service. `POST /api/v2configs/[container]/services` → `{ service }`.
```js
await sdk.services.create({ container: 'app1', name: 'api', data: {...} });
```

### `get({ container, name, branch })`
Get one service. `GET /api/v2configs/[container]/services/[name]` → `{ service }` (404 if missing).
```js
const { service } = await sdk.services.get({ container: 'app1', name: 'api' });
```

### `update({ container, name, data, branch })`
Replace a service config. `PUT /api/v2configs/[container]/services/[name]` → `{ service }`.
```js
await sdk.services.update({ container: 'app1', name: 'api', data: {...} });
```

### `delete({ container, name, branch })`
Delete + scrub from all environments. `DELETE /api/v2configs/[container]/services/[name]` → `{ success, scrubbedEnvironments }`.
```js
await sdk.services.delete({ container: 'app1', name: 'api' });
```

### `builder({ container, name })`
Get default builder override. `GET .../services/[name]/builder` → `{ defaultBuilderId }`.

### `setBuilder({ container, name, defaultBuilderId })`
Set/clear default builder. `PUT .../services/[name]/builder` → `{ defaultBuilderId }`.

### `cronEnables({ container, name, cron, branch })`
(env,cluster) pairs where a cron job is enabled. `GET .../services/[name]/cron-enables?cron=` → `{ enables }`.

### `environments({ container, name, branch })`
Environments that include this service. `GET .../services/[name]/environments` → `{ environments: [{ name, displayName, namespace, replicas, enabled, defaultBranch, clusters }] }`.

### `volumeMappings({ container, name, volume, branch })`
(env,cluster) storage-class mappings for a PVC volume. `GET .../services/[name]/volume-mappings?volume=` → `{ mappings }`.

---

## `sdk.services.identities` — ServiceIdentitiesService

Per-service AWS IAM users / GCP workload identities. Desired state + reconcile.
All methods take `{ container, name, ... }` where `name` is the owning service.

### `list({ container, name, branch })`
`GET .../identities` → `{ identities }`.

### `create({ container, name, identity, branch })`
`POST .../identities` (provider must be `aws`) → `{ identity, sync }`. 409 if exists.
```js
await sdk.services.identities.create({ container:'app1', name:'api',
  identity:{ name:'api-s3', provider:'aws', permissions:[...] } });
```

### `get({ container, name, identity, includeAws, branch })`
`GET .../identities/[identity]` (set `includeAws:false` → `?aws=false`, skips cloud calls) → `{ identity, describe? }`.

### `update({ container, name, identity, identityData, branch })`
`PUT .../identities/[identity]` (name immutable) → `{ identity, sync }`. `identityData` is the updated blob.

### `delete({ container, name, identity, branch })`
`DELETE .../identities/[identity]?branch=` → `{ success, cleaned }`.

### `reconcile({ container, name, identity, branch })`
Apply desired state to the cloud. `POST .../identities/[identity]/reconcile` → reconcile result.

### `deliver({ container, name, identity, context, branch })`
Push active key into a cluster K8s secret. `POST .../identities/[identity]/deliver` → `{ delivered, namespace, secret, accessKeyId }`. `context` = kubeconfig context.

### `listKeys({ container, name, identity, branch })`
`GET .../identities/[identity]/keys` → cached key list/state.

### `createKey({ container, name, identity, branch })`
Mint a rotation key (secret cached server-side, not returned). `POST .../identities/[identity]/keys` → `{ accessKeyId, createdAt }`.

### `revealKey({ container, name, identity, keyId, branch })`
Reveal cached secret for a Zeus-created key. `GET .../keys/[keyId]?reveal=true` → `{ accessKeyId, secretAccessKey, slot }`.

### `setKeyStatus({ container, name, identity, keyId, status, branch })`
Activate/deactivate. `PATCH .../keys/[keyId]` (`status:'Active'|'Inactive'`) → `{ success }`.

### `deleteKey({ container, name, identity, keyId, branch })`
Permanently delete a key. `DELETE .../keys/[keyId]` (branch in body) → `{ success }`.

### `scanRepo({ container, name, op, gitBranch, branch })`
Discover policy JSON in the service's GitHub repo (read-only). `GET .../identities/sync-from-repo?op=`. `op` = `branches` (default) | `scan` (needs `gitBranch`) | `drift` → `{ repo, ... }`.

### `importFromRepo({ container, name, identityName, candidate, deliverTo, branch })`
Import a discovered candidate as an identity. `POST .../identities/sync-from-repo` → `{ identity }`.

---

## `sdk.services.registry` — ServiceRegistryService

The legacy `/api/services/**` image lifecycle surface. Not container-scoped in
the URL; pass `container` in query/body where shown to resolve workspace registry creds.

### `config()`
All services' build config. `GET /api/services/config` → raw map.

### `setConfig({ name, config })`
`POST /api/services/config` → `{ ok }`.

### `deleteConfig({ name })`
`DELETE /api/services/config` → `{ ok }`.

### `buildFiles({ name, ref })`
Editable build files from GitHub. `GET /api/services/[name]/build-files?ref=` → `{ files, ref, branches }`.

### `commitBuildFiles({ name, baseBranch, targetBranch, prTitle, files })`
Commit edits to a `zeus/*` branch + open PR. `POST /api/services/[name]/build-files` → `{ ok, prUrl, branch }`.

### `clusterInfo({ name, env, enabledOnly })`
Live workloads running the service image. `GET /api/services/[name]/cluster-info?env=&enabledOnly=1` → `{ deployment, pods, instances }`.

### `buildLogs({ name })`
In-memory build/deploy logs. `GET /api/services/build-logs?name=` → log-key→entry map.

### `registry({ name, mode, container })`
List image tags. `GET /api/services/registry` (`mode:'list'` for names only) → `{ baseName, registry, tags | tagNames }`.

### `deleteTag({ name, tag, container })`
`DELETE /api/services/registry?name=&tag=` → delete result.

### `buildStatus({ name, mode, branch })`
`GET /api/services/registry/build`. `mode` = `info` | `active` | `branches`; no mode = status poll for `name`+`branch`.

### `build({ name, branch, builderId, envTag, platforms, container, npmTokenIds, environment, action })`
Start a build (or `action:'abort'`). `POST /api/services/registry/build`. `builderId` required unless aborting (no fallback).
```js
await sdk.services.registry.build({ name:'api', branch:'main', builderId:'local' });
```

### `buildStream({ name, branch })` — **SSE**
Live build status stream. `GET /api/services/registry/build/stream` (text/event-stream). Events: `snapshot`, `update`, `heartbeat`, `done`. Returns a stream handle.
```js
const s = sdk.services.registry.buildStream({ name:'api', branch:'main' });
s.onMessage(e => console.log(e.event, e.data));
```

### `deploy({ serviceName, environment, tag, container })`
Roll a tag onto a deployment/statefulset. `POST /api/services/registry/deploy` → `{ ok, image, deployment, namespace, output }`.

### `scan({ name, container, tag, mode })`
Vulnerability data. `GET /api/services/registry/scan`. Default → `{ overviews, available }`; `mode:'vulnerabilities'` (+`tag`) → `{ vulnerabilities }`.

### `triggerScan({ name, tag, container })`
Trigger a (re)scan. `POST /api/services/registry/scan` → scan-trigger result.
