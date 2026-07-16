// @ts-nocheck
/**
 * ProxmoxSitesService — bare-metal sites, their enrolled agent hosts, and the
 * k3s clusters built on them.
 *
 * Accessed as `sdk.providers.proxmox.sites`.
 *
 * A **site** is a set of `zeus-agent` hosts that dial out to Zeus. Hosts are
 * assigned roles (server/agent) and pools, then a k3s cluster is planned and
 * created across them (SSE). Per-cluster you can read kubeconfig (YAML),
 * nodes, pods, storage classes, and install a storage provisioner (SSE).
 * `link/init` mints the agent-enroll command; `link/status` polls enrollment.
 */
export class ProxmoxSitesService {
  constructor(sdk) { this.sdk = sdk; }

  _s(siteId) { return encodeURIComponent(siteId); }
  _c(clusterId) { return encodeURIComponent(clusterId); }
  _a(agentId) { return encodeURIComponent(agentId); }

  /**
   * List all sites with per-host online status.
   *
   * @returns {Promise<{ sites: Array<object>, defaultSiteId: string|null, pinnedAgentVersion: string }>}
   * @example
   * const { sites } = await sdk.providers.proxmox.sites.list();
   */
  list() { return this.sdk._fetch('/providers/proxmox/sites', 'GET'); }

  /**
   * Create a site.
   *
   * @param {object} params
   * @param {string} params.alias - Site alias (slug).
   * @param {string} [params.displayName]
   * @returns {Promise<{ site: object }>}
   * @example
   * const { site } = await sdk.providers.proxmox.sites.create({ alias: 'indy', displayName: 'Indy DC' });
   */
  create({ alias, displayName }) {
    return this.sdk._fetch('/providers/proxmox/sites', 'POST', { body: { alias, displayName } });
  }

  /**
   * Get one site (hosts augmented with online status).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @returns {Promise<{ site: object, pinnedAgentVersion: string }>}
   * @example
   * const { site } = await sdk.providers.proxmox.sites.get({ siteId: 'site1' });
   */
  get({ siteId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}`, 'GET');
  }

  /**
   * Update a site, mark it default (pass `action:'set-default'`), or set its
   * opt-in host-auto-recovery policy (pass `autoRecover`).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} [params.action] - `'set-default'` to make this the default site.
   * @param {string} [params.alias]
   * @param {string} [params.displayName]
   * @param {{ enabled: boolean, afterMinutes?: number }} [params.autoRecover] - When set,
   *   patches ONLY the auto-recover policy (ignores alias/displayName/action). Off by
   *   default; when enabled, the health daemon auto-marks a DOWN host failed once it's
   *   been down longer than `afterMinutes` (default 15).
   * @returns {Promise<{ site: object, defaulted?: boolean, autoRecover?: object }>}
   * @example
   * await sdk.providers.proxmox.sites.update({ siteId: 'site1', displayName: 'Indy DC 2' });
   * await sdk.providers.proxmox.sites.update({ siteId: 'site1', action: 'set-default' });
   * await sdk.providers.proxmox.sites.update({ siteId: 'site1', autoRecover: { enabled: true, afterMinutes: 20 } });
   */
  update({ siteId, action, alias, displayName, autoRecover }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}`, 'PUT', {
      body: { action, alias, displayName, autoRecover },
    });
  }

  /**
   * Delete a site.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {boolean} [params.force] - Force-delete even if non-empty.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.proxmox.sites.delete({ siteId: 'site1', force: true });
   */
  delete({ siteId, force }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}`, 'DELETE', {
      query: { force: force ? '1' : undefined },
    });
  }

  /**
   * List k3s clusters on a site.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @returns {Promise<{ clusters: Array<object> }>}
   * @example
   * const { clusters } = await sdk.providers.proxmox.sites.clusters({ siteId: 'site1' });
   */
  clusters({ siteId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/clusters`, 'GET');
  }

  /**
   * Preview the cluster-create plan for a site (servers/agents split + steps).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} [params.installerId='k3s']
   * @param {string} [params.clusterName='preview']
   * @returns {Promise<{ installers: Array, installerId: string, preflight: object, servers: string[], agents: string[], steps: Array<{ hostname: string, role: string, phase: string, label: string }> }>}
   * @example
   * const plan = await sdk.providers.proxmox.sites.planCluster({ siteId: 'site1' });
   */
  planCluster({ siteId, installerId, clusterName }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/clusters/plan`, 'POST', {
      body: { installerId, clusterName },
    });
  }

  /**
   * Create a k3s cluster on a site. STREAMING (SSE). `confirm` must equal `clusterName`.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterName
   * @param {string} params.confirm - Must equal `clusterName`.
   * @param {string} [params.installerId='k3s']
   * @param {string} [params.container]
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload `{ message, ...res }`.
   * @example
   * const s = sdk.providers.proxmox.sites.createCluster({ siteId:'site1', clusterName:'z-02', confirm:'z-02' });
   * for await (const ev of s) console.log(ev);
   */
  createCluster({ siteId, clusterName, confirm, installerId, container }) {
    return this.sdk._stream(`/providers/proxmox/sites/${this._s(siteId)}/clusters/create`, 'POST', {
      body: { clusterName, confirm, installerId, container },
    });
  }

  /**
   * Download a cluster's kubeconfig as YAML text (not JSON).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterId
   * @returns {Promise<string>} The raw kubeconfig YAML.
   * @example
   * const yaml = await sdk.providers.proxmox.sites.clusterKubeconfig({ siteId:'site1', clusterId:'z-02' });
   */
  clusterKubeconfig({ siteId, clusterId }) {
    return this.sdk._fetch(
      `/providers/proxmox/sites/${this._s(siteId)}/clusters/${this._c(clusterId)}/kubeconfig`,
      'GET',
    );
  }

  /**
   * List a cluster's nodes (each augmented with agentId + live agentVersion).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterId
   * @returns {Promise<{ nodes: Array<object> }>}
   * @example
   * const { nodes } = await sdk.providers.proxmox.sites.clusterNodes({ siteId:'site1', clusterId:'z-02' });
   */
  clusterNodes({ siteId, clusterId }) {
    return this.sdk._fetch(
      `/providers/proxmox/sites/${this._s(siteId)}/clusters/${this._c(clusterId)}/nodes`,
      'GET',
    );
  }

  /**
   * List a cluster's pods.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterId
   * @returns {Promise<{ pods: Array<object> }>}
   * @example
   * const { pods } = await sdk.providers.proxmox.sites.clusterPods({ siteId:'site1', clusterId:'z-02' });
   */
  clusterPods({ siteId, clusterId }) {
    return this.sdk._fetch(
      `/providers/proxmox/sites/${this._s(siteId)}/clusters/${this._c(clusterId)}/pods`,
      'GET',
    );
  }

  /**
   * Get a cluster's storage classes + provisioners + CSI status.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterId
   * @returns {Promise<{ storageClasses: Array, provisioners: Array, csiStatus: object|null }>}
   * @example
   * const { storageClasses } = await sdk.providers.proxmox.sites.clusterStorage({ siteId:'site1', clusterId:'z-02' });
   */
  clusterStorage({ siteId, clusterId }) {
    return this.sdk._fetch(
      `/providers/proxmox/sites/${this._s(siteId)}/clusters/${this._c(clusterId)}/storage`,
      'GET',
    );
  }

  /**
   * Mutate cluster storage (action-dispatched). Actions: `set-default` (name),
   * `pvc-status` (name), `delete-pvc` (namespace+name), `delete` (name),
   * `test-csi-url` (url).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterId
   * @param {string} params.action - One of the actions above.
   * @param {string} [params.name]
   * @param {string} [params.namespace]
   * @param {string} [params.url]
   * @returns {Promise<object>} `{ ok: true }` for mutations, or the action result (pvc-status / test-csi-url).
   * @example
   * await sdk.providers.proxmox.sites.clusterStorageAction({ siteId:'site1', clusterId:'z-02', action:'set-default', name:'nfs' });
   */
  clusterStorageAction({ siteId, clusterId, action, name, namespace, url }) {
    return this.sdk._fetch(
      `/providers/proxmox/sites/${this._s(siteId)}/clusters/${this._c(clusterId)}/storage`,
      'POST',
      { body: { action, name, namespace, url } },
    );
  }

  /**
   * Install / reconfigure a cluster storage provisioner. STREAMING (SSE).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.clusterId
   * @param {string} [params.action] - omit for install; `'reconfigure-csi'` or `'reconcile-csi-nodes'`.
   * @param {string} [params.provisioner] - Required unless action is a csi-reconfigure variant.
   * @param {string} [params.nfsServer]
   * @param {string} [params.nfsPath]
   * @param {string} [params.proxmoxStorage]
   * @param {boolean} [params.makeDefault]
   * @param {string[]} [params.overrideUrls]
   * @param {string} [params.overrideUrl]
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle. Terminal `done` payload from the install run.
   * @example
   * const s = sdk.providers.proxmox.sites.clusterStorageInstall({ siteId:'site1', clusterId:'z-02', provisioner:'nfs-csi', nfsServer:'10.2.0.4', nfsPath:'/export' });
   */
  clusterStorageInstall({ siteId, clusterId, action, provisioner, nfsServer, nfsPath, proxmoxStorage, makeDefault, overrideUrls, overrideUrl }) {
    return this.sdk._stream(
      `/providers/proxmox/sites/${this._s(siteId)}/clusters/${this._c(clusterId)}/storage/install`,
      'POST',
      { body: { action, provisioner, nfsServer, nfsPath, proxmoxStorage, makeDefault, overrideUrls, overrideUrl } },
    );
  }

  /**
   * Update a host's role / pool within a site.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @param {string} params.role - 'unassigned' | 'server' | 'agent'.
   * @param {string} [params.pool]
   * @returns {Promise<{ host: object }>}
   * @example
   * await sdk.providers.proxmox.sites.updateHost({ siteId:'site1', agentId:'ag1', role:'server' });
   */
  updateHost({ siteId, agentId, role, pool }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}`, 'PUT', {
      body: { role, pool },
    });
  }

  /**
   * Remove a host record from a site.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.proxmox.sites.deleteHost({ siteId:'site1', agentId:'ag1' });
   */
  deleteHost({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}`, 'DELETE');
  }

  /**
   * Set or clear an operator maintenance flag on a Proxmox connector host —
   * pulls it out of VM-placement service (isHostPlaceable) while leaving its
   * health state alone (it still reports 'online' if the tunnel/PVE agree).
   * Use for a host that's up but shouldn't receive new VMs, e.g. a failing
   * disk awaiting replacement.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @param {boolean} params.enabled
   * @param {string} [params.reason]
   * @returns {Promise<{ host: object }>}
   * @example
   * await sdk.providers.proxmox.sites.setHostMaintenance({ siteId:'site1', agentId:'ag1', enabled:true, reason:'disk RMA' });
   */
  setHostMaintenance({ siteId, agentId, enabled, reason }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/maintenance`, 'POST', {
      body: { enabled, reason },
    });
  }

  /**
   * Get the current maintenance state for a host.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ maintenance: object|null }>}
   * @example
   * const { maintenance } = await sdk.providers.proxmox.sites.getHostMaintenance({ siteId:'site1', agentId:'ag1' });
   */
  getHostMaintenance({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/maintenance`, 'GET');
  }

  /**
   * Refresh a host's facts from its live agent.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ host: object }>}
   * @example
   * await sdk.providers.proxmox.sites.refreshHost({ siteId:'site1', agentId:'ag1' });
   */
  refreshHost({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/refresh`, 'POST');
  }

  /**
   * Uninstall the agent from a host (then remove its record).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ ok: true, uninstalled: boolean, note: string }>}
   * @example
   * await sdk.providers.proxmox.sites.uninstallHost({ siteId:'site1', agentId:'ag1' });
   */
  uninstallHost({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/uninstall`, 'POST');
  }

  /**
   * Trigger an agent self-update on a host (must be online).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ ok: true, note: string }>}
   * @example
   * await sdk.providers.proxmox.sites.updateHostAgent({ siteId:'site1', agentId:'ag1' });
   */
  updateHostAgent({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/update`, 'POST');
  }

  /**
   * Full host-down incident picture: host-health state + per-impacted-cluster
   * live detail (NotReady nodes, pods pending on spread/affinity vs. other
   * reasons, pods stuck Terminating on the host's nodes, stranded local-path
   * PVCs, control-plane/etcd quorum exposure). Degraded clusters return
   * partial data with per-section `errors` rather than failing the request.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ agentId: string, siteId: string, hostname: string, state: string, since: string, quorumExposed: boolean, clusters: Array<object> }>}
   * @example
   * const incident = await sdk.providers.proxmox.sites.hostIncident({ siteId: 'site1', agentId: 'ag1' });
   */
  hostIncident({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/incident`, 'GET');
  }

  /**
   * Latest doctor-report summary for every host on a site that has one
   * (`.plans/proxmox-host-doctor.md` §6 "Host health" card).
   *
   * @param {object} params
   * @param {string} params.siteId
   * @returns {Promise<{ summaries: Array<{agentId:string, at:string|null, worstSeverity:string, incidentDomains:string[], history:Array}> }>}
   * @example
   * const { summaries } = await sdk.providers.proxmox.sites.doctorReports({ siteId: 'site1' });
   */
  doctorReports({ siteId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/doctor-reports`, 'GET');
  }

  /**
   * Full stored doctor report + summary history for one host.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ report: object, summaryHistory: Array }>}
   * @example
   * const { report } = await sdk.providers.proxmox.sites.doctorReport({ siteId: 'site1', agentId: 'ag1' });
   */
  doctorReport({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/doctor-reports/${this._a(agentId)}`, 'GET');
  }

  /**
   * Run a doctor check right now (host must be online) — bypasses the daily
   * sweep cadence. Stores + evaluates the result exactly like a routine sweep.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<{ report: object, summaryHistory: Array }>}
   * @example
   * await sdk.providers.proxmox.sites.runDoctorCheck({ siteId: 'site1', agentId: 'ag1' });
   */
  runDoctorCheck({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/doctor-reports/${this._a(agentId)}/check`, 'POST');
  }

  /**
   * Preview the exact "Mark host failed" action list for a down host: per
   * impacted cluster, Node objects to delete, etcd members to remove,
   * orphaned local-path PVCs (and whether they'll be deleted), VM records
   * to mark failed. Render this verbatim before the destructive apply.
   *
   * @param {object} params
   * @param {string} params.siteId
   * @param {string} params.agentId
   * @returns {Promise<object>} preview payload — see host-failed.js `previewMarkHostFailed`.
   * @example
   * const preview = await sdk.providers.proxmox.sites.markHostFailedPreview({ siteId: 'site1', agentId: 'ag1' });
   */
  markHostFailedPreview({ siteId, agentId }) {
    return this.sdk._fetch(`/providers/proxmox/sites/${this._s(siteId)}/hosts/${this._a(agentId)}/mark-failed`, 'GET');
  }

  /**
   * Begin a site-link enrollment — mint the one-line agent-install command.
   *
   * @param {object} [params]
   * @param {string} [params.siteId] - Enroll into an existing site (404 if missing).
   * @param {string} [params.alias]
   * @param {string} [params.displayName]
   * @returns {Promise<{ token: string, expiresAt: string, command: string, zeusUrl: string, siteId: string }>}
   * @example
   * const { command } = await sdk.providers.proxmox.sites.linkInit({ alias: 'indy' });
   */
  linkInit({ siteId, alias, displayName } = {}) {
    return this.sdk._fetch('/providers/proxmox/sites/link/init', 'POST', {
      body: { siteId, alias, displayName },
    });
  }

  /**
   * Poll enrollment status for a link token.
   *
   * @param {object} params
   * @param {string} params.token - The enrollment token (required).
   * @returns {Promise<object>} `getEnrollStatus(token)` — live host count + host list.
   * @example
   * const status = await sdk.providers.proxmox.sites.linkStatus({ token: 'enr_...' });
   */
  linkStatus({ token }) {
    return this.sdk._fetch('/providers/proxmox/sites/link/status', 'GET', { query: { token } });
  }

  /**
   * Import an offline `zeus doctor` USB-export bundle (a `zeus-report-*.zip`,
   * plan §3/§6 item 5) for one-off viewing. Parsed in memory server-side only —
   * never persisted. Send the raw zip bytes as a base64 string.
   *
   * @param {object} params
   * @param {string} params.fileBase64 - The `.zip` file contents, base64-encoded.
   * @param {string} [params.filename]
   * @returns {Promise<{ report: object, configHistory: Array|null }>}
   * @example
   * const { report } = await sdk.providers.proxmox.sites.importDoctorReport({ fileBase64 });
   */
  importDoctorReport({ fileBase64, filename }) {
    return this.sdk._fetch('/providers/proxmox/doctor-report-import', 'POST', {
      body: { fileBase64, filename },
    });
  }
}
