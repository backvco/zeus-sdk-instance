# Replication

`sdk.replication` — replication board reads and planned MySQL primary moves.

## Reads

### `discover(container)`
Config-only set list. **`POST /api/v2configs/replication/mysql`** `{ action: "discover" }`

### `status(container, setName)`
Live set status. **`POST /api/v2configs/replication/mysql`** `{ action: "status" }`

### `setMetrics(container, setName, { keys }?)`
Status plus a Prometheus snapshot per member.

### `instanceRoster(container, setName, branch?)`
Per-pod MySQL roster: role (`PRIMARY` / `SECONDARY`), ClusterSet role, state, lag, node, PVE host.
**`POST /api/v2configs/replication/mysql`** `{ action: "instance-roster" }`

### `planClickhouseRebuild(container, setName, targetCluster)`
Read-only ClickHouse rebuild plan. **`POST /api/v2configs/replication/clickhouse`**

## Planned primary moves

### `previewMysqlSetPrimary({ container, clusterName, namespace, name, idx })`
Read-only. Safe to confirm only when the pod is a secondary, `ONLINE`, caught up (applier queue 0), and on a different Proxmox host (k3s) or node.
**`POST /api/v2configs/:container/infrastructure/mysql-recovery`** `{ action: "set-primary-instance-preview" }`

### `previewLostNodeRelease({ container, clusterName, namespace, name })`
Read-only. `plan.safeToApply` is true only when the other Group Replication members hold quorum and the node is confirmed down (Node Unknown, or host-down). A reachable host is refused. Nothing is deleted.
**`POST /api/v2configs/:container/infrastructure/mysql-recovery`** `{ action: "release-lost-node" }`

### `releaseLostNodePods({ container, clusterName, namespace, name, confirm, planHash })` — streaming
Apply the preview. `confirm` must equal `name`. `planHash` is the preview token. The server re-checks and refuses when the plan is stale or the host is reachable.
**`POST /api/v2configs/:container/infrastructure/mysql-recovery`** `{ action: "release-lost-node", dryRun: false, confirm, planHash }`

### `setMysqlPrimaryInstance({ container, clusterName, namespace, name, idx, confirmMember })` — streaming
Promote that member. `confirmMember` must equal `` `${name}-${idx}` ``. The server re-checks the preview and refuses when it is not safe.
**`POST /api/v2configs/:container/infrastructure/mysql-recovery`** `{ action: "set-primary-instance" }`

### `previewMysqlSwitchover(container, setName, targetCluster)`
Read-only ClusterSet switchover preflight.
**`POST /api/v2configs/replication/mysql`** `{ action: "preflight", opAction: "switchover" }`

### `switchoverMysql({ container, setName, targetCluster, execute?, confirmSetName?, branch? })` — streaming
ClusterSet switchover. Dry-run unless `execute: true`. When `execute` is true, `confirmSetName` is required and must equal `setName`; the method rejects before the request otherwise, and the server returns 400 if it does not match. Preflight runs again on the server.
**`POST /api/v2configs/replication/mysql/action`** `{ action: "switchover", execute, confirmSetName }`
