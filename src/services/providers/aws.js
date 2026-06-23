// @ts-nocheck
import { AwsAccountsService } from './aws/accounts.js';
import { AwsLinkSetupService } from './aws/link-setup.js';

/**
 * AwsService — the AWS provider namespace.
 *
 * Accessed as `sdk.providers.aws`.
 *
 * Covers EKS cluster-access remediation, region/VPC/AZ/EKS-version discovery,
 * VPC adopt, S3 bucket helpers, per-provider settings (favorited regions), the
 * IAM permission coverage check + smoke tests + tier registry, and the low-level
 * `/api/aws/*` resource probes (EC2 describe, IRSA role management, Route53).
 * The linked-account store is `sdk.providers.aws.accounts`; the CLI-driven
 * account-link and permission-fix flows are `sdk.providers.aws.linkSetup`.
 *
 * Typical lifecycle: link an account (`linkSetup.linkInit` or `accounts.create`)
 * → verify (`accounts.verify`) → run `permissionsCheck` → grant any cluster
 * access (`clusterAccessGrant`) → discover regions/VPCs to provision into.
 *
 * Many read methods accept an optional `accountId` to scope the query to one
 * linked account; omit it to use the default account (which itself degrades to
 * the ambient credential chain when no accounts are linked).
 */
export class AwsService {
  constructor(sdk) {
    this.sdk = sdk;
    this.accounts = new AwsAccountsService(sdk);
    this.linkSetup = new AwsLinkSetupService(sdk);
  }

  _r(region) { return encodeURIComponent(region); }

  // ── EKS cluster access ──────────────────────────────────────

  /**
   * Per-cluster EKS access state for every AWS-EKS cluster Zeus knows (across all
   * containers). Reports whether the resolved principal has an access entry.
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Scope to one linked account's principal.
   * @returns {Promise<{ principalArn: string, clusters: Array<object> }>}
   * @example
   * const { clusters } = await sdk.providers.aws.clusterAccess();
   */
  clusterAccess({ accountId } = {}) {
    return this.sdk._fetch('/providers/aws/cluster-access', 'GET', { query: { accountId } });
  }

  /**
   * Register the current principal as cluster-admin (or another policy) on the
   * given EKS clusters. Idempotent — already-registered clusters report as no-ops.
   *
   * @param {object} params
   * @param {Array<{ name: string, region: string, accountId?: string, clusterArn?: string }>} params.clusters - Targets.
   * @param {string} [params.policy] - Access policy key (default 'clusterAdmin').
   * @param {string} [params.accountId] - Account whose principal to grant (query).
   * @returns {Promise<{ principalArn: string, policyArn: string, results: Array<object> }>}
   * @example
   * await sdk.providers.aws.clusterAccessGrant({ clusters: [{ name: 'z-01', region: 'us-east-2' }] });
   */
  clusterAccessGrant({ clusters, policy, accountId }) {
    return this.sdk._fetch('/providers/aws/cluster-access', 'POST', {
      body: { clusters, policy },
      query: { accountId },
    });
  }

  /**
   * EKS clusters grouped by vpcId in a region (stored config only, no AWS calls).
   *
   * @param {object} params
   * @param {string} params.region      - AWS region (required).
   * @param {string} [params.accountId] - Filter to one account.
   * @returns {Promise<{ byVpcId: Record<string, Array<{ name: string, container: string }>> }>}
   * @example
   * const { byVpcId } = await sdk.providers.aws.clustersByVpc({ region: 'us-east-2' });
   */
  clustersByVpc({ region, accountId }) {
    return this.sdk._fetch('/providers/aws/clusters-by-vpc', 'GET', { query: { region, accountId } });
  }

  /**
   * Aggregate EKS cluster drift across every container (live vs stored spec).
   *
   * @param {object} [params]
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ clusters: Array<object>, summary: object }>}
   * @example
   * const { clusters, summary } = await sdk.providers.aws.clustersDrift();
   */
  clustersDrift({ branch } = {}) {
    return this.sdk._fetch('/providers/aws/clusters-drift', 'GET', { query: { branch } });
  }

  // ── Identity & regions ──────────────────────────────────────

  /**
   * Caller identity (STS GetCallerIdentity) for the resolved account.
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Scope to one linked account.
   * @returns {Promise<{ callerArn: string, account: string, userId?: string, principalArn: string, principal: { kind: string, name: string|null, arn: string } }>}
   * @example
   * const { account, principalArn } = await sdk.providers.aws.identity();
   */
  identity({ accountId } = {}) {
    return this.sdk._fetch('/providers/aws/identity', 'GET', { query: { accountId } });
  }

  /**
   * Enumerate AWS regions (ec2:DescribeRegions) overlaid with which regions host
   * zeus-managed clusters.
   *
   * @returns {Promise<{ regions: Array<{ name: string, optInStatus: string, endpoint?: string, hasClusters: boolean, clusters: Array<object> }>> }>}
   * @example
   * const { regions } = await sdk.providers.aws.regions();
   */
  regions() { return this.sdk._fetch('/providers/aws/regions', 'GET'); }

  /**
   * Available AZs in a region.
   *
   * @param {object} params
   * @param {string} params.region - AWS region.
   * @returns {Promise<{ azs: Array<{ name: string, state: string, type: string }> }>}
   * @example
   * const { azs } = await sdk.providers.aws.regionAzs({ region: 'us-east-2' });
   */
  regionAzs({ region }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/azs`, 'GET');
  }

  /**
   * EKS K8s versions available in a region (for the provision wizard).
   *
   * @param {object} params
   * @param {string} params.region - AWS region.
   * @returns {Promise<{ versions: Array<string> }>}
   * @example
   * const { versions } = await sdk.providers.aws.regionEksVersions({ region: 'us-east-2' });
   */
  regionEksVersions({ region }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/eks-versions`, 'GET');
  }

  /**
   * Security groups in a region (optionally filtered to a VPC), with an
   * `allowsOutbound` flag (covers TCP 80/443 to 0.0.0.0/0).
   *
   * @param {object} params
   * @param {string} params.region      - AWS region.
   * @param {string} [params.vpcId]     - Filter to a VPC.
   * @param {string} [params.accountId] - Scope to one linked account.
   * @returns {Promise<{ groups: Array<{ id: string, name: string, description: string, vpcId: string, isDefault: boolean, allowsOutbound: boolean }>> }>}
   * @example
   * const { groups } = await sdk.providers.aws.regionSecurityGroups({ region: 'us-east-2', vpcId: 'vpc-abc' });
   */
  regionSecurityGroups({ region, vpcId, accountId }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/security-groups`, 'GET', {
      query: { vpcId, accountId },
    });
  }

  /**
   * Live VPCs in a region with zeus bundle-ownership overlay (includes
   * not-yet-applied bundles as orphan entries).
   *
   * @param {object} params
   * @param {string} params.region      - AWS region.
   * @param {string} [params.accountId] - Scope to one linked account.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ vpcs: Array<{ id: string|null, cidr: string, name: string, isDefault: boolean, state: string, zeusManaged?: boolean, vpcBundle?: string|null, bundleConfig: { name: string }|null }>> }>}
   * @example
   * const { vpcs } = await sdk.providers.aws.regionVpcs({ region: 'us-east-2' });
   */
  regionVpcs({ region, accountId, branch }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/vpcs`, 'GET', {
      query: { accountId, branch },
    });
  }

  /**
   * Read-only detail for one live VPC (zeus-managed or not). 404 if not found.
   *
   * @param {object} params
   * @param {string} params.region - AWS region.
   * @param {string} params.vpcId  - VPC id.
   * @returns {Promise<{ vpc: object, subnets: Array<object>, nats: Array<object>, igws: Array<object>, routeTables: Array<object> }>}
   * @example
   * const { vpc, subnets } = await sdk.providers.aws.vpc({ region: 'us-east-2', vpcId: 'vpc-abc' });
   */
  vpc({ region, vpcId }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/vpcs/${encodeURIComponent(vpcId)}`, 'GET');
  }

  /**
   * Preview adopting a live VPC into zeus management (pure read; no mutation).
   *
   * @param {object} params
   * @param {string} params.region      - AWS region.
   * @param {string} params.vpcId       - VPC id.
   * @param {string} [params.accountId] - Scope to one linked account.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ preview: { vpc: object, alreadyAdopted: boolean, bundle?: object, status?: object, tagPlan?: object, warnings?: Array, summary?: object, bundleJsonMissing?: boolean } }>}
   * @example
   * const { preview } = await sdk.providers.aws.vpcAdoptPreview({ region: 'us-east-2', vpcId: 'vpc-abc' });
   */
  vpcAdoptPreview({ region, vpcId, accountId, branch }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/vpcs/${encodeURIComponent(vpcId)}/adopt`, 'GET', {
      query: { accountId, branch },
    });
  }

  /**
   * Adopt a live VPC: apply zeus tags + write the bundle JSON. 409 if the bundle
   * name already exists.
   *
   * @param {object} params
   * @param {string} params.region      - AWS region.
   * @param {string} params.vpcId       - VPC id.
   * @param {string} params.bundleName  - New bundle name (lowercase letters/digits/dashes).
   * @param {boolean} [params.dryRun]   - Preview the writes without applying.
   * @param {string} [params.accountId] - Account the bundle lives in.
   * @param {string} [params.branch='main'] - Config branch (query).
   * @returns {Promise<{ bundle: object, dryRun: boolean }>}
   * @example
   * await sdk.providers.aws.vpcAdopt({ region: 'us-east-2', vpcId: 'vpc-abc', bundleName: 'main' });
   */
  vpcAdopt({ region, vpcId, bundleName, dryRun, accountId, branch }) {
    return this.sdk._fetch(`/providers/aws/regions/${this._r(region)}/vpcs/${encodeURIComponent(vpcId)}/adopt`, 'POST', {
      body: { bundleName, dryRun, accountId },
      query: { branch },
    });
  }

  // ── S3 ──────────────────────────────────────────────────────

  /**
   * Create an S3 bucket (uses the default credential chain).
   *
   * @param {object} params
   * @param {string} params.name   - Bucket name (AWS naming rules).
   * @param {string} params.region - Bucket region.
   * @returns {Promise<{ bucket: { name: string, region: string } }>}
   * @example
   * await sdk.providers.aws.createBucket({ name: 'my-zeus-bucket', region: 'us-east-2' });
   */
  createBucket({ name, region }) {
    return this.sdk._fetch('/providers/aws/s3/create-bucket', 'POST', { body: { name, region } });
  }

  /**
   * List S3 buckets, optionally filtered to a region (resolves each bucket's region).
   *
   * @param {object} [params]
   * @param {string} [params.region] - Filter to a region.
   * @returns {Promise<{ buckets: Array<{ name: string, region: string|null }> }>}
   * @example
   * const { buckets } = await sdk.providers.aws.listBuckets({ region: 'us-east-2' });
   */
  listBuckets({ region } = {}) {
    return this.sdk._fetch('/providers/aws/s3/list-buckets', 'GET', { query: { region } });
  }

  // ── Settings ────────────────────────────────────────────────

  /**
   * Get AWS provider settings (favorited regions). First read auto-seeds from
   * regions that already host a cluster.
   *
   * @param {object} [params]
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ settings: { favoritedRegions: Array<string> } }>}
   * @example
   * const { settings } = await sdk.providers.aws.getSettings();
   */
  getSettings({ branch } = {}) {
    return this.sdk._fetch('/providers/aws/settings', 'GET', { query: { branch } });
  }

  /**
   * Replace the favorited-regions list.
   *
   * @param {object} params
   * @param {string[]} params.favoritedRegions - Region names.
   * @param {string} [params.branch='main']    - Config branch (query).
   * @returns {Promise<{ settings: { favoritedRegions: Array<string> } }>}
   * @example
   * await sdk.providers.aws.saveSettings({ favoritedRegions: ['us-east-2', 'us-west-2'] });
   */
  saveSettings({ favoritedRegions, branch }) {
    return this.sdk._fetch('/providers/aws/settings', 'PUT', { body: { favoritedRegions }, query: { branch } });
  }

  // ── Permissions / setup ─────────────────────────────────────

  /**
   * Run the full IAM policy-coverage check (SimulatePrincipalPolicy fan-out).
   * **Streaming (SSE)** — progress events while it runs; the final `done` event
   * carries the full coverage result (per-Sid breakdown + missingPolicyPatch).
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Scope to one linked account.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE handle:
   *   async-iterable + `onOpen/onMessage/onError/onDone` + `close()`.
   * @example
   * const s = sdk.providers.aws.permissionsCheck();
   * s.onMessage = (ev) => console.log(ev.type, ev.data);
   * s.onDone = (ev) => console.log('coverage', ev.data?.result);
   */
  permissionsCheck({ accountId } = {}) {
    return this.sdk._stream('/providers/aws/permissions-check', 'POST', { query: { accountId } });
  }

  /**
   * Run live AWS API smoke tests (the Setup panel "test" button).
   *
   * @param {object} [params]
   * @param {string} [params.accountId] - Linked account to test.
   * @param {string} [params.region]    - Region for region-scoped calls.
   * @returns {Promise<object>} Smoke-test results.
   * @example
   * const out = await sdk.providers.aws.setupSmokeTest({ region: 'us-east-2' });
   */
  setupSmokeTest({ accountId, region } = {}) {
    return this.sdk._fetch('/providers/aws/setup', 'POST', { body: { accountId, region } });
  }

  /**
   * List the IAM permission tiers (static metadata; instant).
   *
   * @returns {Promise<{ tiers: Array<{ id: string, label: string, summary: string, recommended: boolean }> }>}
   * @example
   * const { tiers } = await sdk.providers.aws.setupTiers();
   */
  setupTiers() { return this.sdk._fetch('/providers/aws/setup/tiers', 'GET'); }

  // ── /api/aws/* resource probes ──────────────────────────────

  /**
   * EC2 describe probe. The `resource` selects what is returned in `{ data }`:
   * 'security-groups' | 'subnets' | 'availability-zones' | 'vpcs' | 'key-pairs' | 'amis'.
   * AMIs accept owner/arch/name filters.
   *
   * @param {object} params
   * @param {string} params.resource    - Resource type (see above).
   * @param {string} [params.region='us-east-2'] - AWS region.
   * @param {string} [params.vpcId]     - VPC filter (security-groups, subnets).
   * @param {string} [params.owner='self'] - AMI owner.
   * @param {string} [params.arch]      - AMI architecture filter.
   * @param {string} [params.name]      - AMI name filter.
   * @param {AbortSignal} [params.signal] - Optional abort signal (cancel/supersede).
   * @returns {Promise<{ data: Array<object> }>}
   * @example
   * const { data } = await sdk.providers.aws.ec2({ resource: 'vpcs', region: 'us-east-2' });
   */
  ec2({ resource, region, vpcId, owner, arch, name, signal } = {}) {
    return this.sdk._fetch('/aws/ec2', 'GET', { query: { resource, region, vpcId, owner, arch, name }, signal });
  }

  /**
   * IRSA role management (action-dispatched). The full body is passed through;
   * `action` selects the operation:
   *   - `'search'`        { container, clusterName, query?, branch? } → { roles, oidcIssuer }
   *   - `'describe'`      { roleName } → { role }
   *   - `'ensure-trust'`  { container, clusterName, roleName, serviceAccountNamespace, serviceAccountName } → trust result
   *   - `'create'`        { container, clusterName, roleName, policyDocPath?|managedPolicyArns?|zeusManagedPolicy, serviceAccountNamespace, serviceAccountName, description? } → create result
   *
   * @param {object} body - Must include `action`; remaining fields depend on it (see above). `branch` defaults to 'main'.
   * @returns {Promise<object>} Shape depends on `action`.
   * @example
   * const { roles } = await sdk.providers.aws.iamRoles({ action: 'search', container: 'app1', clusterName: 'z-01' });
   */
  iamRoles(body) { return this.sdk._fetch('/aws/iam-roles', 'POST', { body }); }

  /**
   * Route53 read probe. The `resource` selects what is returned:
   *   - `'hosted-zones'` → { zones }
   *   - `'find-zone'`    (requires `domain`) → { zone }
   *   - `'records'`      (requires `zoneId`, optional `name`) → { records }
   *
   * @param {object} params
   * @param {string} params.resource    - 'hosted-zones' | 'find-zone' | 'records'.
   * @param {string} [params.domain]    - Domain (find-zone).
   * @param {string} [params.zoneId]    - Zone id (records).
   * @param {string} [params.name]      - Record name filter (records).
   * @param {string} [params.accountId] - Scope to one linked account.
   * @returns {Promise<{ zones?: Array<object>, zone?: object, records?: Array<object> }>}
   * @example
   * const { zones } = await sdk.providers.aws.route53({ resource: 'hosted-zones' });
   */
  route53({ resource, domain, zoneId, name, accountId }) {
    return this.sdk._fetch('/aws/route53', 'GET', { query: { resource, domain, zoneId, name, accountId } });
  }
}
