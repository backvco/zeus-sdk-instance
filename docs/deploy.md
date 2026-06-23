# `sdk.deploy` — DeployService

Non-container-scoped v2configs **utility** endpoints. They don't live under
`/api/v2configs/[container]/...`; instead they take the target `container` (plus
`branch`, default `'main'`) in the request body or query. Covers the deploy
pipeline, shared config/env-file layers, node-group user-data preview, MySQL
replication, GitHub import, IAM/GCP identity catalogs, and a CIDR check.

Methods throw `ZeusApiError` on HTTP 4xx/5xx. Streaming methods return an SSE
stream handle from `openStream` (async-iterable + `onOpen/onMessage/onError/onDone`
+ `close()`); each event is `{ type, data, raw }`.

## Deploy pipeline

### `deploy({ container, envName, clusterNames, branch? })`
Generate the full multi-phase deployment for an env across clusters. **`POST /api/v2configs/deploy`**
- Returns: `{ results: Record<cluster, { phases, warnings }> }`
```js
const { results } = await sdk.deploy.deploy({ container: 'app1', envName: 'prod', clusterNames: ['z-01'] });
```

### `status({ container, envName, clusterName, branch? })`
Live namespace/secret/service status (default `handleStatus` action). **`POST /api/v2configs/deploy/status`**
- Returns: `{ clusterName, namespaces, secrets, services }`
```js
const st = await sdk.deploy.status({ container: 'app1', envName: 'prod', clusterName: 'z-01' });
```

### `statusAction(body)`
Escape hatch for the deploy/status `action` dispatcher (`secret-value`,
`ensure-namespaces`, `apply-secrets`, `generate-service`, `apply-services`,
`service-pods`, `check-drift`, `restart-service`, `scale-service`,
`delete-service`, `uninstall-preview`, `uninstall-service`, `list-crons`,
`trigger-cron`, `cron-job-logs`). **`POST /api/v2configs/deploy/status`**
- Returns: action-specific object
```js
const { pods } = await sdk.deploy.statusAction({ action: 'service-pods', container: 'app1', envName: 'prod', clusterName: 'z-01', namespace: 'default', serviceNames: ['api'] });
```

### `dryRunWrite({ container, envName, clusterName, branch? })`
Generate all YAML and write to `/tmp/v2-dryrun/{env}/{cluster}/`. **`POST /api/v2configs/dryrun`**
- Returns: `{ outputPath, fileTree, totalFiles, warnings, generatedAt }`
```js
const { totalFiles } = await sdk.deploy.dryRunWrite({ container: 'app1', envName: 'prod', clusterName: 'z-01' });
```

### `dryRunFile({ envName, clusterName, filePath })`
Read back one generated dry-run file. **`GET /api/v2configs/dryrun`**
- Returns: `{ content, filePath }`
```js
const { content } = await sdk.deploy.dryRunFile({ envName: 'prod', clusterName: 'z-01', filePath: '01-namespaces/ns.yaml' });
```

### `generateService({ container, serviceName, envName, clusterName, branch? })`
Render YAML for one saved service. **`POST /api/v2configs/generate`**
- Returns: `{ files, warnings }`
```js
const { files } = await sdk.deploy.generateService({ container: 'app1', serviceName: 'api', envName: 'prod', clusterName: 'z-01' });
```

### `generatePreview({ container, serviceConfig, envName, clusterName?, branch? })`
Preview YAML for an ad-hoc (unsaved) service config. **`POST /api/v2configs/generate/preview`**
- Returns: `{ files, warnings }`
```js
const res = await sdk.deploy.generatePreview({ container: 'app1', envName: 'prod', serviceConfig: { name: 'api' } });
```

### `validate({ container, data, type?, branch? })`
Validate a `service` | `cluster` | `environment` config object. **`POST /api/v2configs/validate`**
- Returns: validator result (`{ valid, errors?, warnings? }`)
```js
const v = await sdk.deploy.validate({ container: 'app1', type: 'service', data: svc });
```

## Node-group user-data (pure)

### `validateUserData({ amiType, userData })`
Static user-data validation for an AMI type. **`POST /api/v2configs/validate-user-data`**
- Returns: validation result object
```js
const r = await sdk.deploy.validateUserData({ amiType: 'AL2_x86_64', userData: '#!/bin/bash' });
```

### `userDataPreview({ preset, amiType, instanceType, podMemoryRequestMiB? })`
Preview the tuning-preset block Zeus injects. **`POST /api/v2configs/user-data-preview`**
- Returns: rendered preset block object
```js
const block = await sdk.deploy.userDataPreview({ preset: 'balanced', amiType: 'AL2_x86_64', instanceType: 'm5.large' });
```

## Shared env-file + common layers

### `listEnvFiles({ branch?, envName?, service?, container? })`
List env-file layers (global only, or global+env+merged). **`GET /api/v2configs/env-files`**
- Returns: `{ global, env?, merged? }`
```js
const { global } = await sdk.deploy.listEnvFiles();
```

### `saveEnvFile({ scope, filename, content, branch?, envName?, container? })`
Create/overwrite an env file. **`PUT /api/v2configs/env-files`**
- Returns: `{ ok }`
```js
await sdk.deploy.saveEnvFile({ scope: 'global', filename: 'api.txt', content: 'FOO=1' });
```

### `deleteEnvFile({ scope, filename, branch?, envName?, container? })`
Delete an env file. **`DELETE /api/v2configs/env-files`**
- Returns: `{ ok }`
```js
await sdk.deploy.deleteEnvFile({ scope: 'global', filename: 'api.txt' });
```

### `getCommon({ branch? })`
Read the shared `common` config block. **`GET /api/v2configs/common`**
- Returns: `{ common }`
```js
const { common } = await sdk.deploy.getCommon();
```

### `saveCommon({ data, branch? })`
Replace the `common` config block. **`PUT /api/v2configs/common`**
- Returns: `{ common }`
```js
await sdk.deploy.saveCommon({ data: { region: 'us-east-2' } });
```

### `presets()`
Provider/cluster preset catalog. **`GET /api/v2configs/presets`**
- Returns: `{ presets, providers }`
```js
const { presets } = await sdk.deploy.presets();
```

## MySQL replication

### `mysqlReplication({ action, container?, setName?, branch?, opAction?, params?, limit? })`
Read-only replication queries: `discover` | `status` | `preflight` | `activity`. **`POST /api/v2configs/replication/mysql`**
- Returns: action-specific body
```js
const board = await sdk.deploy.mysqlReplication({ action: 'status', container: 'app1', setName: 'main' });
```

### `mysqlReplicationAction({ container, setName, action, params?, execute?, branch? })` — streaming
Mutating ClusterSet action (`create` | `add-replica` | `switchover` | `failover`
| `rejoin`) as SSE. Dry-run unless `execute:true`. **`POST /api/v2configs/replication/mysql/action`**
- Returns: SSE stream handle
```js
const s = sdk.deploy.mysqlReplicationAction({ container: 'app1', setName: 'main', action: 'switchover', execute: true });
s.onMessage = (ev) => console.log(ev.type, ev.data);
```

## GitHub utility routes

### `githubScopes()`
Reachable GitHub scopes. **`GET /api/v2configs/github/scopes`**
- Returns: `{ configured, scopes }`

### `githubValidate({ url })`
Validate a repo URL, return canonical metadata. **`GET /api/v2configs/github/validate`**
- Returns: `{ valid, repo?, error? }`

### `githubSearch({ scope, container, q? })`
Search repos, annotated `imported`. **`GET /api/v2configs/github/search`**
- Returns: `{ configured, repos }`

### `githubProbe({ owner, repo })`
Probe every token against one repo. **`GET /api/v2configs/github/probe`**
- Returns: `{ owner, repo, configured, results }`

### `githubImport({ container, owner?, repo?, manual?, name?, displayName? })`
Import a repo (or create a manual service). **`POST /api/v2configs/github/import`**
- Returns: `{ name, serviceName, importedEnvFile, imageNameSource }` (409 if name taken)
```js
await sdk.deploy.githubImport({ container: 'app1', owner: 'backvco', repo: 'app1-api' });
```

## Identity / IAM catalogs

### `identitiesCatalog()`
Permission-DSL service/verb catalog. **`GET /api/v2configs/identities/catalog`**
- Returns: `{ aws }`

### `identitiesIamCatalog({ op?, service? })`
Full AWS IAM action universe; `op`=`services`|`actions`|`resource-types`. **`GET /api/v2configs/identities/iam-catalog`**
- Returns: `{ services }` | `{ actions }` | `{ resourceTypes }`
```js
const { actions } = await sdk.deploy.identitiesIamCatalog({ op: 'actions', service: 's3' });
```

### `validatePolicy({ permissions })`
Compile DSL → IAM policy + AccessAnalyzer findings. **`POST /api/v2configs/identities/validate-policy`**
- Returns: `{ policy, findings, bytes, byteLimit, error? }`

### `validateGcpManifest({ manifest, accountId? })`
Validate a GCP identity manifest (schema + optional live check). **`POST /api/v2configs/identities/validate-gcp-manifest`**
- Returns: `{ ok, errors, warnings }`

## CIDR check

### `cidrCheck({ cidr, excludeBundle?, excludeSubnetId?, branch? })`
Overlap check against every known network. **`POST /api/v2configs/networks/cidr-check`** (`branch` via query)
- Returns: `{ cidr, overlaps, totalKnown }`
```js
const { overlaps } = await sdk.deploy.cidrCheck({ cidr: '10.20.0.0/16' });
```
