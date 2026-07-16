# `sdk.clusters` — ClustersService

Kubernetes clusters (EKS, GKE, k3s) within a container. The largest namespace in
the SDK: core lifecycle + inspect methods live on `sdk.clusters`, with seven
sub-namespaces hanging off it.

Every method takes a single destructured object. `container` + `name` (the
cluster name) are the path scope. Methods whose route reads `?branch=` accept an
optional `branch` (default `'main'` server-side; dropped from the query when
undefined). **Streaming** methods return an SSE stream handle (async-iterable +
`onMessage`/`onDone`/`onError` + `close()`); the route's terminal `done` event
carries the documented payload. A `409 { error, inFlight }` means a run is already
in progress (reattach to the existing stream).

```js
const { clusters } = await sdk.clusters.list({ container: 'app1' });
const s = sdk.clusters.provision({ container:'app1', name:'z-05', subnetIds:['subnet-a'] });
for await (const ev of s) console.log(ev);
```

## Core — collection (`sdk.clusters`)

| Method | Route | Returns |
|---|---|---|
| `list({ container, branch })` | `GET /clusters` | `{ clusters }` |
| `create({ container, name, data, branch })` | `POST /clusters` | `{ cluster }` |
| `get({ container, name, branch })` | `GET /clusters/[name]` | `{ cluster }` |
| `update({ container, name, data, branch })` | `PUT /clusters/[name]` | `{ cluster }` |
| `delete({ container, name, branch })` | `DELETE /clusters/[name]` | `{ success: true }` |
| `importList({ container, region, clusterName, branch })` | `GET /clusters/import` | `{ region, clusters }` or `{ preview }` |
| `import({ container, branch, ...body })` | `POST /clusters/import` | `{ cluster, message }` |
| `activeBuilds({ container })` | `GET /clusters/active-builds` | `{ builds }` |
| `failedBuilds({ container, branch })` | `GET /clusters/failed-builds` | `{ builds }` |
| `failedBuildLog({ container, id, log, branch })` | `GET /clusters/failed-builds?id&log` | **SSE** log replay |
| `removeFailedBuild({ container, id, branch })` | `DELETE /clusters/failed-builds` | `{ removed }` |
| `drift({ container, branch })` | `GET /clusters/drift` | `{ clusters, summary }` |
| `diff({ container, base, target, branch })` | `GET /clusters/diff` | `{ base, target, groups, summary }` |
| `applyDiff({ container, base, target, rows, branch })` | `POST /clusters/diff` | `{ cluster, applied, skipped, scaffolded }` |

`import` body: EKS `{ region, clusterName, name? }`; GKE `{ provider:'gke', accountId, project, location, clusterName, name? }`.

## Core — single cluster (`sdk.clusters`, inherited from ClustersCoreService)

| Method | Route | Returns |
|---|---|---|
| `metadata({ container, name, refresh, branch })` | `GET /[name]/metadata` | `{ metadata }` |
| `endpoints({ container, name, branch })` | `GET /[name]/endpoints` | `{ endpoints }` |
| `bootstrapStatus({ container, name, branch })` | `GET /[name]/bootstrap-status` | `{ reachable, missing, error }` |
| `pods({ container, name, namespace, branch })` | `GET /[name]/pods` | `{ pods }` |
| `primarySg({ container, name, branch })` | `GET /[name]/primary-sg` | `{ sg }` |
| `setPrimarySgRule({ container, name, action, direction, rule, branch })` | `POST /[name]/primary-sg` | `{ sg, ok }` |
| `dns({ container, name, branch })` | `GET /[name]/dns` | `{ dnsAlias, target, zone, inSync, wildcard, ... }` |
| `dnsAction({ container, name, action })` | `POST /[name]/dns` | `{ preflight, zone }` or `{ result }` |
| `hydrateMetadata({ container, name, branch })` | `POST /[name]/hydrate-metadata` | `{ cluster, additions }` |
| `nodeGroupArchs({ container, name })` | `GET /[name]/node-group-archs` | `{ archs, default }` |
| `storageClasses({ container, name })` | `GET /[name]/storage-classes` | `{ storageClasses }` |
| `applyStorageClasses({ container, name, branch })` | `POST /[name]/storage-classes/apply` | `{ success, results, note? }` |
| `storageClassesDiff({ container, name, all, branch })` | `GET /[name]/storage-classes/diff` | `{ entries }` |
| `provision({ container, name, branch, ...body })` | `POST /[name]/provision` | **SSE** |
| `provisionDraft({ container, name, branch, ...body })` | `POST /[name]/provision-draft` | **SSE** |
| `destroyPreview({ container, name, preflight, branch })` | `GET /[name]/destroy` | `{ steps, warnings }` or `{ preview, vpcBundle }` |
| `destroy({ container, name, branch, ...body })` | `POST /[name]/destroy` | **SSE** (`confirm` must equal cluster name) |

`dnsAction` action: `'preflight' | 'apply' | 'apply-wildcard'`.
`provision` body: `roleArn, createRole, subnetIds, securityGroupIds, addons, vpcIngressCidr, vpcBundle, rollbackOnFailure` (+ GKE network fields).
`destroy` body (EKS/GKE): `confirm, force, unmanageOnly, dropJsonOnSuccess, deleteSelections, destroyVpcBundle`; k3s: `confirm, deleteSelections`.

## `sdk.clusters.nodegroups` — ClusterNodegroupsService

Managed node groups, Karpenter NodePools, and k3s node groups.

| Method | Route | Returns |
|---|---|---|
| `plan({ container, name, ngName, mode, branch })` | `POST /[name]/nodegroups/plan` | `{ plan }` — `mode:'rebalance'` (k3s/Proxmox) returns `{ counts, moves, warnings, className, eligibleHosts }` |
| `apply({ container, name, ngName, planHash, mode, expectedMoves, branch })` | `POST /[name]/nodegroups/apply` | **SSE** `done {status}` — `mode:'rebalance'` requires `expectedMoves` from the rebalance plan |
| `destroy({ container, name, ngName, branch })` | `POST /[name]/nodegroups/destroy` | **SSE** `done {status,summary}` |
| `drift({ container, name, branch })` | `GET /[name]/nodegroups/drift` | `{ cluster, items }` |
| `workload({ container, name, ngName })` | `GET /[name]/nodegroups/[ngName]/workload` | `{ cluster, ng, nodes, pods }` |
| `live({ container, name, ngName, branch })` | `GET /[name]/nodegroups/[ngName]/live` | `{ ng, cluster, live, drift }` |
| `cancelOperation({ container, name, ngName, force, branch })` | `POST /[name]/nodegroups/[ngName]/cancel-operation` | `{ ng, cluster, cancelled, forced?, deletedMigs? }` (GKE only; `force` deletes MIGs for non-upgrade ops) |
| `azScope({ container, name, ngName, subnetIds, branch })` | `POST /[name]/nodegroups/[ngName]/az-scope` | **SSE** `done {status}` |
| `poolPlan({ container, name, poolName, branch })` | `POST /[name]/nodepools/plan` | `{ plan }` |
| `poolApply({ container, name, poolName, planHash, branch })` | `POST /[name]/nodepools/apply` | **SSE** |
| `poolDestroy({ container, name, poolName, force, drain, branch })` | `POST /[name]/nodepools/destroy` | **SSE** |
| `poolDrift({ container, name, branch })` | `GET /[name]/nodepools/drift` | `{ cluster, items }` |
| `poolImportList({ container, name, branch })` | `GET /[name]/nodepools/import` | `{ cluster, items }` |
| `poolImport({ container, name, poolNames, branch })` | `POST /[name]/nodepools/import` | `{ imported, warnings, cluster }` |
| `poolWorkload({ container, name, poolName })` | `GET /[name]/nodepools/[poolName]/workload` | `{ cluster, pool, nodes, pods }` |
| `poolLive({ container, name, poolName, branch })` | `GET /[name]/nodepools/[poolName]/live` | `{ pool, cluster, live }` |
| `poolImpact({ container, name, poolName, branch })` | `GET /[name]/nodepools/[poolName]/impact` | `{ cluster, pool, ...impact }` |
| `k3sAction({ container, name, action, ...fields })` | `POST /[name]/k3s-nodegroups` | **SSE** |
| `k3sStatus({ container, name, detail })` | `GET /[name]/k3s-nodegroups/status` | `{ items, reachable }` or `{ members, ..., quorum }` |
| `k3sLogs({ container, name, server, lines })` | `GET /[name]/k3s-nodegroups/logs` | `{ ok, unit:'k3s', lines }` (409 `agent-update-required`) |
| `k3sSyncStatus({ container, name })` | `GET /[name]/k3s-nodegroups/sync` | `{ reachable, inSync, orphans, ghosts, healthy }` |
| `k3sSync({ container, name, decisions })` | `POST /[name]/k3s-nodegroups/sync` | **SSE** |
| `k3sWorkload({ container, name, ngName })` | `GET /[name]/k3s-nodegroups/[ngName]/workload` | `{ cluster, ng, nodes, pods }` |

`k3sAction` actions: `scale-control-plane, reconcile-dns, set-autostart, forget-group, set-control-plane-ha, replace-control-plane-member, restart-control-plane-member, apply-control-plane` (+ per-action fields `targetCount, preferredIps, groupName, autoStart, haGroup, spread, force, vmName, applyHa, confirmQuorumRisk`). `restart-control-plane-member` 409s `{ code:'QUORUM_RISK', quorum }` unless `confirmQuorumRisk:true` when the control plane has zero etcd fault margin. `k3sStatus` `detail:'control-plane'` switches to member-level (each member carries `supportsLogs`/`supportsRestart`). `workload`/`poolWorkload` do NOT read `branch`.

## `sdk.clusters.security` — ClusterSecurityService

| Method | Route | Returns |
|---|---|---|
| `accessEntries({ container, name, branch })` | `GET /[name]/access-entries` | `{ authMode, selfPrincipalArn, policies, entries }` |
| `grantAccess({ container, name, principalArn, policy, branch })` | `POST /[name]/access-entries` (branch in query) | `{ success, ... }` |
| `revokeAccess({ container, name, principalArn, branch })` | `DELETE /[name]/access-entries` (branch in query) | `{ success, ... }` |
| `securityGroups({ container, name, branch })` | `GET /[name]/security-groups` | `{ plan, lastSyncedAt }` |
| `applySecurityGroups({ container, name, branch })` | `POST /[name]/security-groups` (branch in body) | `{ ok, plan, lastSyncedAt, applied }` |
| `securityGroup({ container, name, groupId, branch })` | `GET /[name]/sg/[groupId]` | `{ sg }` |
| `createNodeRole({ container, name, roleName, attachSsm, additionalPolicyArns, description, branch })` | `POST /[name]/iam/create-node-role` | `{ roleArn, roleName, attached, alreadyExisted, validation }` |
| `discoverNodeRole({ container, name, consumer, branch })` | `GET /[name]/iam/discover-node-role` | `{ roleArn, source, steps }` |
| `validateRole({ container, name, roleArn, consumer })` | `POST /[name]/iam/validate-role` | `{ valid, consumer, exists, trustPolicyOk, requiredPolicyStatus, ssmAttached, issues }` |
| `attachSsm({ container, name, ngName, roleArn, branch })` | `POST /[name]/iam/attach-ssm` (branch in body) | `{ ok, ssm }` |
| `zeusCapabilities({ container, name, prefix, branch })` | `GET /[name]/iam/zeus-capabilities` | `{ scope, principal, canCreateZeusRole, canCreateAnyRole, account, expansion }` |

`consumer`: `'managed-ng' | 'auto-mode' | 'self-managed'`.

## `sdk.clusters.upgrade` — ClusterUpgradeService

| Method | Route | Returns |
|---|---|---|
| `preflight({ container, name, targetVersion, branch })` | `GET /[name]/upgrade/preflight` | preflight result object |
| `start({ container, name, targetVersion, acknowledgeIrreversible, forceDrain })` | `POST /[name]/upgrade/start` | **SSE** (session id in `x-upgrade-session-id` header + first event) |
| `status({ container, name, refresh, targetVersion, branch })` | `GET /[name]/upgrade/status` | `{ clusterName, region, currentVersion, platformVersion, versionStatus, addonPlan }` |
| `sessions({ container, name })` | `GET /[name]/upgrade/sessions` | `{ sessions }` |
| `session({ container, name, id })` | `GET /[name]/upgrade/session/[id]` | full session object |

`start` is gated server-side by env `ZEUS_ALLOW_UPGRADE=1`.

## `sdk.clusters.storage` — ClusterStorageService

S3, EFS, GCS, Filestore. Create/delete STREAM; update/rename/lifecycle return JSON.
Every route reads `?branch=`. For create methods pass `resourceName` (the new
resource's friendly name → body `name`).

| Method | Route | Returns |
|---|---|---|
| `s3Buckets({ container, name, branch })` | `GET /[name]/s3-buckets` | `{ buckets }` |
| `createS3Bucket({ container, name, branch, resourceName, ...rest })` | `POST /[name]/s3-buckets` | **SSE** `done {name,bucketName}` |
| `updateS3Bucket({ container, name, bucketName, branch, ...rest })` | `POST /[name]/s3-buckets/[bucketName]` | `{ success, updates }` |
| `deleteS3Bucket({ container, name, bucketName, branch })` | `DELETE /[name]/s3-buckets/[bucketName]` | **SSE** `done {destroyed,bucketName}` |
| `renameS3Bucket({ container, name, bucketName, newName, branch })` | `POST /[name]/s3-buckets/[bucketName]/rename` | `{ success, bucketName, name }` |
| `s3IamUser({ container, name, purpose, bucketName, branch })` | `GET /[name]/s3-iam-users` | `{ userName, exists, keys }` |
| `s3IamUserAction({ container, name, branch, ...body })` | `POST /[name]/s3-iam-users` | action result (`generate-keys`/`sync-policy`) |
| `efsDiscover({ container, name, branch })` | `GET /[name]/efs-discover` | `{ fileSystemId, lifeCycleState, changes, reconciled }` |
| `efsFilesystems({ container, name, branch })` | `GET /[name]/efs-filesystems` | `{ filesystems }` |
| `createEfsFilesystem({ container, name, branch, resourceName, ...rest })` | `POST /[name]/efs-filesystems` | **SSE** `done {name,fileSystemId}` |
| `updateEfsFilesystem({ container, name, fsName, branch, ...rest })` | `POST /[name]/efs-filesystems/[fsName]` | `{ success, policies }` |
| `deleteEfsFilesystem({ container, name, fsName, branch })` | `DELETE /[name]/efs-filesystems/[fsName]` | **SSE** `done {fsName,destroyed}` |
| `renameEfsFilesystem({ container, name, fsName, newName, branch })` | `POST /[name]/efs-filesystems/[fsName]/rename` | `{ success, fileSystemId, name }` |
| `efsLifecycle({ container, name, branch })` | `GET /[name]/efs-lifecycle` | `{ found, fileSystemId, live, desired }` |
| `setEfsLifecycle({ container, name, branch, ...body })` | `POST /[name]/efs-lifecycle` | `{ success, policies }` |
| `gcsBuckets({ container, name, branch })` | `GET /[name]/gcs-buckets` | `{ buckets }` |
| `createGcsBucket({ container, name, branch, resourceName, ...rest })` | `POST /[name]/gcs-buckets` | **SSE** `done {name,bucketName}` |
| `updateGcsBucket({ container, name, bucketName, branch, ...rest })` | `POST /[name]/gcs-buckets/[bucketName]` | `{ success, updates }` |
| `deleteGcsBucket({ container, name, bucketName, branch })` | `DELETE /[name]/gcs-buckets/[bucketName]` | **SSE** `done {destroyed,bucketName}` |
| `renameGcsBucket({ container, name, bucketName, newName, branch })` | `POST /[name]/gcs-buckets/[bucketName]/rename` | `{ success, bucketName, name }` |
| `gcsServiceAccount({ container, name, purpose, bucketName, branch })` | `GET /[name]/gcs-service-accounts` | `{ userName, exists, keys, policy }` |
| `gcsServiceAccountAction({ container, name, branch, ...body })` | `POST /[name]/gcs-service-accounts` | action result |
| `filestoreInstances({ container, name, branch })` | `GET /[name]/filestore-instances` | `{ instances }` |
| `createFilestoreInstance({ container, name, branch, resourceName, ...rest })` | `POST /[name]/filestore-instances` | **SSE** `done {name,instanceId,ipAddress}` |
| `deleteFilestoreInstance({ container, name, fsName, branch })` | `DELETE /[name]/filestore-instances/[fsName]` | **SSE** `done {destroyed,instanceId}` |

`s3IamUserAction`/`gcsServiceAccountAction` body: `{ action, purpose, bucketName }` (`action: 'generate-keys' | 'sync-policy'`).

## `sdk.clusters.certs` — ClusterCertsService

| Method | Route | Returns |
|---|---|---|
| `issuers({ container, name, branch })` | `GET /[name]/cert-issuers` | `{ certIssuers }` |
| `applyIssuers({ container, name, certIssuers, branch })` | `POST /[name]/cert-issuers` | `{ success, applied, details, errors }` |
| `saveIssuers({ container, name, certIssuers, branch })` | `PUT /[name]/cert-issuers` | `{ success, certIssuers }` |
| `issuerCreds({ container, name, secretName, namespace, branch })` | `GET /[name]/cert-issuer-creds` | `{ exists, namespace, secretName, accessKeyId? }` |
| `setIssuerCreds({ container, name, branch, ...body })` | `POST /[name]/cert-issuer-creds` | `{ success, namespace, secretName, accessKeyId, rotated }` |
| `issuerGcpCreds({ container, name, secretName, namespace, gcpAccountId, branch })` | `GET /[name]/cert-issuer-gcp-creds` | `{ exists, namespace, secretName, clientEmail, projectId }` |
| `setIssuerGcpCreds({ container, name, branch, ...body })` | `POST /[name]/cert-issuer-gcp-creds` | `{ success, namespace, secretName, projectId, clientEmail }` |
| `issuerIam({ container, name, action, namespace, secretName, branch })` | `GET /[name]/cert-issuer-iam` | action-dependent |
| `manageIssuerIam({ container, name, branch, ...body })` | `POST /[name]/cert-issuer-iam` | `{ success, ... }` |
| `addonsLive({ container, name, branch })` | `GET /[name]/addons-live` | `{ addons }` |

`issuerIam` GET actions: `describe | list-existing | list-all-users | policy-preview`. `manageIssuerIam` POST actions: `create-user | attach-existing | generate-keys`.

## `sdk.clusters.overlay` — ClusterOverlayService

Cross-cluster WireGuard/NetBird mesh. Connectivity-test routes persist results
(GET lists, DELETE removes one). POST/enroll/test routes read `branch` from the
body; GET/DELETE read it from the query.

| Method | Route | Returns |
|---|---|---|
| `status({ container, name, connection, branch })` | `GET /[name]/overlay/status` | `{ persisted, live }` |
| `enroll({ container, name, connection, branch, routerSettings })` | `POST /[name]/overlay/enroll` | **SSE** `done {ok,message,overlay}` |
| `teardown({ container, name, connection, branch })` | `DELETE /[name]/overlay` | **SSE** `done {ok,message,removed}` |
| `access({ container, name, connection, branch })` | `GET /[name]/overlay/access` | `{ access }` |
| `grantAccess({ container, name, ...body })` | `POST /[name]/overlay/access` | `{ ok, policy }` |
| `revokeAccess({ container, name, connection, branch, to, ports })` | `DELETE /[name]/overlay/access` | `{ ok, deleted }` |
| `probe({ container, name })` | `GET /[name]/overlay/probe` | `{ ok, peers }` |
| `dnsTlsTests({ container, name, branch })` | `GET /[name]/overlay/dns-tls-test` | `{ tests }` |
| `runDnsTlsTest({ container, name, ...body })` | `POST /[name]/overlay/dns-tls-test` | **SSE** `done {ok}` |
| `deleteDnsTlsTest({ container, name, id, branch })` | `DELETE /[name]/overlay/dns-tls-test` | `{ deleted }` |
| `diagnostics({ container, name, branch })` | `GET /[name]/overlay/diagnose` | `{ tests }` |
| `runDiagnose({ container, name, ...body })` | `POST /[name]/overlay/diagnose` | **SSE** `done {ok}` |
| `deleteDiagnose({ container, name, id, branch })` | `DELETE /[name]/overlay/diagnose` | `{ deleted }` |
| `speedtests({ container, name, branch })` | `GET /[name]/overlay/speedtest` | `{ tests }` |
| `runSpeedtest({ container, name, ...body })` | `POST /[name]/overlay/speedtest` | **SSE** `done {ok,result}` |
| `deleteSpeedtest({ container, name, id, branch })` | `DELETE /[name]/overlay/speedtest` | `{ deleted }` |
| `ingressHosts({ container, name, branch })` | `GET /[name]/overlay/ingress-hosts` | `{ hosts, meshDomain }` |
| `router({ container, name, branch })` | `GET /[name]/overlay/router` | `{ settings, nodeGroups, ... }` |
| `setRouter({ container, name, ...body })` | `POST /[name]/overlay/router` | `{ ok, settings }` |

`grantAccess` body: `{ to, ports?, protocol?, bidi?, connection?, branch? }`. `runSpeedtest` body: `{ to, mode, value, probes?, srcNodeGroup?, dstNodeGroup?, connection?, branch? }`.

## `sdk.clusters.extras` — ClusterExtrasService

Arch-taint, Harbor, GKE CSI/access, firewall rules.

| Method | Route | Returns |
|---|---|---|
| `archTaintPreflight({ container, name, branch, mode })` | `POST /[name]/arch-taint/preflight` | preflight result |
| `archTaintStart({ container, name, ...body })` | `POST /[name]/arch-taint/start` | **SSE** (409 → `{error,inFlight,runId}`) |
| `archTaintRevert({ container, name, branch, force })` | `POST /[name]/arch-taint/revert` | `{ ok }` |
| `harborReplication({ container, name, branch })` | `GET /[name]/harbor-replication` | `{ registries, policies, proxyCaches, harborUrl }` |
| `harborReplicationAction({ container, name, branch, ...body })` | `POST /[name]/harbor-replication` | action-dependent |
| `harborRobots({ container, name, robotId, project, branch })` | `GET /[name]/harbor-robots` | `{ robots, projects, scan, harborUrl }` or `{ secret }` |
| `harborRobotAction({ container, name, branch, ...body })` | `POST /[name]/harbor-robots` | action-dependent |
| `gkeCsiDrivers({ container, name, branch })` | `GET /[name]/gke-csi-drivers` | `{ drivers }` |
| `enableGkeCsiDriver({ container, name, branch, driver })` | `POST /[name]/gke-csi-drivers` | **SSE** `done {enabled}` |
| `gkeAccess({ container, name, branch })` | `GET /[name]/gke-access` | `{ selfPrincipalArn, policies, entries, projectScoped, project }` |
| `grantGkeAccess({ container, name, branch, member, policy })` | `POST /[name]/gke-access` (branch in body) | `{ success, ... }` |
| `revokeGkeAccess({ container, name, branch, member, principalArn })` | `DELETE /[name]/gke-access` (branch in body) | `{ success, ... }` |
| `applyFirewallRules({ container, name, branch })` | `POST /[name]/firewall-rules` (branch in body, no query) | `{ ok, applied, message? }` |

`harborReplicationAction` / `harborRobotAction` are action-dispatched — pass `action` plus that action's fields (see the route source for the full matrix). `archTaintStart` body: `{ acknowledgeIrreversible, preflightResult, branch?, mode?, archOverrides? }`. `enableGkeCsiDriver` `driver`: `'filestore' | 'gcs'`.
