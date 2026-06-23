// @ts-nocheck
/**
 * ProxmoxAccountsService — Proxmox VE accounts and everything scoped to one.
 *
 * Accessed as `sdk.providers.proxmox.accounts`.
 *
 * An account is one PVE cluster Zeus manages through its connector agent(s).
 * Besides CRUD + verify, this covers the per-account surface: VM template
 * building (SSE), storage discovery/management + pool init (SSE), host classes,
 * host networks (plan/apply/teardown SSE), the cluster network model, node
 * detail, HA config, datacenter firewall, edge VMs (provision/destroy SSE),
 * the UniFi controller integration (action-dispatched, 60+ actions), orphan VM
 * cleanup, API-token rotation, and template management (copy/relocate/delete).
 */
export class ProxmoxAccountsService {
  constructor(sdk) { this.sdk = sdk; }

  _i(id) { return encodeURIComponent(id); }
  _base(id) { return `/providers/proxmox/accounts/${this._i(id)}`; }

  /**
   * List all Proxmox accounts (sanitized; with connector online counts).
   *
   * @returns {Promise<{ accounts: Array<object>, defaultAccountId: string|null }>}
   * @example
   * const { accounts } = await sdk.providers.proxmox.accounts.list();
   */
  list() { return this.sdk._fetch('/providers/proxmox/accounts', 'GET'); }

  /**
   * Create (upsert) an account. The full body is passed through to upsertAccount.
   *
   * @param {object} account - Full account spec (accountId, displayName, endpoint, tokenId, tokenSecret, connectorAgentIds, etc.).
   * @returns {Promise<{ account: object }>}
   * @example
   * const { account } = await sdk.providers.proxmox.accounts.create({ displayName: 'Indy', connectorAgentIds: ['ag1'] });
   */
  create(account) {
    return this.sdk._fetch('/providers/proxmox/accounts', 'POST', { body: account });
  }

  /**
   * Get one account (sanitized).
   *
   * @param {object} params
   * @param {string} params.id - Account id.
   * @returns {Promise<{ account: object }>}
   * @example
   * const { account } = await sdk.providers.proxmox.accounts.get({ id: 'acc1' });
   */
  get({ id }) { return this.sdk._fetch(this._base(id), 'GET'); }

  /**
   * Update (upsert) an account. The body is merged with `{ accountId: id }`.
   *
   * @param {object} params - Account fields to update. Must include `id`.
   * @param {string} params.id - Account id.
   * @returns {Promise<{ account: object }>}
   * @example
   * await sdk.providers.proxmox.accounts.update({ id: 'acc1', displayName: 'Indy DC' });
   */
  update({ id, ...patch }) {
    return this.sdk._fetch(this._base(id), 'PUT', { body: patch });
  }

  /**
   * Delete an account.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {boolean} [params.force]
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.proxmox.accounts.delete({ id: 'acc1', force: true });
   */
  delete({ id, force }) {
    return this.sdk._fetch(this._base(id), 'DELETE', { query: { force: force ? '1' : undefined } });
  }

  /**
   * Verify connectivity to an account's PVE cluster via its connector.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true, version: string, release: string, nodeCount: number, nodes: Array<{ node: string, status: string }> }>}
   * @example
   * const v = await sdk.providers.proxmox.accounts.verify({ id: 'acc1' });
   */
  verify({ id }) { return this.sdk._fetch(`${this._base(id)}/verify`, 'POST'); }

  /**
   * Rotate the account's PVE API token via the connector.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ ok: true, tokenId: string, hasTokenSecret: boolean }>}
   * @example
   * await sdk.providers.proxmox.accounts.rotateToken({ id: 'acc1' });
   */
  rotateToken({ id }) { return this.sdk._fetch(`${this._base(id)}/rotate-token`, 'POST'); }

  // ── Template building ──────────────────────────────────────────────────────

  /**
   * Get template-build options (available distros + bundled packages).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ distros: Array, includedPackages: Array, recipeVersion: string }>}
   * @example
   * const { distros } = await sdk.providers.proxmox.accounts.buildTemplateOptions({ id: 'acc1' });
   */
  buildTemplateOptions({ id }) { return this.sdk._fetch(`${this._base(id)}/build-template`, 'GET'); }

  /**
   * Build a cloud-init VM template across nodes. STREAMING (SSE).
   *
   * @param {object} params - id + build spec (passed through).
   * @param {string} params.id
   * @param {string} [params.storage]
   * @param {string} [params.distro]
   * @param {string} [params.arch]
   * @param {number} [params.vmid]
   * @param {string} [params.name]
   * @param {string[]} [params.nodes]
   * @param {string} [params.imageUrl]
   * @param {string} [params.sha256]
   * @param {string} [params.homeNode]
   * @param {string[]} [params.extraPackages]
   * @param {string} [params.bootScript]
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ message, templates, failures, shared, arch }`.
   * @example
   * const s = sdk.providers.proxmox.accounts.buildTemplate({ id:'acc1', distro:'ubuntu-24.04', nodes:['pve1'], storage:'local-zfs' });
   * for await (const ev of s) console.log(ev);
   */
  buildTemplate({ id, ...spec }) {
    return this.sdk._stream(`${this._base(id)}/build-template`, 'POST', { body: spec });
  }

  /**
   * List VM templates for the account (with instances, staleness, recipe info).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ templates: Array<object>, nodes: Array, connectorNodes: Array, noConnectorNodes: Array }>}
   * @example
   * const { templates } = await sdk.providers.proxmox.accounts.templates({ id: 'acc1' });
   */
  templates({ id }) { return this.sdk._fetch(`${this._base(id)}/templates`, 'GET'); }

  /**
   * Copy a template to more nodes/storage. STREAMING (SSE).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name - Source template name.
   * @param {string} [params.newName]
   * @param {string} [params.targetStorage]
   * @param {string[]} [params.nodes]
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle.
   * @example
   * const s = sdk.providers.proxmox.accounts.copyTemplate({ id:'acc1', name:'ubuntu-tpl', nodes:['pve2'] });
   */
  copyTemplate({ id, name, newName, targetStorage, nodes }) {
    return this.sdk._stream(`${this._base(id)}/templates`, 'POST', {
      body: { action: 'copy', name, newName, targetStorage, nodes },
    });
  }

  /**
   * Delete a template across all nodes it lives on.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @returns {Promise<{ ok: boolean, results: Array<{ node: string, vmid: number, ok: boolean, error?: string }> }>}
   * @example
   * await sdk.providers.proxmox.accounts.deleteTemplate({ id:'acc1', name:'ubuntu-tpl' });
   */
  deleteTemplate({ id, name }) {
    return this.sdk._fetch(`${this._base(id)}/templates`, 'POST', { body: { action: 'delete', name } });
  }

  /**
   * Relocate a template to another node.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {string} params.targetNode
   * @returns {Promise<{ ok: boolean, results: Array<object> }>}
   * @example
   * await sdk.providers.proxmox.accounts.relocateTemplate({ id:'acc1', name:'ubuntu-tpl', targetNode:'pve2' });
   */
  relocateTemplate({ id, name, targetNode }) {
    return this.sdk._fetch(`${this._base(id)}/templates`, 'POST', {
      body: { action: 'relocate', name, targetNode },
    });
  }

  // ── Storage ──────────────────────────────────────────────────────────────

  /**
   * List storages + capabilities + recommendations for the account.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ storages: Array, capabilities: object, recommendations: Array, dismissedIds: Array }>}
   * @example
   * const { storages } = await sdk.providers.proxmox.accounts.storage({ id: 'acc1' });
   */
  storage({ id }) { return this.sdk._fetch(`${this._base(id)}/storage`, 'GET'); }

  /**
   * Run a storage action (action-dispatched). Pass `action` plus its params; the
   * whole body is forwarded. Inline actions include: `set-default`, `scan`,
   * `list-disks`, `list-bridges`, `check-mount`, `create`, `update`, `delete`,
   * `smart-detail`, `set-host-role`, `csi-identity`, `rotate-csi-token`.
   * Delegated actions (advisor/lifecycle/file-server/shares/repoint/raid/wizard/
   * network-test) e.g. `grow-pool`, `replace-drive`, `destroy-pool`,
   * `migrate-vm-disks`, `build-file-server`, `build-storage-server`,
   * `list-drives-enriched`, `wipe-drive`, `storcli-check`, etc.
   *
   * @param {object} params - `{ id, action, ...actionParams }`, or `{ id, body }`
   *   when the action body has a field named `id` (e.g. a recommendation id) that
   *   would collide with the account `id` — pass it as the explicit `body`.
   * @param {string} params.id - Account id.
   * @param {string} [params.action]
   * @param {object} [params.body] - Explicit verbatim request body (overrides the rest).
   * @returns {Promise<object>} The action result (shape varies by action).
   * @example
   * await sdk.providers.proxmox.accounts.storageAction({ id:'acc1', action:'set-default', purpose:'disk', storage:'local-zfs' });
   * await sdk.providers.proxmox.accounts.storageAction({ id:'acc1', body:{ action:'dismiss-recommendation', id:7 } });
   */
  storageAction({ id, body, ...rest }) {
    return this.sdk._fetch(`${this._base(id)}/storage`, 'POST', { body: body ?? rest });
  }

  /**
   * Initialize a new ZFS/LVM storage pool from raw devices. STREAMING (SSE).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.node
   * @param {string} params.type - 'zfs' | 'lvm' | ...
   * @param {string} params.name
   * @param {string[]} params.devices - Device paths.
   * @param {string} [params.raidlevel]
   * @param {string} [params.filesystem]
   * @param {boolean} [params.addStorage=true]
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ ok, name, type, registered }`.
   * @example
   * const s = sdk.providers.proxmox.accounts.initStoragePool({ id:'acc1', node:'pve1', type:'zfs', name:'tank', devices:['/dev/sdb','/dev/sdc'], raidlevel:'mirror' });
   */
  initStoragePool({ id, node, type, name, devices, raidlevel, filesystem, addStorage }) {
    return this.sdk._stream(`${this._base(id)}/storage/init-pool`, 'POST', {
      body: { node, type, name, devices, raidlevel, filesystem, addStorage },
    });
  }

  // ── Host classes / networks / network / node detail ────────────────────────

  /**
   * List host classes + nodes (for affinity grouping).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ supported: boolean, version: string, minVersion: string, nodes: Array<{ node: string, status: string, arch: string }>, classes: Array<object> }>}
   * @example
   * const { classes } = await sdk.providers.proxmox.accounts.hostClasses({ id: 'acc1' });
   */
  hostClasses({ id }) { return this.sdk._fetch(`${this._base(id)}/host-classes`, 'GET'); }

  /**
   * Mutate host classes (action-dispatched: `save`, `delete`, `reconcile`).
   *
   * @param {object} params - `{ id, action, ...params }`.
   * @param {string} params.id
   * @param {string} params.action
   * @returns {Promise<object>} e.g. `{ ok, class, drift }` for save.
   * @example
   * await sdk.providers.proxmox.accounts.hostClassesAction({ id:'acc1', action:'save', name:'fast', nodes:[{node:'pve1',priority:1}] });
   */
  hostClassesAction({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/host-classes`, 'POST', { body });
  }

  /**
   * Get host networks (optionally with per-host NIC detail when `ports` is set).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {boolean} [params.ports] - Include NIC detail / storage suggestion / known CIDRs.
   * @returns {Promise<{ hostNetworks: Array, hosts?: Array, bridges?: Array, suggestedBridge?: string, discoveryError?: string, unifiLinked: boolean, storageSuggestion?: object, knownCidrs?: Array }>}
   * @example
   * const { hostNetworks } = await sdk.providers.proxmox.accounts.hostNetworks({ id:'acc1', ports:true });
   */
  hostNetworks({ id, ports }) {
    return this.sdk._fetch(`${this._base(id)}/host-networks`, 'GET', {
      query: { ports: ports ? '1' : undefined },
    });
  }

  /**
   * Save a host network or get its plan (action-dispatched: `save`, `plan`,
   * `delete`). For `apply`/`teardown` (SSE) use {@link hostNetworksStream}.
   *
   * @param {object} params - `{ id, action, ...params }`.
   * @param {string} params.id
   * @param {string} params.action - 'save' | 'plan' | 'delete'.
   * @returns {Promise<object>} e.g. `{ ok, hostNetworks, warnings }` (save) or `{ ok, plan, manualSwitchSteps, warnings }` (plan).
   * @example
   * await sdk.providers.proxmox.accounts.hostNetworksAction({ id:'acc1', action:'plan', name:'storage-net' });
   */
  hostNetworksAction({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/host-networks`, 'POST', { body });
  }

  /**
   * Apply or tear down a host network. STREAMING (SSE).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.action - 'apply' | 'teardown'.
   * @param {string} params.name
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle (step/warn/error frames).
   * @example
   * const s = sdk.providers.proxmox.accounts.hostNetworksStream({ id:'acc1', action:'apply', name:'storage-net' });
   */
  hostNetworksStream({ id, action, name }) {
    return this.sdk._stream(`${this._base(id)}/host-networks`, 'POST', { body: { action, name } });
  }

  /**
   * Get the cluster network model (subnets, discovered, host aliases).
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ network: object, networks: Array, discovered: object, hostAliases: Array, zeusHost: object }>}
   * @example
   * const { networks } = await sdk.providers.proxmox.accounts.network({ id: 'acc1' });
   */
  network({ id }) { return this.sdk._fetch(`${this._base(id)}/network`, 'GET'); }

  /**
   * Mutate the network model (action-dispatched: `discover`, `save`,
   * `discover-hosts`, `save-hosts`, `save-network`, `delete-network`,
   * `expand-network`).
   *
   * @param {object} params - `{ id, action, ...params }`.
   * @param {string} params.id
   * @param {string} params.action
   * @returns {Promise<object>} e.g. `{ ok, networks }` for save-network.
   * @example
   * await sdk.providers.proxmox.accounts.networkAction({ id:'acc1', action:'save-network', network:{ name:'cluster-net', cidr:'10.2.0.0/24' } });
   */
  networkAction({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/network`, 'POST', { body });
  }

  /**
   * Get detailed info for one PVE node (OS, CPU, mem, drives, status).
   *
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.node - Node name (required).
   * @returns {Promise<{ node: string, os: object, cpu: object, mem: object, uptime: number, drives: Array, pveStatus: object }>}
   * @example
   * const detail = await sdk.providers.proxmox.accounts.nodeDetail({ id:'acc1', node:'pve1' });
   */
  nodeDetail({ id, node }) {
    return this.sdk._fetch(`${this._base(id)}/node-detail`, 'GET', { query: { node } });
  }

  // ── HA / firewall / orphans ────────────────────────────────────────────────

  /**
   * Get HA configuration + status for the account's PVE cluster.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<object>} `{ supported, version, ... }` or `{ supported:true, crs, groups, affinityRules, resources, status, vms }`.
   * @example
   * const ha = await sdk.providers.proxmox.accounts.ha({ id: 'acc1' });
   */
  ha({ id }) { return this.sdk._fetch(`${this._base(id)}/ha`, 'GET'); }

  /**
   * Mutate HA config (action-dispatched: `set-crs`, `create-group`,
   * `update-group`, `delete-group`, `create-affinity`, `update-affinity`,
   * `delete-affinity`, `enroll`, `unenroll`, `set-resource`).
   *
   * @param {object} params - `{ id, action, ...params }`.
   * @param {string} params.id
   * @param {string} params.action
   * @returns {Promise<object>} e.g. `{ ok, id }` / `{ ok, crs }` / `{ ok }`.
   * @example
   * await sdk.providers.proxmox.accounts.haAction({ id:'acc1', action:'set-crs', mode:'static', autoRebalance:true });
   */
  haAction({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/ha`, 'POST', { body });
  }

  /**
   * List the account's datacenter firewall groups + clusters.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ groups: Array<object>, clusters: Array<{ id: string, name: string }> }>}
   * @example
   * const { groups } = await sdk.providers.proxmox.accounts.firewall({ id: 'acc1' });
   */
  firewall({ id }) { return this.sdk._fetch(`${this._base(id)}/firewall`, 'GET'); }

  /**
   * Mutate firewall (action-dispatched: `create-group`, `add-rule`,
   * `delete-rule`, `delete-group`).
   *
   * @param {object} params - `{ id, action, ...params }`.
   * @param {string} params.id
   * @param {string} params.action
   * @returns {Promise<object>} e.g. `{ ok, group }` / `{ ok }`.
   * @example
   * await sdk.providers.proxmox.accounts.firewallAction({ id:'acc1', action:'add-rule', group:'g1', rule:{ type:'in', action:'ACCEPT', proto:'tcp', dport:'443' } });
   */
  firewallAction({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/firewall`, 'POST', { body });
  }

  /**
   * List orphaned (zeus-tagged but unowned) VMs.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ orphans: Array<{ vmid: number, name: string, node: string, status: string }> }>}
   * @example
   * const { orphans } = await sdk.providers.proxmox.accounts.orphans({ id: 'acc1' });
   */
  orphans({ id }) { return this.sdk._fetch(`${this._base(id)}/orphans`, 'GET'); }

  /**
   * Destroy orphaned VMs by vmid.
   *
   * @param {object} params
   * @param {string} params.id
   * @param {Array<number|string>} params.vmids
   * @returns {Promise<{ ok: boolean, results: Array<{ vmid: number, ok: boolean, error?: string }> }>}
   * @example
   * await sdk.providers.proxmox.accounts.destroyOrphans({ id:'acc1', vmids:[1234] });
   */
  destroyOrphans({ id, vmids }) {
    return this.sdk._fetch(`${this._base(id)}/orphans`, 'POST', { body: { action: 'destroy', vmids } });
  }

  // ── Edge VMs ───────────────────────────────────────────────────────────────

  /**
   * Get the account's edge (HAProxy/keepalived) VM config + routes.
   *
   * @param {object} params
   * @param {string} params.id
   * @returns {Promise<{ edge: object|null, routes: Array }>}
   * @example
   * const { edge } = await sdk.providers.proxmox.accounts.edge({ id: 'acc1' });
   */
  edge({ id }) { return this.sdk._fetch(`${this._base(id)}/edge`, 'GET'); }

  /**
   * Run a non-streaming edge action (action-dispatched). Actions: `suggest-subnet`,
   * `status`, `failover` (targetVmid), `start-vm`/`stop-vm`/`enable-autostart`
   * (vmid), `haproxy-logs` (vmid, offset), `reconcile`, `update-ports` (ports),
   * `add-route` (sni, clusterId, targetIp, targetPort, proxyProtocol),
   * `remove-route` (sni), `sync-routes`. For `provision`/`destroy` (SSE) use
   * {@link edgeStream}.
   *
   * @param {object} params - `{ id, action, ...params }`.
   * @param {string} params.id
   * @param {string} params.action
   * @returns {Promise<object>} The action result (shape varies).
   * @example
   * await sdk.providers.proxmox.accounts.edgeAction({ id:'acc1', action:'failover', targetVmid:9001 });
   */
  edgeAction({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/edge`, 'POST', { body });
  }

  /**
   * Provision or destroy the edge VM set. STREAMING (SSE). `destroy` requires
   * `confirm:'destroy'`.
   *
   * @param {object} params - `{ id, action, ...spec }`.
   * @param {string} params.id
   * @param {string} params.action - 'provision' | 'destroy'.
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ ok, edge }` (provision) or `{ ok }` (destroy).
   * @example
   * const s = sdk.providers.proxmox.accounts.edgeStream({ id:'acc1', action:'provision', name:'edge', vip:'10.2.0.2', replicas:2, hostClass:'edge' });
   */
  edgeStream({ id, ...body }) {
    return this.sdk._stream(`${this._base(id)}/edge`, 'POST', { body });
  }

  // ── UniFi ──────────────────────────────────────────────────────────────────

  /**
   * UniFi controller integration — a single action-dispatched POST. Pass the
   * whole `{ id, action, ...params }` body through; it routes by `action`.
   * Requires the account to have UniFi linked.
   *
   * Common actions (with their params):
   *  - `test`, `discover`, `discover-sites`, `drift` — read-only probes.
   *  - `switches` (hostMacs[]), `switch-ports`, `rename-switch` (switchId,name).
   *  - `tag-port` (mac,vlan), `host-ports` *(STREAMING SSE — use {@link unifiStream})*,
   *    `rename-port` (switchId,port,name), `configure-port` (switchId,port,nativeVlan,taggedVlans[],name,enabled).
   *  - Firewall: `fw-secured`, `fw-standard` (network), `fw-secure` (network,standardKeys),
   *    `fw-standard-apply` (network,keys), `fw-unsecure` (network),
   *    `fw-allow-add` (network,source,label,port,proto), `fw-allow-remove` (id,name).
   *  - Ingress: `ingress-list`, `ingress-remove` (name,portForwardId,allowId),
   *    `ingress-hostname-set` (hostname,hostnameSource), `ingress-fw-check`/`ingress-fw-ensure` (clusterId),
   *    `ingress-dns-status`, `ingress-dns-apply`.
   *  - Edge forward: `edge-forward-status`, `edge-forward-set` (confirm:'route',wanIp), `edge-forward-clear`.
   *  - WAN: `wan-uplinks`, `wan-ip`, `wan-model`, `wan-sync`, `wan-set-active` (wanId).
   *  - DDNS: `ddns-providers`, `ddns-list`, `ddns-reconcile` (provider,login,password,server), `ddns-remove`.
   *  - L4 NAT: `l4-list`, `l4-allocate` (wanId,ip,proto,portStart,portEnd,internalIp,internalPort,service,cluster,network), `l4-release` (id).
   *  - DNS: `dns-records`, `dns-create` (hostname,ip,type,ttl), `dns-delete` (id),
   *    `dns-split-horizon` (desired[],ownerTag), `dns-split-horizon-remove` (ownerTag), `dns-split-horizon-capable`.
   *  - Networks: `networks-full`, `update-network` (id,patch), `adopt` (currentName,newName),
   *    `add-trunk` (mac,vlan), `realize` (network,secure), `unrealize` (network).
   *  - `sip-alg-status`, `sip-alg-set` (enabled).
   *
   * @param {object} params - `{ id, action, ...actionParams }`.
   * @param {string} params.id
   * @param {string} params.action
   * @returns {Promise<object>} The action result (shape varies by action).
   * @example
   * const { networks } = await sdk.providers.proxmox.accounts.unifi({ id:'acc1', action:'discover' });
   * await sdk.providers.proxmox.accounts.unifi({ id:'acc1', action:'realize', network:'cluster-net', secure:true });
   */
  unifi({ id, ...body }) {
    return this.sdk._fetch(`${this._base(id)}/unifi`, 'POST', { body });
  }

  /**
   * UniFi streaming actions (currently `host-ports`). STREAMING (SSE).
   * Same body shape as {@link unifi}, but returns a stream handle.
   *
   * @param {object} params - `{ id, action, ...params }` (e.g. action:'host-ports').
   * @param {string} params.id
   * @param {string} params.action
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ ok, networks }`.
   * @example
   * const s = sdk.providers.proxmox.accounts.unifiStream({ id:'acc1', action:'host-ports' });
   */
  unifiStream({ id, ...body }) {
    return this.sdk._stream(`${this._base(id)}/unifi`, 'POST', { body });
  }
}
