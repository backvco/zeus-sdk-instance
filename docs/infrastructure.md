# `sdk.infrastructure` — InfrastructureService

Helm / EKS-managed / zeus-managed addon lifecycle on a container's clusters.

An *addon* is a 3rd-party workload Zeus installs onto a cluster: a Helm chart
(Prometheus, NATS, NetBird, MySQL/PG/ClickHouse operators…), an AWS EKS-managed
addon (vpc-cni, coredns, EBS/EFS/S3 CSI…), or a zeus-managed deployment (the
mesh webhook). This service edits the addon *definitions* and drives the live
install/upgrade/uninstall lifecycle.

Every method is **container-scoped** — the first param is always `container`.
Read endpoints accept an optional `branch` (defaults to `'main'` server-side).
Streaming methods return a stream handle (async-iterable +
`onMessage/onDone/onError/close()`).

Two sub-namespaces:
- [`sdk.infrastructure.backups`](#sdkinfrastructurebackups) — backup browsing + manual ops
- [`sdk.infrastructure.rotate`](#sdkinfrastructurerotate) — DB credential rotation

---

## Addon definitions

| Method | Route | Returns |
|---|---|---|
| `list({ container, branch? })` | `GET /infrastructure` | `{ addons }` |
| `save({ container, name, data, branch? })` | `POST /infrastructure` | `{ addon }` |
| `get({ container, name, branch? })` | `GET /infrastructure/[name]` | `{ addon }` |
| `update({ container, name, data, branch?, baseRev? })` | `PUT /infrastructure/[name]` — requires `baseRev` (defaults from `data._rev`; `null` = first per-container write; mismatch → 409 `stale-save`) | `{ addon }` |
| `mutate({ container, name, branch?, retries? }, fn)` | read-mutate-write with stale-save CAS retry; handles root-catalog fallback (`_ownContainer`) and strips read-time decorations | `{ addon }` |
| `remove({ container, name, branch? })` | `DELETE /infrastructure/[name]` | `{ success: true }` |

```js
const { addons } = await sdk.infrastructure.list({ container: 'app1' });
await sdk.infrastructure.save({ container: 'app1', name: 'nats', data: {/* def */} });
```

## Status

### `status({ container, clusterName, kubeContext?, environmentName?, addonName?, targetNamespace?, branch? })`
`POST /infrastructure/status` — installed/health status for every addon on a
cluster (folds in real pod health). Optionally runs an install preflight for one
`addonName` + `targetNamespace`.
Returns `{ addons, helmAvailable, eksAvailable, accessDenied, accessHint?, clusterRegion?, clusterArn?, clusterAccountId?, preflight? }`.

```js
const s = await sdk.infrastructure.status({ container: 'app1', clusterName: 'z-01' });
```

### `statusResources({ container, clusterName, namespace, releaseName?, type? })`
`GET /infrastructure/status` — live pods (default) or PVCs (`type: 'pvcs'`) for a
release. Returns `{ pods }` or `{ pvcs, storageClasses }`.

### `createNamespace({ container, clusterName, namespace, branch? })`
`PUT /infrastructure/status` — create a namespace (tunnel-aware for k3s).
Returns `{ success: true, namespace }`.

## EKS-managed addons

### `describeEksAddon({ container, addonName, clusterName, branch? })`
`POST /infrastructure/eks-addon` (`action: 'describe'`) — synchronous read.
Returns `{ result, action }`.

### `eksAddonStream({ container, action, addonName, clusterName, version?, configurationValues?, provisionerConfig?, branch? })` — **streaming**
`POST /infrastructure/eks-addon` — mutating actions `create` | `update` |
`reapply` | `delete`. Emits `progress.*` events; final `done`
`{ result, action, metadata, postInstall, serviceAccountRoleArn, error? }`.

```js
const stream = sdk.infrastructure.eksAddonStream({
  container: 'app1', action: 'create', addonName: 'aws-efs-csi-driver', clusterName: 'z-01'
});
stream.onDone((r) => console.log(r));
```

## Helm lifecycle

### `helm({ container, action, addonName, ... })`
`POST /infrastructure/helm` — synchronous JSON (NOT a stream). Dispatches on
`action`: `install`, `upgrade`, `rollback`, `uninstall`, `unstick`,
`force-remove`, `status`, `values`, `history`, `manifest`, `render`, `save`,
`revert`, `restart`, `resize-pvc`, `delete-pvcs`, `ingress-transport-check`.
Tunnel-aware (k3s). Response shape is action-dependent; install/upgrade ≈
`{ result, action, rollout?, reachability?, warnings? }`.

Optional body fields: `clusterName`, `kubeContext`, `values`, `version`,
`revision`, `targetNamespace`, `targetReleaseName`, `environmentName`,
`deploymentName`, `liveOnly`, `pvcName`, `newSize`, `pvcNames`, `deletePvcs`
(uninstall/force-remove — also delete the release's PVCs, default false),
`deleteCrds` (uninstall only — default true; force-remove never touches CRDs),
`purgeExtras` (uninstall/force-remove — also purge keep-policy secrets/
out-of-band resources, default false), `backupProfile`, `restoreProfile`,
`acknowledgeReachabilityCritical`, `branch`.

**412 acknowledgement:** for a `reachabilityCritical` addon (e.g.
`netbird-management`), a mutating action without
`acknowledgeReachabilityCritical: true` returns HTTP 412 `requiresAcknowledgement`
— the SDK transport throws `ReachabilityAckRequiredError` automatically. Catch it
and re-call with `acknowledgeReachabilityCritical: true`. Mutating actions hold a
release-scoped lock and may throw HTTP 409 if the release is locked.

```js
import { ReachabilityAckRequiredError } from 'zeus-sdk-instance';
try {
  await sdk.infrastructure.helm({ container: 'app1', action: 'install', addonName: 'nats', clusterName: 'z-01', values: {} });
} catch (e) {
  if (e instanceof ReachabilityAckRequiredError) {
    await sdk.infrastructure.helm({ /* …same… */ acknowledgeReachabilityCritical: true });
  } else throw e;
}
```

## Rollout

### `rolloutStatus({ container, clusterName, namespace, releaseName, branch? })`
`GET /infrastructure/rollout` — a release's StatefulSets with rollout status.
Returns `{ statefulSets, needsRollout, pendingCount }`.

### `rollout({ container, clusterName, namespace, statefulSets, branch? })` — **streaming**
`POST /infrastructure/rollout` — sequentially restart the named StatefulSets
(one pod at a time, waiting for Ready). Final `done`
`{ ok, restarted, message, error? }`.

## Metrics / network / versions

### `metricsStream({ container, clusterName, addonName, namespace, releaseName, range?, branch? })` — **streaming**
`GET /infrastructure/metrics` — Prometheus metrics for a release. Emits named
events `status`, `metric`, `error`, `complete`, `refresh` (every ~30s). `range`
∈ `1h` | `6h` | `24h` | `7d` (default `1h`). (`clusterName`→`cluster`,
`addonName`→`addon` query params.)

### `clusterNetwork({ container, clusterName, branch? })`
`GET /infrastructure/cluster-network` — `{ podCIDR, serviceCIDR }`.

### `versions({ container, addonName, clusterName?, branch? })`
`POST /infrastructure/versions` — available versions (helm repo search /
OCI/local pinned / EKS-addon versions; `clusterName` required for eks-addons).
Returns `{ versions: [{ version, appVersion?, description? }], addonName }`.

### `zeusManaged({ container, addonName, clusterName })`
`POST /infrastructure/zeus-managed` — install/reconcile a zeus-managed addon
(currently `zeus-mesh-webhook`). Returns `{ ok: true, applied }`.

## Operations / upgrade steps

### `operation({ container, action, ... })`
`POST /infrastructure/operations` — `action`: `list-pods`, `exec`, `verify`
(port-forward GET), `delete-pod`, `run-operation`. Returns action-dependent JSON
(`{ pods }`, `{ success, output }`, `{ success, results, operation }`).
The pod-container body field is passed as `container_` (the path `container` is
the workspace).

### `upgradeStep({ container, action, addonName, clusterName, fromVersion?, stepId?, kubeContext?, branch? })`
`POST /infrastructure/upgrade-step` — `action: 'list'` → `{ steps }`;
`action: 'apply'` (needs `stepId`) → `{ ok, results, errors }` (synchronous JSON,
HTTP 207 on partial failure).

---

## `sdk.infrastructure.backups`

Backup browsing + manual operations. Backups land in S3 via an environment
"backup profile" (bucket + creds). Container-scoped.

| Method | Route | Returns |
|---|---|---|
| `list({ container, environmentName, profileName, addonName?, clusterName?, releaseName?, branch? })` | `GET /infrastructure/backups` | scan summary or backup list |
| `trigger({ container, addonName, environmentName, clusterName, deploymentName? })` | `POST /infrastructure/backups/trigger` | `{ success, jobName, addonName, releaseName, namespace, type, message }` |
| `backfill({ container, environmentName?, branch? })` | `POST /infrastructure/backups/backfill` | `{ written, skipped, errors, summary }` |
| `rotateCredentials({ container, addonName, environmentName, clusterName, deploymentName? })` | `POST /infrastructure/backups/rotate-credentials` | `{ success, releaseName, namespace, message }` |

`list` with no `addonName`/`clusterName` scans ALL backup sources in the
environment; with both, lists that one deployment's backups. `rotateCredentials`
is `mysql-innodbcluster`-only. Returns synchronous JSON.

```js
const all = await sdk.infrastructure.backups.list({ container: 'app1', environmentName: 'prod', profileName: 'default' });
await sdk.infrastructure.backups.trigger({ container: 'app1', addonName: 'postgresql-cluster', environmentName: 'prod', clusterName: 'z-01' });
```

---

## `sdk.infrastructure.rotate`

DB/addon credential rotation — per deployment (addon + env + cluster +
deployment), **one credential ("role") per run**. Container-scoped.

Lifecycle: `roles` → `preflight` → `run` (stream) → `history`. Crash recovery:
`listOrphans` → `discard` | `recover` (stream).

| Method | Route | Returns |
|---|---|---|
| `roles({ container, addonName, environmentName, clusterName, deploymentName })` | `POST /infrastructure/rotate/roles` | `{ roles }` |
| `preflight({ ...same, roles })` | `POST /infrastructure/rotate/preflight` | `{ checks, orderValid, orderError }` |
| `run({ ...same, roles })` — **streaming** | `POST /infrastructure/rotate/rotate` | stream → `done { ok, completed, failed, newPasswords?, runId }` |
| `attach({ container, runKey })` — **streaming** | `GET /infrastructure/rotate/rotate?runKey=` | stream (reattach) |
| `history({ container, addonName, environmentName, clusterName, runId? })` | `GET /infrastructure/rotate/history` | `{ runs }` or `{ runId, events }` |
| `listOrphans({ container })` | `GET /infrastructure/rotate/recover` | `{ orphans }` |
| `discard({ container, runId })` | `POST /infrastructure/rotate/recover` (`action: discard`) | `{ ok, discarded }` |
| `recover({ container, runId })` — **streaming** | `POST /infrastructure/rotate/recover` (`action: resume`) | stream → `done { ok, resumedFrom, completed, failed, runId }` |

`run` throws HTTP 409 if a rotation for the same deployment is already in
flight; `attach` throws HTTP 404 if the runKey is unknown. The runKey shape is
`rotate:<container>:<env>:<cluster>:<addon>:<deployment>`.

```js
const { roles } = await sdk.infrastructure.rotate.roles({ container: 'app1', addonName: 'mysql-innodbcluster', environmentName: 'prod', clusterName: 'z-01', deploymentName: 'primary' });
const stream = sdk.infrastructure.rotate.run({ container: 'app1', addonName: 'mysql-innodbcluster', environmentName: 'prod', clusterName: 'z-01', deploymentName: 'primary', roles: ['root'] });
stream.onDone((r) => console.log(r));
```
