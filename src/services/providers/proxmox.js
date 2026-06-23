// @ts-nocheck
import { ProxmoxAccountsService } from './proxmox/accounts.js';
import { ProxmoxSitesService } from './proxmox/sites.js';
import { ProxmoxClustersService } from './proxmox/clusters.js';
import { ProxmoxConnectService } from './proxmox/connect.js';

/**
 * ProxmoxService — the Proxmox VE provider namespace.
 *
 * Accessed as `sdk.providers.proxmox`.
 *
 * Proxmox is a bare-metal / on-prem provider. Zeus reaches a Proxmox fleet
 * through a connector **agent** (`zeus-agent`) that dials out and exposes the
 * PVE API + a shell over a tunnel — there is no public PVE endpoint. The model:
 *
 *   - **account**  — one PVE cluster (credentials, connector agents, edge VMs,
 *     storage, networks, UniFi link, HA config, firewall). `sdk.providers.proxmox.accounts`
 *   - **site**     — a bare-metal "site" = a set of enrolled agent hosts that k3s
 *     clusters are built on. `sdk.providers.proxmox.sites`
 *   - **cluster**  — a k3s cluster running on a site/account. Lifecycle + per-cluster
 *     networking (ingress, IP pool, DNS, switch ports, WAN binding, zones).
 *     `sdk.providers.proxmox.clusters`
 *   - **connect**  — connector-agent enrollment helpers: issue install commands,
 *     mint PVE tokens, discover facts, HA rollout across nodes.
 *     `sdk.providers.proxmox.connect`
 *
 * Typical lifecycle: enroll a connector (`connect.issueCommand`) → add an account
 * (`accounts.create` / `accounts.verify`) → discover storage & networks → build a
 * VM template (`accounts.buildTemplate`) → create a cluster (`clusters.create`).
 */
export class ProxmoxService {
  constructor(sdk) {
    this.sdk = sdk;
    this.accounts = new ProxmoxAccountsService(sdk);
    this.sites = new ProxmoxSitesService(sdk);
    this.clusters = new ProxmoxClustersService(sdk);
    this.connect = new ProxmoxConnectService(sdk);
  }
}
