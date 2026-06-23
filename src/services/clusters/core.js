// @ts-nocheck
/**
 * ClustersCoreService — single-cluster inspect, storage-class, and lifecycle
 * (provision/destroy) methods. This is the base class for
 * {@link import('../clusters.js').ClustersService}; you never instantiate it
 * directly — call these as `sdk.clusters.<method>`.
 *
 * It's split out of the entry class purely to keep file sizes manageable; the
 * collection-level methods (list/create/import/drift/diff/...) and the seven
 * sub-namespaces live on the subclass. Path helpers `_col`/`_base` are defined
 * here and shared.
 *
 * All methods are container + cluster scoped: pass `{ container, name, ... }`.
 * Methods whose route reads `?branch=` (default 'main') accept an optional `branch`.
 */
export class ClustersCoreService {
  constructor(sdk) { this.sdk = sdk; }

  _col(container) {
    return `/v2configs/${encodeURIComponent(container)}/clusters`;
  }

  _base(container, name) {
    return `${this._col(container)}/${encodeURIComponent(name)}`;
  }

  // ─── Single cluster — inspect ────────────────────────────────────────────────

  /**
   * Get a cluster's resolved metadata (VPC, subnets, version, etc.).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {boolean} [params.refresh] - Force a live refresh.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ metadata: object }>}
   * @example
   * const { metadata } = await sdk.clusters.metadata({ container:'app1', name:'z-01', refresh:true });
   */
  metadata({ container, name, refresh, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/metadata`, 'GET', { query: { refresh: refresh ? '1' : undefined, branch } });
  }

  /**
   * List the cluster's service endpoints (NodePort/LoadBalancer hostnames).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ endpoints: Array<{ name, namespace, type, hostname, httpsNodePort, httpNodePort, ports }> }>}
   * @example
   * const { endpoints } = await sdk.clusters.endpoints({ container:'app1', name:'z-01' });
   */
  endpoints({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/endpoints`, 'GET', { query: { branch } });
  }

  /**
   * Get cluster bootstrap status (reachability + missing required addons).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ reachable, missing: Array<{ id, label, installName, why }>, error }>}
   * @example
   * const { reachable, missing } = await sdk.clusters.bootstrapStatus({ container:'app1', name:'z-01' });
   */
  bootstrapStatus({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/bootstrap-status`, 'GET', { query: { branch } });
  }

  /**
   * List pods on the cluster (all namespaces by default).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.namespace='__all'] - Namespace, or '__all'.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ pods: Array<object> }>}
   * @example
   * const { pods } = await sdk.clusters.pods({ container:'app1', name:'z-01', namespace:'default' });
   */
  pods({ container, name, namespace, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/pods`, 'GET', { query: { namespace, branch } });
  }

  /**
   * Get the cluster's primary security group + its rules.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ sg: object }>}
   * @example
   * const { sg } = await sdk.clusters.primarySg({ container:'app1', name:'z-01' });
   */
  primarySg({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/primary-sg`, 'GET', { query: { branch } });
  }

  /**
   * Authorize/revoke a rule on the cluster's primary security group.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {'authorize'|'revoke'} params.action
   * @param {'inbound'|'outbound'} params.direction
   * @param {object} params.rule - The rule object.
   * @param {string} [params.branch='main'] - Read from body.
   * @returns {Promise<{ sg, ok: true }>}
   * @example
   * await sdk.clusters.setPrimarySgRule({ container:'app1', name:'z-01', action:'authorize', direction:'inbound', rule:{...} });
   */
  setPrimarySgRule({ container, name, action, direction, rule, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/primary-sg`, 'POST', { body: { action, direction, rule, branch } });
  }

  /**
   * Get the cluster's DNS alias state (record, target, sync status, wildcard).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ dnsAlias, nlbHostname, target, recordType, targetSource, accountIngressHostname, zone, currentTarget, inSync, desired, wildcard }>}
   * @example
   * const dns = await sdk.clusters.dns({ container:'app1', name:'z-01' });
   */
  dns({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/dns`, 'GET', { query: { branch } });
  }

  /**
   * Run a DNS action: 'preflight', 'apply', or 'apply-wildcard'. (branch fixed 'main')
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {'preflight'|'apply'|'apply-wildcard'} params.action
   * @returns {Promise<{ preflight, zone } | { result }>}
   * @example
   * await sdk.clusters.dnsAction({ container:'app1', name:'z-01', action:'apply' });
   */
  dnsAction({ container, name, action }) {
    return this.sdk._fetch(`${this._base(container, name)}/dns`, 'POST', { body: { action } });
  }

  /**
   * Hydrate (backfill) a cluster's metadata from live cloud state.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ cluster, additions }>}
   * @example
   * await sdk.clusters.hydrateMetadata({ container:'app1', name:'z-01' });
   */
  hydrateMetadata({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/hydrate-metadata`, 'POST', { body: {}, query: { branch } });
  }

  /**
   * Get CPU architectures present per node group (and the cluster default).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @returns {Promise<{ archs: Record<string, string[]>, default: string, error? }>}
   * @example
   * const { archs, default: def } = await sdk.clusters.nodeGroupArchs({ container:'app1', name:'z-01' });
   */
  nodeGroupArchs({ container, name }) {
    return this.sdk._fetch(`${this._base(container, name)}/node-group-archs`, 'GET');
  }

  // ─── Storage classes ─────────────────────────────────────────────────────────

  /**
   * List the cluster's storage classes (live).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @returns {Promise<{ storageClasses: Array<object> }>}
   * @example
   * const { storageClasses } = await sdk.clusters.storageClasses({ container:'app1', name:'z-01' });
   */
  storageClasses({ container, name }) {
    return this.sdk._fetch(`${this._base(container, name)}/storage-classes`, 'GET');
  }

  /**
   * Apply the cluster's desired storage classes (returns JSON, not a stream).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ success, results: Array<{ name, status, error?, message?, diff? }>, note? }>}
   * @example
   * await sdk.clusters.applyStorageClasses({ container:'app1', name:'z-01' });
   */
  applyStorageClasses({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/storage-classes/apply`, 'POST', { body: {}, query: { branch } });
  }

  /**
   * Diff desired vs live storage classes.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {boolean} [params.all] - Include all classes (pass true → ?all=1).
   * @param {string} [params.branch='main']
   * @returns {Promise<{ entries: Array<{ name, status, planned, live, liveRaw }> }>}
   * @example
   * const { entries } = await sdk.clusters.storageClassesDiff({ container:'app1', name:'z-01' });
   */
  storageClassesDiff({ container, name, all, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/storage-classes/diff`, 'GET', { query: { all: all ? '1' : undefined, branch } });
  }

  // ─── Provision / destroy (streaming) ──────────────────────────────────────────

  /**
   * Provision (build) the cloud cluster. STREAMING.
   * @param {object} params - container, name, branch + body: roleArn, createRole? (def true),
   *   subnetIds, securityGroupIds? (def []), addons? (def []), vpcIngressCidr?, vpcBundle?,
   *   rollbackOnFailure? (def true). GKE extra: networkName, subnetworkName, podRangeName,
   *   servicesRangeName, serviceAccount, secretsKeyName.
   * @returns {ReturnType<import('../../base.js').BaseSDK['_stream']>} SSE stream (sync 400/404/409 errors
   *   arrive as `{ error, inFlight? }` before the stream starts).
   * @example
   * const s = sdk.clusters.provision({ container:'app1', name:'z-05', subnetIds:['subnet-a'] });
   * for await (const ev of s) console.log(ev);
   */
  provision({ container, name, branch, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/provision`, 'POST', { body, query: { branch } });
  }

  /**
   * Provision a draft cluster (dry-style build). STREAMING.
   * @param {object} params - container, name, branch + body: roleArn, createRole? (def true),
   *   subnetIds, securityGroupIds? (def []), addons? (def []).
   * @returns {ReturnType<import('../../base.js').BaseSDK['_stream']>} SSE stream.
   * @example
   * const s = sdk.clusters.provisionDraft({ container:'app1', name:'z-05', subnetIds:['subnet-a'] });
   */
  provisionDraft({ container, name, branch, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/provision-draft`, 'POST', { body, query: { branch } });
  }

  /**
   * Preview a cluster destroy (steps/warnings or the resource inventory).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {boolean} [params.preflight] - true → `{ steps, warnings }`; otherwise `{ preview, vpcBundle }`.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ steps, warnings } | { preview, vpcBundle }>}
   * @example
   * const { preview } = await sdk.clusters.destroyPreview({ container:'app1', name:'z-05' });
   */
  destroyPreview({ container, name, preflight, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/destroy`, 'GET', { query: { preflight: preflight ? '1' : undefined, branch } });
  }

  /**
   * Destroy the cloud cluster. STREAMING. `confirm` must equal the cluster name.
   * @param {object} params - container, name, branch + body. EKS/GKE: { confirm, force? (def false),
   *   unmanageOnly? (def false), dropJsonOnSuccess? (def true), deleteSelections? (def []),
   *   destroyVpcBundle? }. k3s: { confirm, deleteSelections? (def []) }.
   * @returns {ReturnType<import('../../base.js').BaseSDK['_stream']>} SSE stream (sync 400/404/409 errors
   *   arrive as `{ error, inFlight? }` before the stream starts).
   * @example
   * const s = sdk.clusters.destroy({ container:'app1', name:'z-05', confirm:'z-05' });
   * for await (const ev of s) console.log(ev);
   */
  destroy({ container, name, branch, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/destroy`, 'POST', { body, query: { branch } });
  }
}
