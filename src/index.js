// @ts-nocheck
/**
 * zeus-sdk-instance — JavaScript client for the Zeus *instance* API.
 *
 * This is the API of a deployed Zeus app (the thing that manages your
 * Kubernetes clusters, environments, and infrastructure) — distinct from the
 * Zeus *Console* API (`zeus-sdk`), which manages billing/licensing across
 * instances.
 *
 * ─── Quick start ──────────────────────────────────────────────────────────────
 *
 * Browser (the page is already served from the instance host — cookie auth):
 *
 *   import { ZeusInstanceSDK } from '@zeusk8s/sdk-instance';
 *   const sdk = new ZeusInstanceSDK();                  // baseURL defaults to '/api'
 *   const { containers } = await sdk.containers.list();
 *
 * Node / scripts / LLM tools (point at an instance, authenticate with a token):
 *
 *   import { ZeusInstanceSDK } from '@zeusk8s/sdk-instance';
 *   const sdk = new ZeusInstanceSDK({
 *     instance: 'acme',                  // first hostname label; unique per customer
 *     rootUrl:  'my-dev.zeusk8s.com',    // default 'my.zeusk8s.com' (prod); or set ZEUS_ROOT_URL
 *     token:    process.env.ZEUS_TOKEN,  // 'zeus_...' service token → Authorization: Bearer
 *   });
 *   // resolves baseURL → https://acme.my-dev.zeusk8s.com/api
 *   const { clusters } = await sdk.clusters.list({ container: 'app1' });
 *
 * ─── Auth ─────────────────────────────────────────────────────────────────────
 *   Browser — session cookie (sent automatically; no token needed).
 *   Node    — `token` (service token → Bearer) or `devKey` (→ x-dev-key header).
 *
 * ─── Errors ───────────────────────────────────────────────────────────────────
 *   Methods throw {@link ZeusApiError} on non-2xx (`.status`, `.body`, `.endpoint`).
 *   A 412 reachability gate throws {@link ReachabilityAckRequiredError}.
 *
 * ─── Streaming ────────────────────────────────────────────────────────────────
 *   Long-running operations (cluster provision/destroy, image builds, helm
 *   rollouts, k8s logs/watch, the unified runs log, help chat) return a stream
 *   handle — async-iterable and/or `onMessage`/`onDone` callbacks, with
 *   `close()`. See {@link openStream}.
 *
 * ─── Services ─────────────────────────────────────────────────────────────────
 *   sdk.auth            — login, logout, session, user setup, password reset, directory
 *   sdk.containers      — workspaces (config, list, create, delete)
 *   sdk.clusters        — clusters + .nodegroups .security .upgrade .storage .certs .overlay .extras
 *   sdk.services        — services + .identities .registry .runs
 *   sdk.environments    — environments, DNS, backup profiles
 *   sdk.infrastructure  — helm/EKS add-ons + .backups .rotate
 *   sdk.connections     — external-system connections + categories
 *   sdk.registries      — container image registries + pull secrets
 *   sdk.networkBundles  — VPC desired-state bundles
 *   sdk.networkPlans    — CIDR plans + slots
 *   sdk.deploy          — deploy/dryrun/generate/validate/env-files/common/github/identities
 *   sdk.k8s             — pods/nodes/deployments/logs(SSE)/watch(SSE)/events + .logs .flags
 *   sdk.runs            — unified run history + live stream (SSE)
 *   sdk.alerts          — cluster alerts
 *   sdk.amiRecipes      — AMI build recipes + builds (SSE)
 *   sdk.settings        — .auth .builders .github .mail .npmTokens .serviceTokens .pricing .system
 *   sdk.help            — assistant chat (SSE) + sessions + settings
 *   sdk.system          — egress/whoami IP, tooling, pricing, presets, geocode, fs browse
 *   sdk.agent           — bare-metal/proxmox agent enroll/rekey
 *   sdk.replication     — MySQL InnoDB ClusterSet replication board (discover/status/setMetrics)
 *   sdk.providers.aws   — AWS accounts, regions, VPC adopt, S3, IAM, Route53, setup
 *   sdk.providers.gcp   — GCP accounts/projects, images(SSE), machine types, workload identity
 *   sdk.providers.proxmox — Proxmox accounts, sites, clusters, connect (lots of SSE)
 *   sdk.providers.dns   — DNS zones, records, delegation check, lookup
 *
 * See the `docs/` directory for a per-service method reference (humans + LLMs).
 */

import { BaseSDK } from './base.js';

import { AuthService } from './services/auth.js';
import { ContainersService } from './services/containers.js';
import { ClustersService } from './services/clusters.js';
import { ServicesService } from './services/services.js';
import { EnvironmentsService } from './services/environments.js';
import { InfrastructureService } from './services/infrastructure.js';
import { ConnectionsService } from './services/connections.js';
import { RegistriesService } from './services/registries.js';
import { NetworkBundlesService } from './services/network-bundles.js';
import { NetworkPlansService } from './services/network-plans.js';
import { DeployService } from './services/deploy.js';
import { K8sService } from './services/k8s.js';
import { RunsService } from './services/runs.js';
import { AlertsService } from './services/alerts.js';
import { AmiRecipesService } from './services/ami-recipes.js';
import { SettingsService } from './services/settings.js';
import { HelpService } from './services/help.js';
import { SystemService } from './services/system.js';
import { AgentService } from './services/agent.js';
import { ReplicationService } from './services/replication.js';
import { AwsService } from './services/providers/aws.js';
import { GcpService } from './services/providers/gcp.js';
import { ProxmoxService } from './services/providers/proxmox.js';
import { DnsService } from './services/providers/dns.js';

export { BaseSDK, deriveInstanceFromLocation } from './base.js';
export { ZeusApiError, ReachabilityAckRequiredError } from './errors.js';
export { openStream, ZeusStreamError } from './stream.js';

export class ZeusInstanceSDK extends BaseSDK {
  /**
   * @param {object} [opts] - See {@link BaseSDK} for all options
   *   (`baseURL`, `instance`, `rootUrl`, `token`, `devKey`, `fetch`).
   */
  constructor(opts = {}) {
    super(opts);

    this.auth = new AuthService(this);
    this.containers = new ContainersService(this);
    this.clusters = new ClustersService(this);
    this.services = new ServicesService(this);
    this.environments = new EnvironmentsService(this);
    this.infrastructure = new InfrastructureService(this);
    this.connections = new ConnectionsService(this);
    this.registries = new RegistriesService(this);
    this.networkBundles = new NetworkBundlesService(this);
    this.networkPlans = new NetworkPlansService(this);
    this.deploy = new DeployService(this);
    this.k8s = new K8sService(this);
    this.runs = new RunsService(this);
    this.alerts = new AlertsService(this);
    this.amiRecipes = new AmiRecipesService(this);
    this.settings = new SettingsService(this);
    this.help = new HelpService(this);
    this.system = new SystemService(this);
    this.agent = new AgentService(this);
    this.replication = new ReplicationService(this);

    /** Cloud/infra provider namespaces. */
    this.providers = {
      aws: new AwsService(this),
      gcp: new GcpService(this),
      proxmox: new ProxmoxService(this),
      dns: new DnsService(this),
    };
  }

  /**
   * Construct an SDK that auto-derives the instance from the browser location
   * and calls same-origin `/api`. Equivalent to `new ZeusInstanceSDK()` in the
   * browser, but explicit for readability.
   *
   * @param {object} [opts]
   * @returns {ZeusInstanceSDK}
   */
  static fromBrowser(opts = {}) {
    return new ZeusInstanceSDK({ ...opts });
  }
}
