// @ts-nocheck
/**
 * ProxmoxConnectService — connector-agent enrollment + bootstrap helpers.
 *
 * Accessed as `sdk.providers.proxmox.connect`.
 *
 * Before Zeus can talk to a Proxmox fleet, a `zeus-agent` connector must be
 * installed on a PVE node and enrolled into a site. These endpoints issue the
 * one-line install command, mint a PVE API token through an online connector,
 * discover cluster facts without a token (pvesh as local root), and roll the
 * connector out across every other node in a PVE cluster for HA.
 */
export class ProxmoxConnectService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Issue a connector-agent install command for a Proxmox account/site. Either
   * targets an existing `siteId` or creates a new connector site from `alias`.
   *
   * @param {object} [params]
   * @param {string} [params.siteId] - Existing connector site id to enroll into.
   * @param {string} [params.alias]  - Alias for a new connector site (default 'proxmox-connector').
   * @returns {Promise<{ token: string, expiresAt: string, command: string, siteId: string }>}
   *   `command` is the `curl ... | bash -s -- <token>` line to run on the PVE node.
   * @example
   * const { command } = await sdk.providers.proxmox.connect.issueCommand({ alias: 'indy-prox' });
   */
  issueCommand({ siteId, alias } = {}) {
    return this.sdk._fetch('/providers/proxmox/connect', 'POST', { body: { siteId, alias } });
  }

  /**
   * List PVE cluster nodes (for the connector-rollout picker) via an online connector.
   *
   * @param {object} params
   * @param {string} params.accountId - Proxmox account id.
   * @returns {Promise<{ self: string|null, nodes: Array<{ name: string, ip: string, isSelf: boolean, hasConnector: boolean, online: boolean, agentId: string|null, agentVersion: string|null, role: string }> }>}
   * @example
   * const { nodes } = await sdk.providers.proxmox.connect.clusterNodes({ accountId: 'acc1' });
   */
  clusterNodes({ accountId }) {
    return this.sdk._fetch('/providers/proxmox/connect/cluster-nodes', 'POST', { body: { accountId } });
  }

  /**
   * Mint a Proxmox API token through a connector agent (runs `pveum` as local root).
   *
   * @param {object} params
   * @param {string} params.connectorAgentId - Agent id to run the command on.
   * @param {string} [params.user='root@pam'] - PVE user to create the token for.
   * @param {string} [params.name='zeus-automation'] - Token name.
   * @returns {Promise<{ tokenId: string, tokenSecret: string }>}
   * @example
   * const { tokenId, tokenSecret } = await sdk.providers.proxmox.connect.createToken({ connectorAgentId: 'ag1' });
   */
  createToken({ connectorAgentId, user, name }) {
    return this.sdk._fetch('/providers/proxmox/connect/create-token', 'POST', {
      body: { connectorAgentId, user, name },
    });
  }

  /**
   * Discover PVE facts (version, nodes, storages, bridges, templates) via a
   * connector agent — no PVE token required (pvesh runs as local root).
   *
   * @param {object} params
   * @param {string} params.connectorAgentId - Agent id to run discovery on.
   * @param {string} [params.node] - Optional specific node to scope discovery to.
   * @returns {Promise<{ version: string, nodes: Array, storages: Array, bridges: Array, templates: Array, node?: string }>}
   *   The raw `discoverFacts` object (returned verbatim, not wrapped).
   * @example
   * const facts = await sdk.providers.proxmox.connect.discover({ connectorAgentId: 'ag1' });
   */
  discover({ connectorAgentId, node }) {
    return this.sdk._fetch('/providers/proxmox/connect/discover', 'POST', {
      body: { connectorAgentId, node },
    });
  }

  /**
   * HA connector rollout — install `zeus-agent` on every other node of the PVE
   * cluster and enroll them into the account's connector site. STREAMING (SSE).
   *
   * @param {object} params
   * @param {string} params.accountId - Proxmox account id.
   * @param {string[]} [params.nodes] - Optional subset of node names to target.
   * @returns {ReturnType<import('../../../stream.js').openStream>} SSE stream handle (async-iterable +
   *   onMessage/onDone/onError + close()). Emits step/info/warn/success/error frames; the
   *   terminal `done` payload is `{ message, connectors, enrolledPeers: [{ node, agentId }] }`.
   * @example
   * const s = sdk.providers.proxmox.connect.rollout({ accountId: 'acc1' });
   * for await (const ev of s) console.log(ev);
   */
  rollout({ accountId, nodes }) {
    return this.sdk._stream('/providers/proxmox/connect/rollout', 'POST', {
      body: { accountId, nodes },
    });
  }

  /**
   * Poll whether a connector rollout is currently running for an account
   * (so the client can avoid re-subscribing to a finished run).
   *
   * @param {object} params
   * @param {string} params.accountId - Proxmox account id.
   * @returns {Promise<{ inFlight: boolean }>}
   * @example
   * const { inFlight } = await sdk.providers.proxmox.connect.rolloutInFlight({ accountId: 'acc1' });
   */
  rolloutInFlight({ accountId }) {
    return this.sdk._fetch('/providers/proxmox/connect/rollout/in-flight', 'POST', {
      body: { accountId },
    });
  }
}
