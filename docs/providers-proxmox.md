# `sdk.providers.proxmox` — Proxmox VE provider

Proxmox is a bare-metal / on-prem provider. Zeus reaches a PVE fleet through a
connector **agent** (`zeus-agent`) that dials out and tunnels the PVE API + a
shell — there is no public PVE endpoint.

`ProxmoxService` instantiates four sub-namespaces:

| Sub-namespace | Class | Covers |
|---|---|---|
| `.accounts` | `ProxmoxAccountsService` | PVE accounts + per-account: templates, storage, host classes/networks, network model, node detail, HA, firewall, edge VMs, UniFi, orphans, token rotation |
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
| `storageAction({ id, action, ... })` | `POST .../storage` | action-dispatched (passes whole body) |
| `initStoragePool({ id, node, type, name, devices, raidlevel?, filesystem?, addStorage? })` **(SSE)** | `POST .../storage/init-pool` | `done: { ok, name, type, registered }` |

`storageAction` inline actions: `set-default`, `scan`, `list-disks`, `list-bridges`,
`check-mount`, `create`, `update`, `delete`, `smart-detail`, `set-host-role`,
`csi-identity`, `rotate-csi-token`. Delegated (advisor/lifecycle/file-server/shares/
repoint/raid/wizard/network-test) actions include `grow-pool`, `replace-drive`,
`destroy-pool`, `migrate-vm-disks`, `build-file-server`, `build-storage-server`,
`list-drives-enriched`, `wipe-drive`, `storcli-check`, `megacli-create-raid1`, etc.

### Host classes / networks / network / node detail
| Method | Route | Returns |
|---|---|---|
| `hostClasses({ id })` | `GET .../host-classes` | `{ supported, version, minVersion, nodes, classes }` |
| `hostClassesAction({ id, action, ... })` | `POST .../host-classes` | `save` / `delete` / `reconcile` |
| `hostNetworks({ id, ports? })` | `GET .../host-networks` | `{ hostNetworks, ... }` (`ports`→`?ports=1`) |
| `hostNetworksAction({ id, action, ... })` | `POST .../host-networks` | `save` / `plan` / `delete` |
| `hostNetworksStream({ id, action, name })` **(SSE)** | `POST .../host-networks` | `apply` / `teardown` |
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
| `updateHost({ siteId, agentId, role, pool? })` | `PUT .../hosts/:agentId` | `{ host }` |
| `deleteHost({ siteId, agentId })` | `DELETE .../hosts/:agentId` | `{ ok }` |
| `setHostMaintenance({ siteId, agentId, enabled, reason? })` | `POST .../hosts/:agentId/maintenance` | `{ host }` |
| `getHostMaintenance({ siteId, agentId })` | `GET .../hosts/:agentId/maintenance` | `{ maintenance }` |
| `refreshHost({ siteId, agentId })` | `POST .../hosts/:agentId/refresh` | `{ host }` |
| `uninstallHost({ siteId, agentId })` | `POST .../hosts/:agentId/uninstall` | `{ ok, uninstalled, note }` |
| `updateHostAgent({ siteId, agentId })` | `POST .../hosts/:agentId/update` | `{ ok, note }` |
| `hostIncident({ siteId, agentId })` | `GET .../hosts/:agentId/incident` | host-down incident detail |
| `doctorReports({ siteId })` | `GET .../doctor-reports` | `{ summaries }` — per-host latest verdict summary |
| `doctorReport({ siteId, agentId })` | `GET .../doctor-reports/:agentId` | `{ report, summaryHistory }` |
| `runDoctorCheck({ siteId, agentId })` | `POST .../doctor-reports/:agentId/check` | `{ report, summaryHistory }` — on-demand check |
| `linkInit({ siteId?, alias?, displayName? })` | `POST .../sites/link/init` | `{ token, expiresAt, command, zeusUrl, siteId }` |
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
- `storageAction` delegated-action responses live in sibling `actions-*.js` server
  modules and are not enumerated here (shape varies; pass-through).
- `clusterStorageAction` `pvc-status`/`test-csi-url` and most UniFi/edge/ip-pool
  POSTs return their server helper's result object verbatim (passed through `json(...)`).
- `clusterKubeconfig` returns raw YAML text (not JSON); `base._fetch` returns it as a string.
