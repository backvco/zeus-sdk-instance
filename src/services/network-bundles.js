// @ts-nocheck
/**
 * NetworkBundlesService — managed VPC bundles (`data/vpcs/<name>.json`).
 *
 * Accessed as `sdk.networkBundles`.
 *
 * A "bundle" is the desired-state description of one VPC + its subnets, NAT
 * gateways, internet gateway, and route tables, managed as a unit and tagged
 * `zeus:managed-by=zeus`. The collection lives at `/api/v2configs/vpcs/**`.
 * Every method takes an optional `branch` (default `'main'`, sent as `?branch=`).
 *
 * Typical lifecycle:
 *   1. `create({ name, region, cidr, azCount, natMode })` — write desired state.
 *   2. `plan({ name })` — render the plan (optionally diff against live AWS).
 *   3. `apply({ name })` — SSE stream that provisions it; persists `status`.
 *   4. `live({ name })` / `drift()` — inspect live AWS vs. desired.
 *   5. Incrementally edit subnets/NATs/route-tables, or `destroy({ name })`.
 *
 * Methods throw `ZeusApiError` on HTTP 4xx/5xx — you don't handle errors yourself.
 * `apply` and `destroy` (POST) return SSE stream handles, not JSON.
 */
export class NetworkBundlesService {
  constructor(sdk) { this.sdk = sdk; }

  // ── Collection ──────────────────────────────────────────────

  /**
   * List every bundle (raw `data/vpcs/*.json`).
   *
   * @param {object} [params]
   * @param {string} [params.branch='main']
   * @returns {Promise<{ vpcs: Array<object> }>}
   * @example
   * const { vpcs } = await sdk.networkBundles.list();
   */
  list({ branch } = {}) {
    return this.sdk._fetch('/v2configs/vpcs', 'GET', { query: { branch } });
  }

  /**
   * Create a new bundle (desired state only — no AWS calls; apply runs later).
   *
   * @param {object} params
   * @param {string} params.name      - Lowercase / digits / dashes.
   * @param {string} params.region
   * @param {string} params.cidr
   * @param {number} params.azCount
   * @param {string} params.natMode   - e.g. 'single' | 'per-az' | 'none'.
   * @param {boolean} [params.dnsHostnames=true]
   * @param {boolean} [params.dnsSupport=true]
   * @param {object}  [params.extraTags]
   * @param {string}  [params.accountId] - Linked account (default account if omitted).
   * @param {string}  [params.branch='main']
   * @returns {Promise<{ vpc: object }>} 201; 409 if the name exists.
   * @example
   * await sdk.networkBundles.create({ name: 'mesh-a', region: 'us-east-2', cidr: '10.20.0.0/16', azCount: 3, natMode: 'single' });
   */
  create({ name, region, cidr, azCount, natMode, dnsHostnames, dnsSupport, extraTags, accountId, branch }) {
    return this.sdk._fetch('/v2configs/vpcs', 'POST', {
      body: { name, region, cidr, azCount, natMode, dnsHostnames, dnsSupport, extraTags, accountId, branch },
    });
  }

  /**
   * Aggregate drift across every bundle (per-bundle diff counts + buckets).
   *
   * @param {object} [params]
   * @param {string} [params.branch='main']
   * @returns {Promise<{
   *   bundles: Array<{ name, region, accountId, applied, vpcId?, diffCount, buckets, error? }>,
   *   summary: { total, applied, withDrift, errored },
   * }>}
   * @example
   * const { summary } = await sdk.networkBundles.drift();
   */
  drift({ branch } = {}) {
    return this.sdk._fetch('/v2configs/vpcs/drift', 'GET', { query: { branch } });
  }

  // ── Single bundle ───────────────────────────────────────────

  /**
   * Read one bundle.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ vpc: object }>} 404 if not found.
   * @example
   * const { vpc } = await sdk.networkBundles.get({ name: 'mesh-a' });
   */
  get({ name, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}`, 'GET', { query: { branch } });
  }

  /**
   * Patch in-place bundle fields. `cidr`/`azCount`/`natMode`/`region` are
   * immutable here (changing them requires destroy + recreate → 400).
   *
   * @param {object} params
   * @param {string} params.name
   * @param {object} params.fields - Mutable fields to merge (e.g. extraTags, dnsHostnames).
   * @param {string} [params.branch='main']
   * @returns {Promise<{ vpc: object }>}
   * @example
   * await sdk.networkBundles.update({ name: 'mesh-a', fields: { extraTags: { team: 'core' } } });
   */
  update({ name, fields = {}, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}`, 'PATCH', {
      body: fields, query: { branch },
    });
  }

  /**
   * Delete the bundle JSON. Refuses (409) if it still has a live VPC unless
   * `force:true` (drops the JSON only — live AWS resources are NOT torn down;
   * use `destroy` for that).
   *
   * @param {object} params
   * @param {string} params.name
   * @param {boolean} [params.force] - Pass `?force=1` to drop JSON despite a live VPC.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ok: boolean, alreadyMissing?: boolean }>}
   * @example
   * await sdk.networkBundles.delete({ name: 'mesh-a', force: true });
   */
  delete({ name, force, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}`, 'DELETE', {
      query: { branch, force: force ? '1' : undefined },
    });
  }

  /**
   * Render the desired-state plan (no AWS calls); optionally diff against live.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {boolean} [params.withDiff] - Include a live diff (`?withDiff=1`).
   * @param {string} [params.branch='main']
   * @returns {Promise<{ plan: object, diff?: object, diffError?: string }>}
   * @example
   * const { plan, diff } = await sdk.networkBundles.plan({ name: 'mesh-a', withDiff: true });
   */
  plan({ name, withDiff, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}/plan`, 'GET', {
      query: { branch, withDiff: withDiff ? '1' : undefined },
    });
  }

  /**
   * Live AWS state for the bundle (VPC, subnets, NATs, IGWs, route tables).
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ vpc: object, subnets: Array<object>, nats: Array<object>, igws: Array<object>, routeTables: Array<object> }>}
   *   404 if no live VPC matches the bundle yet.
   * @example
   * const { subnets } = await sdk.networkBundles.live({ name: 'mesh-a' });
   */
  live({ name, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}/live`, 'GET', { query: { branch } });
  }

  // ── Apply / destroy (SSE) ───────────────────────────────────

  /**
   * Provision the bundle as an **SSE stream** of run progress. Persists the
   * final `status` block to the bundle JSON. 409 if an apply is already running.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../stream.js').openStream>} SSE handle
   *   (async-iterable + `onOpen/onMessage/onError/onDone` + `close()`). Events
   *   are run progress `{ type, data, raw }` (info/error/done).
   * @example
   * const s = sdk.networkBundles.apply({ name: 'mesh-a' });
   * s.onMessage = (ev) => console.log(ev.data);
   */
  apply({ name, branch }) {
    return this.sdk._stream(`/v2configs/vpcs/${encodeURIComponent(name)}/apply`, 'POST', { query: { branch } });
  }

  /**
   * Preview a destroy: blockers, warnings, deletability for the bundle's VPC.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} [params.region]    - Region hint for tag-only bundles.
   * @param {string} [params.accountId] - Linked account for non-default bundles.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ preview: { vpcId, blockers, warnings, deletable } }>}
   * @example
   * const { preview } = await sdk.networkBundles.destroyPreview({ name: 'mesh-a' });
   */
  destroyPreview({ name, region, accountId, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}/destroy`, 'GET', {
      query: { branch, region, accountId },
    });
  }

  /**
   * Tear the bundle's live resources down as an **SSE stream**. Requires the
   * confirmation phrase `CONFIRM-DESTROY <name>`.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.confirm     - Must equal `"CONFIRM-DESTROY <name>"`.
   * @param {boolean} [params.force]
   * @param {string} [params.region]
   * @param {string} [params.accountId]
   * @param {string} [params.branch='main']
   * @returns {ReturnType<import('../stream.js').openStream>} SSE handle
   *   (async-iterable + callbacks + `close()`); run-progress events.
   * @example
   * const s = sdk.networkBundles.destroy({ name: 'mesh-a', confirm: 'CONFIRM-DESTROY mesh-a' });
   */
  destroy({ name, confirm, force, region, accountId, branch }) {
    return this.sdk._stream(`/v2configs/vpcs/${encodeURIComponent(name)}/destroy`, 'POST', {
      body: { confirm, force, region, accountId },
      query: { branch },
    });
  }

  // ── Subnets ─────────────────────────────────────────────────

  /**
   * Create a subnet in the bundle's live VPC (auto-named from tier+AZ).
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.az
   * @param {string} params.cidr
   * @param {'public'|'private'} params.tier
   * @param {string} [params.branch='main']
   * @returns {Promise<{ subnet: { resourceName, id, az, tier, cidr } }>} 201.
   * @example
   * await sdk.networkBundles.createSubnet({ name: 'mesh-a', az: 'us-east-2c', cidr: '10.20.6.0/24', tier: 'public' });
   */
  createSubnet({ name, az, cidr, tier, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}/subnets`, 'POST', {
      body: { az, cidr, tier }, query: { branch },
    });
  }

  /**
   * Delete a subnet from the bundle.
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.subnetId
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ok: boolean }>}
   * @example
   * await sdk.networkBundles.deleteSubnet({ name: 'mesh-a', subnetId: 'subnet-0abc' });
   */
  deleteSubnet({ name, subnetId, branch }) {
    return this.sdk._fetch(
      `/v2configs/vpcs/${encodeURIComponent(name)}/subnets/${encodeURIComponent(subnetId)}`,
      'DELETE', { query: { branch } });
  }

  // ── NAT gateways ────────────────────────────────────────────

  /**
   * Create a NAT gateway in a public subnet (allocates an EIP, waits for
   * `available`).
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.subnetId - A public subnet id.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ nat: { resourceName, id, allocationId, subnetId } }>} 201.
   * @example
   * await sdk.networkBundles.createNat({ name: 'mesh-a', subnetId: 'subnet-0pub' });
   */
  createNat({ name, subnetId, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}/nats`, 'POST', {
      body: { subnetId }, query: { branch },
    });
  }

  /**
   * Delete a NAT gateway and release its EIP.
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.natId
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ok: boolean, eipReleased: boolean }>}
   * @example
   * await sdk.networkBundles.deleteNat({ name: 'mesh-a', natId: 'nat-0abc' });
   */
  deleteNat({ name, natId, branch }) {
    return this.sdk._fetch(
      `/v2configs/vpcs/${encodeURIComponent(name)}/nats/${encodeURIComponent(natId)}`,
      'DELETE', { query: { branch } });
  }

  // ── Route tables ────────────────────────────────────────────

  /**
   * Create a route table (optionally with a default 0.0.0.0/0 route).
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} [params.resourceName]
   * @param {'public'|'private'} [params.tier]
   * @param {string} [params.az]
   * @param {{ igwId?: string, natGatewayId?: string }} [params.defaultRoute]
   * @param {string} [params.branch='main']
   * @returns {Promise<{ routeTable: { resourceName, id, tier, az } }>} 201.
   * @example
   * await sdk.networkBundles.createRouteTable({ name: 'mesh-a', tier: 'public', defaultRoute: { igwId: 'igw-0abc' } });
   */
  createRouteTable({ name, resourceName, tier, az, defaultRoute, branch }) {
    return this.sdk._fetch(`/v2configs/vpcs/${encodeURIComponent(name)}/route-tables`, 'POST', {
      body: { resourceName, tier, az, defaultRoute }, query: { branch },
    });
  }

  /**
   * Delete a route table (refuses 409 if it still has subnet associations).
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.rtId
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ok: boolean }>}
   * @example
   * await sdk.networkBundles.deleteRouteTable({ name: 'mesh-a', rtId: 'rtb-0abc' });
   */
  deleteRouteTable({ name, rtId, branch }) {
    return this.sdk._fetch(
      `/v2configs/vpcs/${encodeURIComponent(name)}/route-tables/${encodeURIComponent(rtId)}`,
      'DELETE', { query: { branch } });
  }

  /**
   * Associate a subnet with a route table.
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.rtId
   * @param {string} params.subnetId
   * @param {string} [params.branch='main']
   * @returns {Promise<{ associationId: string }>} 201.
   * @example
   * await sdk.networkBundles.associateSubnet({ name: 'mesh-a', rtId: 'rtb-0abc', subnetId: 'subnet-0def' });
   */
  associateSubnet({ name, rtId, subnetId, branch }) {
    return this.sdk._fetch(
      `/v2configs/vpcs/${encodeURIComponent(name)}/route-tables/${encodeURIComponent(rtId)}/associations`,
      'POST', { body: { subnetId }, query: { branch } });
  }

  /**
   * Disassociate a subnet from a route table.
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.rtId
   * @param {string} params.associationId
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ok: boolean }>}
   * @example
   * await sdk.networkBundles.disassociateSubnet({ name: 'mesh-a', rtId: 'rtb-0abc', associationId: 'rtbassoc-0abc' });
   */
  disassociateSubnet({ name, rtId, associationId, branch }) {
    return this.sdk._fetch(
      `/v2configs/vpcs/${encodeURIComponent(name)}/route-tables/${encodeURIComponent(rtId)}/associations`,
      'DELETE', { query: { branch, associationId } });
  }

  /**
   * Set/replace (or clear) the 0.0.0.0/0 default route on a route table. Pass
   * `target:null` to delete the default route.
   *
   * @param {object} params
   * @param {string} params.name - Bundle name.
   * @param {string} params.rtId
   * @param {{ igwId?: string, natGatewayId?: string }|null} params.target
   * @param {string} [params.branch='main']
   * @returns {Promise<{ ok: boolean }>}
   * @example
   * await sdk.networkBundles.setDefaultRoute({ name: 'mesh-a', rtId: 'rtb-0abc', target: { natGatewayId: 'nat-0abc' } });
   */
  setDefaultRoute({ name, rtId, target, branch }) {
    return this.sdk._fetch(
      `/v2configs/vpcs/${encodeURIComponent(name)}/route-tables/${encodeURIComponent(rtId)}/routes`,
      'POST', { body: { target }, query: { branch } });
  }
}
