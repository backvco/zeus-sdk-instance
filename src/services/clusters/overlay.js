// @ts-nocheck
/**
 * ClusterOverlayService — the WireGuard/NetBird cross-cluster mesh overlay for a
 * single cluster. Accessed as `sdk.clusters.overlay`.
 *
 * The overlay enrolls a cluster into a mesh so its pods can reach pods in other
 * clusters over the z-NN.local namespace. Methods cover enrollment, access
 * policies, connectivity diagnostics (probe / dns-tls-test / diagnose / speedtest),
 * the per-cluster router settings, and ingress-host discovery.
 *
 * Streaming methods (enroll, the connectivity *tests*, and the root teardown
 * DELETE) return an SSE stream handle; the terminal `done` event carries the
 * result (typically `{ ok, ... }` or `{ ok:false, error }`). The connectivity
 * test routes also persist results: GET lists prior runs, DELETE removes one.
 *
 * All methods are container + cluster scoped: pass `{ container, name, ... }`.
 * Overlay POST/enroll/test routes read `branch` from the body; GET/DELETE read it
 * from the query (both default 'main').
 */
export class ClusterOverlayService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  /**
   * Persisted + live overlay status.
   * @param {object} params - container, name, connection? (def 'overlay'), branch.
   * @returns {Promise<{ persisted, live, liveError? }>}
   * @example const { live } = await sdk.clusters.overlay.status({ container:'app1', name:'z-01' });
   */
  status({ container, name, connection, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/status`, 'GET', { query: { connection, branch } });
  }

  /**
   * Enroll the cluster into the mesh overlay. STREAMING.
   * @param {object} params - container, name, connection? (def 'overlay'), branch? (def 'main'), routerSettings?.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ ok, message, overlay:{ groupId, networkId } }`.
   * @example const s = sdk.clusters.overlay.enroll({ container:'app1', name:'z-01' });
   */
  enroll({ container, name, connection, branch, routerSettings }) {
    return this.sdk._stream(`${this._base(container, name)}/overlay/enroll`, 'POST', { body: { connection, branch, routerSettings } });
  }

  /**
   * Remove (teardown) the overlay enrollment. STREAMING.
   * @param {object} params - container, name, connection? (def 'overlay'), branch.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ ok, message, removed }`.
   * @example const s = sdk.clusters.overlay.teardown({ container:'app1', name:'z-01' });
   */
  teardown({ container, name, connection, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/overlay`, 'DELETE', { query: { connection, branch } });
  }

  /**
   * Get the overlay access policies for this cluster.
   * @param {object} params - container, name, connection? (def 'overlay'), branch.
   * @returns {Promise<{ access }>}
   * @example const { access } = await sdk.clusters.overlay.access({ container:'app1', name:'z-01' });
   */
  access({ container, name, connection, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/access`, 'GET', { query: { connection, branch } });
  }

  /**
   * Grant an overlay access policy (this cluster → another peer).
   * @param {object} params - container, name + body: to (required), ports?, protocol?, bidi?, connection? (def 'overlay'), branch?.
   * @returns {Promise<{ ok, policy: { id, name } }>}
   * @example await sdk.clusters.overlay.grantAccess({ container:'app1', name:'z-01', to:'z-02' });
   */
  grantAccess({ container, name, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/access`, 'POST', { body });
  }

  /**
   * Revoke an overlay access policy.
   * @param {object} params - container, name, connection? (def 'overlay'), branch, to (required), ports? (csv string).
   * @returns {Promise<{ ok, deleted }>}
   * @example await sdk.clusters.overlay.revokeAccess({ container:'app1', name:'z-01', to:'z-02' });
   */
  revokeAccess({ container, name, connection, branch, to, ports }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/access`, 'DELETE', { query: { connection, branch, to, ports } });
  }

  /**
   * Probe overlay peer reachability (non-streaming snapshot).
   * @param {object} params - container, name.
   * @returns {Promise<{ ok, peers, source?, ageS? }>}
   * @example const { peers } = await sdk.clusters.overlay.probe({ container:'app1', name:'z-01' });
   */
  probe({ container, name }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/probe`, 'GET');
  }

  /**
   * List saved DNS/TLS test results.
   * @returns {Promise<{ tests }>}
   * @example const { tests } = await sdk.clusters.overlay.dnsTlsTests({ container:'app1', name:'z-01' });
   */
  dnsTlsTests({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/dns-tls-test`, 'GET', { query: { branch } });
  }

  /**
   * Run a DNS/TLS reachability test to a peer. STREAMING.
   * @param {object} params - container, name + body: to (required), testHost?, branch?.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ ok, ... }`.
   * @example const s = sdk.clusters.overlay.runDnsTlsTest({ container:'app1', name:'z-01', to:'z-02' });
   */
  runDnsTlsTest({ container, name, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/overlay/dns-tls-test`, 'POST', { body });
  }

  /**
   * Delete a saved DNS/TLS test result.
   * @param {object} params - container, name, id (required), branch.
   * @returns {Promise<{ deleted }>}
   * @example await sdk.clusters.overlay.deleteDnsTlsTest({ container:'app1', name:'z-01', id:'t1' });
   */
  deleteDnsTlsTest({ container, name, id, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/dns-tls-test`, 'DELETE', { query: { id, branch } });
  }

  /**
   * List saved connectivity-diagnose results.
   * @returns {Promise<{ tests }>}
   * @example const { tests } = await sdk.clusters.overlay.diagnostics({ container:'app1', name:'z-01' });
   */
  diagnostics({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/diagnose`, 'GET', { query: { branch } });
  }

  /**
   * Run a connectivity diagnose to a peer. STREAMING.
   * @param {object} params - container, name + body: to (required), destOverlayIp?, branch?.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ ok }`.
   * @example const s = sdk.clusters.overlay.runDiagnose({ container:'app1', name:'z-01', to:'z-02' });
   */
  runDiagnose({ container, name, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/overlay/diagnose`, 'POST', { body });
  }

  /**
   * Delete a saved diagnose result.
   * @param {object} params - container, name, id (required), branch.
   * @returns {Promise<{ deleted }>}
   * @example await sdk.clusters.overlay.deleteDiagnose({ container:'app1', name:'z-01', id:'d1' });
   */
  deleteDiagnose({ container, name, id, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/diagnose`, 'DELETE', { query: { id, branch } });
  }

  /**
   * List saved speedtest results.
   * @returns {Promise<{ tests }>}
   * @example const { tests } = await sdk.clusters.overlay.speedtests({ container:'app1', name:'z-01' });
   */
  speedtests({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/speedtest`, 'GET', { query: { branch } });
  }

  /**
   * Run a pod-to-pod speedtest to a peer. STREAMING.
   * @param {object} params - container, name + body: to (required), mode? ('size'|'duration', def 'duration'),
   *   value? (def 100 for size / 10 for duration), probes?, srcNodeGroup?, dstNodeGroup?, connection?, branch?.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ ok, result }`.
   * @example const s = sdk.clusters.overlay.runSpeedtest({ container:'app1', name:'z-01', to:'z-02' });
   */
  runSpeedtest({ container, name, ...body }) {
    return this.sdk._stream(`${this._base(container, name)}/overlay/speedtest`, 'POST', { body });
  }

  /**
   * Delete a saved speedtest result.
   * @param {object} params - container, name, id (required), branch.
   * @returns {Promise<{ deleted }>}
   * @example await sdk.clusters.overlay.deleteSpeedtest({ container:'app1', name:'z-01', id:'s1' });
   */
  deleteSpeedtest({ container, name, id, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/speedtest`, 'DELETE', { query: { id, branch } });
  }

  /**
   * List ingress hosts exposed over the mesh.
   * @returns {Promise<{ hosts: Array<{ host, meshHost, namespace, ingress }>, meshDomain }>}
   * @example const { hosts } = await sdk.clusters.overlay.ingressHosts({ container:'app1', name:'z-01' });
   */
  ingressHosts({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/ingress-hosts`, 'GET', { query: { branch } });
  }

  /**
   * Get the cluster's overlay router settings.
   * @returns {Promise<{ settings, nodeGroups, hasOverlayTunnelGroups, hasZones } | { provider:'gke', region, settings, tunnelVm, nodeGroups, hasOverlayTunnelGroups, hasZones }>}
   * @example const { settings } = await sdk.clusters.overlay.router({ container:'app1', name:'z-01' });
   */
  router({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/router`, 'GET', { query: { branch } });
  }

  /**
   * Update the cluster's overlay router settings (not supported on GKE → 400).
   * @param {object} params - container, name + body: settings, connection? (def 'overlay'), branch?.
   * @returns {Promise<{ ok, settings }>}
   * @example await sdk.clusters.overlay.setRouter({ container:'app1', name:'z-01', settings:{...} });
   */
  setRouter({ container, name, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/overlay/router`, 'POST', { body });
  }
}
