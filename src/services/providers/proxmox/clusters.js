// @ts-nocheck
/**
 * ProxmoxClustersService — k3s cluster lifecycle + per-cluster networking on Proxmox.
 *
 * Accessed as `sdk.providers.proxmox.clusters`.
 *
 * Covers creating and destroying k3s clusters on a Proxmox fleet (both SSE
 * streams) plus the per-cluster networking surface: ingress exposures, the
 * static-IP pool inventory, node DNS, UniFi switch-port tagging, WAN egress
 * binding, and zone-topology labeling. Also exposes the account-level node
 * discovery endpoint and the run-cancel helper.
 *
 * Note: `create` and `destroy` here are the legacy provider routes; the
 * unified v2configs deploy flow is the current cluster-create path.
 */
export class ProxmoxClustersService {
  constructor(sdk) { this.sdk = sdk; }

  _c(clusterId) { return encodeURIComponent(clusterId); }

  /**
   * Create a k3s cluster on a Proxmox account. STREAMING (SSE).
   *
   * Pass the full create spec — control plane (count must be 1/3/5), node
   * groups, storage, networking, etc. `confirm` must equal `clusterName`.
   *
   * @param {object} params - The full create body (passed through). Common fields:
   * @param {string} params.accountId
   * @param {string} params.clusterName
   * @param {string} params.confirm - Must equal `clusterName` (type-to-confirm).
   * @param {boolean} [params.archTaint] - Immutable at create.
   * @param {object} [params.controlPlane] - `{ count(1|3|5), cores, memMB, diskGB, hostClass, haGroup, spread, template, storage, storageMode, networkStorage, network }`.
   * @param {Array} [params.nodeGroups] - Worker groups `{ name, count, cores, memMB, diskGB, labels, taints, haGroup, spread, template, storage, storageMode, networkStorage, network }`.
   * @param {string} [params.siteId]
   * @param {string} [params.container]
   * @param {string[]} [params.notifyEmails]
   * @param {object} [params.ipPlan] - default `{ mode:'dhcp' }`.
   * @param {string} [params.storageProvisioner] - default 'local-path'.
   * @param {string} [params.k3sVersion]
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ message, ...res }`.
   * @example
   * const s = sdk.providers.proxmox.clusters.create({ accountId:'acc1', clusterName:'z-02', confirm:'z-02', controlPlane:{count:3} });
   * for await (const ev of s) console.log(ev);
   */
  create(params) {
    return this.sdk._stream('/providers/proxmox/clusters/create', 'POST', { body: params });
  }

  /**
   * Destroy a Proxmox cluster (all-or-nothing teardown). STREAMING (SSE).
   * Deprecated in favor of the unified v2configs destroy flow.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string} params.confirm - Must equal the cluster's name.
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ message, clusterId }`.
   * @example
   * const s = sdk.providers.proxmox.clusters.destroy({ clusterId:'z-02', confirm:'z-02' });
   */
  destroy({ clusterId, confirm }) {
    return this.sdk._stream(`/providers/proxmox/clusters/${this._c(clusterId)}/destroy`, 'POST', {
      body: { confirm },
    });
  }

  /**
   * Get graceful-shutdown status for a cluster's nodes (JSON, not streaming).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ nodes: Array<{ name: string, role: string, enabled: boolean, graceSeconds: number, known: boolean }>, enabledCount: number, total: number }>}
   * @example
   * const { enabledCount } = await sdk.providers.proxmox.clusters.gracefulShutdownStatus({ clusterId:'z-02' });
   */
  gracefulShutdownStatus({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/graceful-shutdown`, 'GET');
  }

  /**
   * Apply graceful-shutdown configuration to a cluster's nodes. STREAMING (SSE).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ message }`.
   * @example
   * const s = sdk.providers.proxmox.clusters.gracefulShutdown({ clusterId:'z-02' });
   */
  gracefulShutdown({ clusterId }) {
    return this.sdk._stream(`/providers/proxmox/clusters/${this._c(clusterId)}/graceful-shutdown`, 'POST');
  }

  /**
   * List ingress exposures for a cluster (via the linked UniFi controller).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ available: boolean, exposures: Array, error?: string }>}
   * @example
   * const { exposures } = await sdk.providers.proxmox.clusters.ingress({ clusterId:'z-02' });
   */
  ingress({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ingress`, 'GET');
  }

  /**
   * Expose a service through the cluster's edge/WAN (UniFi port-forward + firewall).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string} params.confirm - Must be `'expose'`.
   * @param {string} params.internalIp - Required.
   * @param {number} params.externalPort - Required.
   * @param {number} [params.internalPort]
   * @param {string} [params.proto]
   * @param {string} [params.service]
   * @param {string} [params.wanIp]
   * @param {string} [params.wanInterface]
   * @returns {Promise<object>} `exposeService(...)` result (port-forward + policy ids).
   * @example
   * await sdk.providers.proxmox.clusters.expose({ clusterId:'z-02', confirm:'expose', internalIp:'10.2.0.5', externalPort:443 });
   */
  expose({ clusterId, confirm, internalIp, externalPort, internalPort, proto, service, wanIp, wanInterface }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ingress`, 'POST', {
      body: { action: 'expose', confirm, internalIp, externalPort, internalPort, proto, service, wanIp, wanInterface },
    });
  }

  /**
   * Remove an ingress exposure.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {object} [params.ids] - `{ portForwardId, policyId }`.
   * @returns {Promise<object>} `unexposeService(...)` result.
   * @example
   * await sdk.providers.proxmox.clusters.unexpose({ clusterId:'z-02', ids:{ portForwardId:'p1', policyId:'r1' } });
   */
  unexpose({ clusterId, ids }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ingress`, 'POST', {
      body: { action: 'unexpose', ids },
    });
  }

  /**
   * Get the static-IP pool inventory for a cluster.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<object>} Inventory object (`addresses` + metadata); `{ available, error, addresses }` on failure.
   * @example
   * const inv = await sdk.providers.proxmox.clusters.ipPool({ clusterId:'z-02' });
   */
  ipPool({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ip-pool`, 'GET');
  }

  /**
   * Ping an address from inside the cluster (IP-pool collision check).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string} params.ip
   * @returns {Promise<object>} `pingFromCluster(...)` result.
   * @example
   * await sdk.providers.proxmox.clusters.ipPoolPing({ clusterId:'z-02', ip:'10.2.0.9' });
   */
  ipPoolPing({ clusterId, ip }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ip-pool`, 'POST', {
      body: { action: 'ping', ip },
    });
  }

  /**
   * Release an address from the IP pool. `confirm` must equal `ip`.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string} params.ip
   * @param {string} params.confirm - Must equal `ip`.
   * @param {boolean} [params.force]
   * @returns {Promise<object>} `releaseAddress(...)` result.
   * @example
   * await sdk.providers.proxmox.clusters.ipPoolRelease({ clusterId:'z-02', ip:'10.2.0.9', confirm:'10.2.0.9' });
   */
  ipPoolRelease({ clusterId, ip, confirm, force }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ip-pool`, 'POST', {
      body: { action: 'release', ip, confirm, force },
    });
  }

  /**
   * Prune a stale IP-pool record by vmid. `confirm` must equal `vmid`.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string|number} params.vmid
   * @param {string|number} params.confirm - Must equal `vmid`.
   * @returns {Promise<object>} `pruneStaleRecord(...)` result.
   * @example
   * await sdk.providers.proxmox.clusters.ipPoolPruneRecord({ clusterId:'z-02', vmid:'1234', confirm:'1234' });
   */
  ipPoolPruneRecord({ clusterId, vmid, confirm }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/ip-pool`, 'POST', {
      body: { action: 'prune-record', vmid, confirm },
    });
  }

  /**
   * Get the effective node DNS for a cluster's network.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ networkName: string, gateway: string|null, dns: string[], effective: string[] }>}
   * @example
   * const { effective } = await sdk.providers.proxmox.clusters.nodeDns({ clusterId:'z-02' });
   */
  nodeDns({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/node-dns`, 'GET');
  }

  /**
   * Set the node DNS servers for a cluster's network.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string[]} params.dns - IPv4 addresses (each `a.b.c.d`).
   * @returns {Promise<{ ok: true, dns: string[], effective: string[] }>}
   * @example
   * await sdk.providers.proxmox.clusters.setNodeDns({ clusterId:'z-02', dns:['10.2.10.1'] });
   */
  setNodeDns({ clusterId, dns }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/node-dns`, 'POST', {
      body: { dns },
    });
  }

  /**
   * Get UniFi switch-port assignments for a cluster's VLAN.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ available: boolean, vlan?: number, switches: Array, hosts: Array, reason?: string, error?: string }>}
   * @example
   * const { switches } = await sdk.providers.proxmox.clusters.switchPorts({ clusterId:'z-02' });
   */
  switchPorts({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/switch-ports`, 'GET');
  }

  /**
   * Tag a switch port (by MAC) onto the cluster's VLAN.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string} params.mac - Required.
   * @returns {Promise<object>} `tagHostPort(...)` result.
   * @example
   * await sdk.providers.proxmox.clusters.tagSwitchPort({ clusterId:'z-02', mac:'aa:bb:cc:dd:ee:ff' });
   */
  tagSwitchPort({ clusterId, mac }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/switch-ports`, 'POST', {
      body: { mac },
    });
  }

  /**
   * Get WAN egress binding for a cluster (available uplinks + current egress IP).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ available: boolean, uplinks: Array, network: { id: string, name: string, outboundIps: string[] }|null, currentEgressIp?: string, error?: string }>}
   * @example
   * const { currentEgressIp } = await sdk.providers.proxmox.clusters.wanBinding({ clusterId:'z-02' });
   */
  wanBinding({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/wan-binding`, 'GET');
  }

  /**
   * Pin (or clear) the cluster's WAN egress IP. `confirm` must be `'set'`.
   * Empty/null `wanIp` clears the pin.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @param {string} [params.wanIp] - Egress IP to pin; empty/null clears.
   * @param {string} params.confirm - Must be `'set'`.
   * @returns {Promise<{ ok: true, egressIp: string|null }>}
   * @example
   * await sdk.providers.proxmox.clusters.setWanBinding({ clusterId:'z-02', wanIp:'203.0.113.5', confirm:'set' });
   */
  setWanBinding({ clusterId, wanIp, confirm }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/wan-binding`, 'POST', {
      body: { wanIp, confirm },
    });
  }

  /**
   * Get zone-topology status (per-node zone labels vs desired).
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ region: string, reachable: boolean, nodes: Array<{ name: string, zone: string, desiredZone: string, inSync: boolean, known: boolean }>, inSyncCount: number, total: number }>}
   * @example
   * const { inSyncCount } = await sdk.providers.proxmox.clusters.zoneTopology({ clusterId:'z-02' });
   */
  zoneTopology({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/zone-topology`, 'GET');
  }

  /**
   * Apply zone-topology labels to the cluster's nodes.
   *
   * @param {object} params
   * @param {string} params.clusterId
   * @returns {Promise<{ ok: true, labeled: * }>}
   * @example
   * await sdk.providers.proxmox.clusters.applyZoneTopology({ clusterId:'z-02' });
   */
  applyZoneTopology({ clusterId }) {
    return this.sdk._fetch(`/providers/proxmox/clusters/${this._c(clusterId)}/zone-topology`, 'POST');
  }

  /**
   * List discovered PVE nodes + storages + templates for an account.
   *
   * @param {object} params
   * @param {string} params.account - Proxmox account id.
   * @param {string} [params.node] - Optional node filter.
   * @returns {Promise<{ nodes: Array<{ node: string, status: string, maxcpu: number, maxmem: number, maxdisk: number, cpu: number, mem: number, vms: { total: number, running: number }, ip: string }>, storages: Array<{ storage: string, type: string, content: string, avail: number, total: number, shared: boolean }>, templates: Array<{ vmid: number, name: string, node: string }> }>}
   * @example
   * const { nodes, storages } = await sdk.providers.proxmox.clusters.nodes({ account: 'acc1' });
   */
  nodes({ account, node }) {
    return this.sdk._fetch('/providers/proxmox/nodes', 'GET', { query: { account, node } });
  }

  /**
   * Request cancellation of an in-flight Proxmox run by its run key.
   *
   * @param {object} params
   * @param {string} params.runKey - The run key to cancel.
   * @returns {Promise<{ cancelled: boolean }>}
   * @example
   * await sdk.providers.proxmox.clusters.cancelRun({ runKey: 'proxmox-rollout:acc1' });
   */
  cancelRun({ runKey }) {
    return this.sdk._fetch('/providers/proxmox/runs/cancel', 'POST', { body: { runKey } });
  }
}
