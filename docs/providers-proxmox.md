# `sdk.providers.proxmox` — Proxmox VE provider

Proxmox is a bare-metal / on-prem provider. Zeus reaches a PVE fleet through a
connector **agent** (`zeus-agent`) that dials out and tunnels the PVE API + a
shell — there is no public PVE endpoint.

`ProxmoxService` instantiates four sub-namespaces:

| Sub-namespace | Class | Covers |
|---|---|---|
| `.accounts` | `ProxmoxAccountsService` | PVE accounts + per-account: templates, storage, host classes/networks, network model, node detail, HA, firewall, edge VMs, UniFi, WAN IP pool, orphans, token rotation |
| `.sites` | `ProxmoxSitesService` | bare-metal sites, enrolled agent hosts, k3s clusters built on them |
| `.clusters` | `ProxmoxClustersService` | k3s cluster lifecycle + per-cluster networking (ingress/IP-pool/DNS/switch-ports/WAN/zones), node discovery, run-cancel |
| `.connect` | `ProxmoxConnectService` | connector enrollment, PVE-token mint, fact discovery, HA rollout |

Streaming methods return an SSE stream handle (from `openStream`): async-iterable
with `onMessage/onDone/onError` callbacks and `close()`. Non-streaming methods
return the route's JSON verbatim (no unwrapping).

---

## `.accounts` — `ProxmoxAccountsService`

### CRUD + verify
| Method | Route | Returns |
|---|---|---|
| `list()` | `GET /providers/proxmox/accounts` | `{ accounts, defaultAccountId }` |
| `create(account)` | `POST /providers/proxmox/accounts` | `{ account }` (full body passed through to upsert) |
| `get({ id })` | `GET /providers/proxmox/accounts/:id` | `{ account }` |
| `update({ id, ...patch })` | `PUT /providers/proxmox/accounts/:id` | `{ account }` |
| `delete({ id, force })` | `DELETE /providers/proxmox/accounts/:id` | `{ ok }` (`force`→`?force=1`) |
| `verify({ id })` | `POST .../verify` | `{ ok, version, release, nodeCount, nodes }` |
| `rotateToken({ id })` | `POST .../rotate-token` | `{ ok, tokenId, hasTokenSecret }` |

### Templates
| Method | Route | Returns |
|---|---|---|
| `buildTemplateOptions({ id })` | `GET .../build-template` | `{ distros, includedPackages, recipeVersion }` |
| `buildTemplate({ id, ... })` **(SSE)** | `POST .../build-template` | `done: { message, templates, failures, shared, arch }` |
| `templates({ id })` | `GET .../templates` | `{ templates, nodes, connectorNodes, noConnectorNodes }` |
| `copyTemplate({ id, name, newName?, targetStorage?, nodes? })` **(SSE)** | `POST .../templates` (action `copy`) | stream |
| `deleteTemplate({ id, name })` | `POST .../templates` (action `delete`) | `{ ok, results }` |
| `relocateTemplate({ id, name, targetNode })` | `POST .../templates` (action `relocate`) | `{ ok, results }` |

### Storage
| Method | Route | Returns |
|---|---|---|
| `storage({ id })` | `GET .../storage` | `{ storages, capabilities, recommendations, dismissedIds }` |
| `storageAction({ id, action, ... })` | `POST .../storage` | action-dispatched (passes whole body). `activate-block-storage` apply is consumed from SSE (below) |
| `activateBlockStorage({ id, storage })` **(SSE)** | `POST .../storage` (`activate-block-storage`) | apply only. Dry-run is `storageAction({ dryRun: true })` |
| `setupOsMirror({ id, node, osDisk, spareDisk, poolStrategy? })` **(SSE)** | `POST .../storage` (`setup-os-mirror-and-partition`) | no dry-run |
| `setupZfsOsMirror({ id, node, osDisk, spareDisk, rootPool, reclaimPools? })` **(SSE)** | `POST .../storage` (`setup-zfs-os-mirror`) | no dry-run |
| `initStoragePool({ id, node, type, name, devices, raidlevel?, filesystem?, addStorage? })` **(SSE)** | `POST .../storage/init-pool` | `done: { ok, name, type, registered }` |

`storageAction` inline actions: `set-default`, `scan`, `list-disks`, `list-bridges`,
`check-mount`, `create`, `update`, `delete`, `smart-detail`, `set-host-role`,
`csi-identity`, `rotate-csi-token`. Delegated (advisor/lifecycle/file-server/shares/
repoint/raid/wizard/network-test) actions include `grow-pool`, `replace-drive`,
`destroy-pool`, `migrate-vm-disks`, `build-file-server`, `build-storage-server`,
`list-drives-enriched`, `wipe-drive`, `storcli-check`, `megacli-create-raid1`, etc.

#### `activate-block-storage`

Re-converges the LIO target behind an LVM-over-iSCSI Proxmox storage, then logs
every PVE node into that target. A re-run whose target, LUN, portal, and ACLs
already match does not install packages, recreate portals, or `saveconfig`.

The MCP tool `activate_block_storage` previews with `dryRun: true`. That call
is the JSON dry-run below: the same planner as apply, no target writes, and
nodes are not logged in. `confirm` is not required for the preview. A live
apply still requires `confirm` equal to the storage id and streams
`activateBlockStorage({ id, storage })`. The action is not ACL-add only — it
re-asserts the target and logs every node in, which can disrupt a live SAN.
The tool returns a run id; poll `get_operation_status`. Do not start a second
activation while one is running. OS-mirror dry-run is still refused.

`storageAction` is the SDK call that can preview. It treats this action specially:

| Call | Transport | Resolves with |
|---|---|---|
| `dryRun: true` or `dryRun: 'true'` | JSON `POST` | the dry-run report (nothing is applied, nodes are not logged in) |
| otherwise | SSE apply, read to completion | the terminal `done` payload |

`onProgress(ev)` receives `info` / `step` / `warn` / `success` frames (`ev.type`,
`ev.message`). `onProgress` and `signal` are client options and are not posted.
Pass them beside an explicit `body`. An `error` frame rejects with
`ActivateBlockStorageError` (`err.message`, `err.event`). HTTP 400 (confirm
phrase) and 409 (an activation is already running) happen before the stream
opens and reject with `ZeusStreamError` (`err.status`, `err.body`), with
`err.message` set from the route's `error` string. Dry-run errors are the
normal JSON error (`ZeusApiError`), including HTTP 422 when the agent cannot
probe.

```js
const plan = await sdk.providers.proxmox.accounts.storageAction({
  id: 'acc1',
  action: 'activate-block-storage',
  storage: 'block-vms',
  dryRun: true,
  pruneStaleAcls: true
});

const done = await sdk.providers.proxmox.accounts.storageAction({
  id: 'acc1',
  action: 'activate-block-storage',
  storage: 'block-vms',
  pruneStaleAcls: true,
  confirm: 'prune stale acls',
  planHash: plan.planHash,
  onProgress: (ev) => console.log(ev.type, ev.message)
});
// done: { type:'done', ok, active, total, unreachable, targetNoop, staleAcls, aclAdds, aclRemoves, applied }
```

**Dry-run.** Returns JSON, not SSE. `commands` and `steps` are the plan.
`apply` does not run. Login/rescan is described as `would-run` and is not
executed. `pruneStaleAcls: true` on a dry-run does **not** need `confirm`;
stale ACLs show up as `acl-remove` steps and in `aclRemoves` / `staleAcls`
when removal would be allowed. `noop: true` with empty `commands` means a
re-run would not change the target.

**Idempotent re-run.** The target host is probed read-only (configfs). Apply
runs only when the plan has commands. A matching target is a no-op: no
`apt-get`, no portal delete/create, no ACL rewrite, no `saveconfig`. The
apply `done` payload then has `targetNoop: true` and `applied: false`. The
login pass still runs on a real apply (not on dry-run). `targetcli` missing
while the probed state already matches does not install it.

**Stale ACL pruning** is opt-in. Set `pruneStaleAcls: true`. On apply (not
dry-run) also set `confirm` to `prune stale acls` (trim, case-insensitive).
Any other confirm is HTTP 400: `confirm must equal "prune stale acls" to remove initiator ACLs`.
An ACL is stale only when it is a normal initiator IQN (`iqn.YYYY-MM.rev.dns:id`)
and it is not in the live initiator set. Initiator, target, and ACL IQNs match
case-insensitively. Prefix lookalikes (`node1` vs `node10`) are different IQNs.
The dry-run report includes `planHash`. A pruning apply must send that same
`planHash`; if the census or the target changed, the apply is refused and nothing
is deleted.

**Safety refusals** (no ACL delete, and no host script that would delete one):

- Confirm phrase missing or wrong on a pruning apply — HTTP 400, no stream.
- An activation is already running for this storage — HTTP 409 `{ error, inFlight: true }`.
- Initiator census incomplete (`initiator census incomplete; an unread node may still own an ACL`). One unreadable node blocks every delete.
- No live initiator IQNs (`no live initiator IQNs; refusing to treat every ACL as stale`). Creating a target with an empty live set is refused (`No live initiator IQNs; refusing to create a target with an empty ACL`).
- ACL list unreadable, or the target is not present — existing ACLs are not classified as stale and are not removed.
- Unrecognized ACL name (not a normal IQN, including `ALL`) — left in place. The apply builder throws `refusing to remove unrecognized ACL` if a delete is still requested.
- An ACL whose IQN is still in the live set — the builder throws `refusing to remove ACL still in use` before any host call. Comparison is case-insensitive.
- An ACL with an active LIO session (`LIO Session ID:` in its configfs `info` file) is kept. Deleting it would drop that session. The apply script checks that initiator again immediately before its own delete, on every portal group, and skips that delete if a session is active or the `info` file can no longer be read. A skip exits 0, so other stale ACLs in the same run are still removed. A failed check or a failed delete exits non-zero and the rest of the script does not run, so the apply is not reported as applied. The native agent op must do the same per-delete re-check (backvco/zeus-agent-go#33).
- Session state that cannot be read is fail-closed: that ACL is kept, and the step says the session state could not be determined. Other ACLs whose `info` file shows no session can still be removed.
- A target portal group other than `tpgt_1` is reported and blocks every ACL delete. A target with no `tpgt_1` is an incomplete probe, so nothing is changed.
- `planHash` missing on a pruning apply, or different from the plan just computed — the converge is refused. Re-run the dry-run and send the new `planHash`.
- Probe incomplete or target state unknown (`Target probe did not complete; no packages, portals, or ACLs will be changed`). No package install, portal edit, or ACL change.
- On a dry-run, a host agent that supports neither `iscsi-target-probe` / `iscsi-target-apply` nor `exec-v2` returns HTTP 422 with `agentUpdateRequired: true`. The legacy full target setup is not run.
- Extra portals on an existing target are left in place (portal IPs compare as the address before `:`). `0.0.0.0:3260` is deleted only when this run is creating the target.
- Attributes that could not be read are not rewritten. A LUN that is already present keeps its backstore.

### Host classes / networks / network / node detail
| Method | Route | Returns |
|---|---|---|
| `hostClasses({ id })` | `GET .../host-classes` | `{ supported, version, minVersion, nodes, classes }` |
| `hostClassesAction({ id, action, ... })` | `POST .../host-classes` | `save` / `delete` / `reconcile` |
| `hostNetworks({ id, ports? })` | `GET .../host-networks` | `{ hostNetworks, ... }` (`ports`→`?ports=1`) |
| `hostNetworksAction({ id, action, ... })` | `POST .../host-networks` | `save` / `plan` / `confirm` / `delete` / `remap`. `plan` takes `scope`, `rollbackSeconds`, `nodes`, and returns `planId`. `confirm` disarms rollback |
| `hostNetworksStream({ id, action, name, planId?, scope?, rollbackSeconds?, nodes? })` **(SSE)** | `POST .../host-networks` | `apply` requires `planId` from `plan` and forwards `nodes`, `scope`, and `planId`. `teardown` removes the network |

`nodes`, `scope`, `planId`, `rollbackSeconds`, and the other fields the route reads are copied onto the POST body. `nodes` must be an array of non-empty hostnames. Omit it only when the preview really is every member. An empty list, a blank entry, or any option the route does not accept throws `HostNetworkOptionError` and does not send the request — that must not widen into an apply against every host. Assign stream handlers on the handle (`s.onMessage = …`); passing `onMessage` as an argument is an unknown option and throws.

```js
const s = sdk.providers.proxmox.accounts.hostNetworksStream({
  id: 'acc1',
  action: 'apply',
  name: 'vm-data',
  planId,
  scope: 'host',
  nodes: ['indy-prox-009']
});
s.onMessage = (ev) => console.log(ev.data);
s.onDone = () => console.log('finished');
```
| `network({ id })` | `GET .../network` | `{ network, networks, discovered, hostAliases, zeusHost }` |
| `networkAction({ id, action, ... })` | `POST .../network` | `discover` / `save` / `discover-hosts` / `save-hosts` / `save-network` / `delete-network` / `expand-network` |
| `nodeDetail({ id, node })` | `GET .../node-detail?node=` | `{ node, os, cpu, mem, uptime, drives, pveStatus }` |

### HA / firewall / orphans
| Method | Route | Returns |
|---|---|---|
| `ha({ id })` | `GET .../ha` | `{ supported, version, crs, groups, affinityRules, resources, status, vms }` |
| `haAction({ id, action, ... })` | `POST .../ha` | `set-crs`, `create/update/delete-group`, `create/update/delete-affinity`, `enroll`, `unenroll`, `set-resource` |
| `firewall({ id })` | `GET .../firewall` | `{ groups, clusters }` |
| `firewallAction({ id, action, ... })` | `POST .../firewall` | `create-group`, `add-rule`, `delete-rule`, `delete-group` |
| `orphans({ id })` | `GET .../orphans` | `{ orphans }` |
| `destroyOrphans({ id, vmids })` | `POST .../orphans` (action `destroy`) | `{ ok, results }` |

### Edge VMs
| Method | Route | Returns |
|---|---|---|
| `edge({ id })` | `GET .../edge` | `{ edge, routes }` |
| `edgeAction({ id, action, ... })` | `POST .../edge` | `suggest-subnet`, `status`, `failover`, `start-vm`, `stop-vm`, `enable-autostart`, `haproxy-logs`, `reconcile`, `update-ports`, `add-route`, `remove-route`, `sync-routes` |
| `edgeStream({ id, action, ... })` **(SSE)** | `POST .../edge` | `provision` (`done: { ok, edge }`) / `destroy` (needs `confirm:'destroy'`) |

### UniFi (single action-dispatched POST)
| Method | Route | Returns |
|---|---|---|
| `unifi({ id, action, ... })` | `POST .../unifi` | action result (passes whole body) |
| `unifiStream({ id, action, ... })` **(SSE)** | `POST .../unifi` | streaming actions (`host-ports` → `done: { ok, networks }`) |

UniFi actions: `test`, `discover`, `discover-sites`, `drift`, `switches`,
`switch-ports`, `rename-switch`, `tag-port`, `rename-port`, `configure-port`,
`fw-secured`, `fw-standard`, `fw-secure`, `fw-standard-apply`, `fw-unsecure`,
`fw-allow-add`, `fw-allow-remove`, `ingress-list`, `ingress-remove`,
`ingress-hostname-set`, `ingress-fw-check`, `ingress-fw-ensure`,
`ingress-dns-status`, `ingress-dns-apply`, `edge-forward-status`,
`edge-forward-set`, `edge-forward-clear`, `wan-uplinks`, `wan-ip`, `wan-model`,
`wan-sync`, `wan-set-active`, `ddns-providers`, `ddns-list`, `ddns-reconcile`,
`ddns-remove`, `l4-list`, `l4-allocate`, `l4-release`, `dns-records`,
`dns-create`, `dns-delete`, `dns-split-horizon`, `dns-split-horizon-remove`,
`dns-split-horizon-capable`, `networks-full`, `update-network`, `adopt`,
`add-trunk`, `realize`, `unrealize`, `sip-alg-status`, `sip-alg-set`,
`host-ports` *(streaming)*.

```js
const { networks } = await sdk.providers.proxmox.accounts.unifi({ id: 'acc1', action: 'discover' });
await sdk.providers.proxmox.accounts.unifi({ id: 'acc1', action: 'realize', network: 'cluster-net', secure: true });
```

### WAN IP pool
Registry only — does not contact the UniFi controller, and allocate does not claim the address onto a running pod.

| Method | Route | Returns |
|---|---|---|
| `wanIps({ id })` | `GET .../wan-ips` | `{ capacity: { free, allocated, excluded, totalAliases }, free: [{ wanId, ip, manual }], allocations, pools }` |
| `allocateWanIps({ id, container, cluster, envName, serviceName, count?, ips?, branch? })` | `POST .../wan-ips` | `{ allocations, capacity }` |

`count` is how many free addresses to take (ignored by the route when `ips` is set). `ips` is a list of specific free addresses. `branch` defaults to `main` on the server when omitted.

```js
const { capacity, free } = await sdk.providers.proxmox.accounts.wanIps({ id: 'acct-1' });
await sdk.providers.proxmox.accounts.allocateWanIps({
  id: 'acct-1', container: 'app1', cluster: 'z-02',
  envName: 'dev-d00', serviceName: 'sip', count: 1,
});
```

---

## `.sites` — `ProxmoxSitesService`

| Method | Route | Returns |
|---|---|---|
| `list()` | `GET /providers/proxmox/sites` | `{ sites, defaultSiteId, pinnedAgentVersion }` |
| `create({ alias, displayName? })` | `POST /providers/proxmox/sites` | `{ site }` |
| `get({ siteId })` | `GET .../sites/:siteId` | `{ site, pinnedAgentVersion }` |
| `update({ siteId, action?, alias?, displayName? })` | `PUT .../sites/:siteId` | `{ site, defaulted? }` (`action:'set-default'`) |
| `delete({ siteId, force? })` | `DELETE .../sites/:siteId` | `{ ok }` |
| `clusters({ siteId })` | `GET .../sites/:siteId/clusters` | `{ clusters }` |
| `planCluster({ siteId, installerId?, clusterName? })` | `POST .../clusters/plan` | `{ installers, installerId, preflight, servers, agents, steps }` |
| `createCluster({ siteId, clusterName, confirm, installerId?, container? })` **(SSE)** | `POST .../clusters/create` | `done: { message, ...res }` |
| `clusterKubeconfig({ siteId, clusterId })` | `GET .../clusters/:clusterId/kubeconfig` | **YAML text** |
| `clusterNodes({ siteId, clusterId })` | `GET .../clusters/:clusterId/nodes` | `{ nodes }` |
| `clusterPods({ siteId, clusterId })` | `GET .../clusters/:clusterId/pods` | `{ pods }` |
| `clusterStorage({ siteId, clusterId })` | `GET .../clusters/:clusterId/storage` | `{ storageClasses, provisioners, csiStatus }` |
| `clusterStorageAction({ siteId, clusterId, action, name?, namespace?, url? })` | `POST .../clusters/:clusterId/storage` | `set-default` / `pvc-status` / `delete-pvc` / `delete` / `test-csi-url` |
| `clusterStorageInstall({ siteId, clusterId, action?, provisioner?, nfsServer?, nfsPath?, proxmoxStorage?, makeDefault?, overrideUrls?, overrideUrl? })` **(SSE)** | `POST .../clusters/:clusterId/storage/install` | install / `reconfigure-csi` / `reconcile-csi-nodes` |
| `updateHost({ siteId, agentId, role, pool?, idrac? })` | `PUT .../hosts/:agentId` | `{ host }` — `idrac.password` encrypted, response has `hasPassword` only |
| `revealIdracPassword({ siteId, agentId })` | `GET .../hosts/:agentId?reveal=idrac` | `{ password }` — requires `instance:hosts:manage` |
| `readHostBmc({ siteId, agentId, severity?, since?, until? })` | `GET .../hosts/:agentId/redfish` | Redfish snapshot. `status` `ok` / `unknown` / `not-configured`. Password is never returned |
| `deleteHost({ siteId, agentId })` | `DELETE .../hosts/:agentId` | `{ ok }` |
| `setHostMaintenance({ siteId, agentId, enabled, reason? })` | `POST .../hosts/:agentId/maintenance` | `{ host, primaryMove }` — entering maintenance moves a Group Replication primary off the host first and returns 409 (flag unchanged) when no healthy caught-up member is on another host |
| `getHostMaintenance({ siteId, agentId })` | `GET .../hosts/:agentId/maintenance` | `{ maintenance }` |
| `previewHostPrimaryMove({ siteId, agentId })` | `GET .../hosts/:agentId/primary-move` | `{ mode, ok, error, previewError, writers, moves, previewMoves, blocked }` — dry-run. Follows `autoMovePrimaryBeforeDrain` (`off` / `preview` / `on`). Does not promote or set the flag |
| `refreshHost({ siteId, agentId })` | `POST .../hosts/:agentId/refresh` | `{ host }` |
| `uninstallHost({ siteId, agentId })` | `POST .../hosts/:agentId/uninstall` | `{ ok, uninstalled, note }` |
| `updateHostAgent({ siteId, agentId })` | `POST .../hosts/:agentId/update` | `{ ok, note }` |
| `hostIncident({ siteId, agentId })` | `GET .../hosts/:agentId/incident` | host-down incident detail |
| `doctorReports({ siteId })` | `GET .../doctor-reports` | `{ summaries }` — per-host latest verdict summary |
| `doctorReport({ siteId, agentId })` | `GET .../doctor-reports/:agentId` | `{ report, summaryHistory }` |
| `runDoctorCheck({ siteId, agentId })` | `POST .../doctor-reports/:agentId/check` | `{ report, summaryHistory }` — on-demand check |
| `linkInit({ siteId?, alias?, displayName?, agentId?, hostname? })` | `POST .../sites/link/init` | No host: reusable `{ token, expiresAt, command, zeusUrl, siteId }` (`command` includes the token). With `agentId` or `hostname` and no tunnel: single-use `{ token, command, expiresAt, channel: 'bootstrap', singleUse: true }` where `command` does not contain the token. Tunnel up: `{ channel: 'agent', command: null }` and no token minted. |
| `linkStatus({ token })` | `GET .../sites/link/status?token=` | enroll status |
| `importDoctorReport({ fileBase64, filename? })` | `POST .../doctor-report-import` | `{ report, configHistory, entryNames }` — offline USB-zip import, parsed in memory only |

---

## `.clusters` — `ProxmoxClustersService`

| Method | Route | Returns |
|---|---|---|
| `create(params)` **(SSE)** | `POST /providers/proxmox/clusters/create` | full create spec passed through; `done: { message, ...res }` |
| `destroy({ clusterId, confirm })` **(SSE)** | `POST .../clusters/:clusterId/destroy` | `done: { message, clusterId }` |
| `gracefulShutdownStatus({ clusterId })` | `GET .../graceful-shutdown` | `{ nodes, enabledCount, total }` |
| `gracefulShutdown({ clusterId })` **(SSE)** | `POST .../graceful-shutdown` | `done: { message }` |
| `ingress({ clusterId })` | `GET .../ingress` | `{ available, exposures }` |
| `expose({ clusterId, confirm, internalIp, externalPort, ... })` | `POST .../ingress` (action `expose`) | `exposeService` result |
| `unexpose({ clusterId, ids })` | `POST .../ingress` (action `unexpose`) | `unexposeService` result |
| `ipPool({ clusterId })` | `GET .../ip-pool` | inventory `{ addresses, ... }` |
| `ipPoolPing({ clusterId, ip })` | `POST .../ip-pool` (action `ping`) | ping result |
| `ipPoolRelease({ clusterId, ip, confirm, force? })` | `POST .../ip-pool` (action `release`) | release result (`confirm===ip`) |
| `ipPoolPruneRecord({ clusterId, vmid, confirm })` | `POST .../ip-pool` (action `prune-record`) | prune result (`confirm===vmid`) |
| `nodeDns({ clusterId })` | `GET .../node-dns` | `{ networkName, gateway, dns, effective }` |
| `setNodeDns({ clusterId, dns })` | `POST .../node-dns` | `{ ok, dns, effective }` |
| `switchPorts({ clusterId })` | `GET .../switch-ports` | `{ available, vlan, switches, hosts }` |
| `tagSwitchPort({ clusterId, mac })` | `POST .../switch-ports` | `tagHostPort` result |
| `wanBinding({ clusterId })` | `GET .../wan-binding` | `{ available, uplinks, network, currentEgressIp }` |
| `setWanBinding({ clusterId, wanIp?, confirm })` | `POST .../wan-binding` | `{ ok, egressIp }` (`confirm:'set'`) |
| `zoneTopology({ clusterId })` | `GET .../zone-topology` | `{ region, reachable, nodes, inSyncCount, total }` |
| `applyZoneTopology({ clusterId })` | `POST .../zone-topology` | `{ ok, labeled }` |
| `nodes({ account, node? })` | `GET /providers/proxmox/nodes?account=` | `{ nodes, storages, templates }` |
| `cancelRun({ runKey })` | `POST /providers/proxmox/runs/cancel` | `{ cancelled }` |

---

## `.connect` — `ProxmoxConnectService`

| Method | Route | Returns |
|---|---|---|
| `issueCommand({ siteId?, alias? })` | `POST /providers/proxmox/connect` | `{ token, expiresAt, command, siteId }` |
| `clusterNodes({ accountId })` | `POST .../connect/cluster-nodes` | `{ self, nodes }` |
| `createToken({ connectorAgentId, user?, name? })` | `POST .../connect/create-token` | `{ tokenId, tokenSecret }` |
| `discover({ connectorAgentId, node? })` | `POST .../connect/discover` | facts `{ version, nodes, storages, bridges, templates, node? }` |
| `rollout({ accountId, nodes? })` **(SSE)** | `POST .../connect/rollout` | `done: { message, connectors, enrolledPeers }` |
| `rolloutInFlight({ accountId })` | `POST .../connect/rollout/in-flight` | `{ inFlight }` |

```js
// Enroll a connector, then drive an HA rollout
const { command } = await sdk.providers.proxmox.connect.issueCommand({ alias: 'indy-prox' });
const stream = sdk.providers.proxmox.connect.rollout({ accountId: 'acc1' });
for await (const ev of stream) console.log(ev);
```

---

### Notes / unconfirmed shapes
- `storageAction` delegated-action responses other than `activate-block-storage`
  live in sibling `actions-*.js` server modules and are not enumerated here
  (shape varies; pass-through). `activate-block-storage` is documented above.
- `clusterStorageAction` `pvc-status`/`test-csi-url` and most UniFi/edge/ip-pool
  POSTs return their server helper's result object verbatim (passed through `json(...)`).
- `clusterKubeconfig` returns raw YAML text (not JSON); `base._fetch` returns it as a string.
