// @ts-nocheck
/**
 * NetworkPlansService — fleet-wide CIDR allocation plans.
 *
 * Accessed as `sdk.networkPlans`.
 *
 * A "plan" carves a large umbrella CIDR into deterministic per-cluster **slots**
 * (each yielding a pod CIDR + service CIDR). Allocating a slot reserves
 * non-overlapping space without a human having to remember what's taken; a slot
 * can then be materialized into a VPC bundle. Backed by `/api/network/**`.
 *
 * Typical lifecycle:
 *   1. `create({ name })` — new empty plan on the standard umbrellas.
 *   2. `slots({ name, accountId, region })` — preview the next free slot
 *      (account-aware: skips slots colliding with live VPCs).
 *   3. `allocateSlot({ name, label, ... })` — reserve the next (or a pinned) slot.
 *   4. `vpcFromSlot({ plan, slot, region })` — materialize a VPC bundle.
 *   5. `validate()` — fleet-wide overlap check across plans/bundles/clusters.
 *
 * Methods throw `ZeusApiError` on HTTP 4xx/5xx — you don't handle errors yourself.
 */
export class NetworkPlansService {
  constructor(sdk) { this.sdk = sdk; }

  // ── Plans collection ────────────────────────────────────────

  /**
   * List all network plans.
   *
   * @returns {Promise<{ plans: Array<object> }>}
   * @example
   * const { plans } = await sdk.networkPlans.list();
   */
  list() { return this.sdk._fetch('/network/plans', 'GET'); }

  /**
   * Create a new (empty) plan on the standard umbrellas.
   *
   * @param {object} params
   * @param {string} params.name - Lowercase / digits / dashes.
   * @returns {Promise<{ plan: object }>} 201; 409 if the name exists.
   * @example
   * await sdk.networkPlans.create({ name: 'fleet' });
   */
  create({ name }) {
    return this.sdk._fetch('/network/plans', 'POST', { body: { name } });
  }

  // ── Single plan ─────────────────────────────────────────────

  /**
   * Read a plan.
   *
   * @param {object} params
   * @param {string} params.name
   * @returns {Promise<{ plan: object }>} 404 if not found.
   * @example
   * const { plan } = await sdk.networkPlans.get({ name: 'fleet' });
   */
  get({ name }) {
    return this.sdk._fetch(`/network/plans/${encodeURIComponent(name)}`, 'GET');
  }

  /**
   * Patch plan metadata only (`v6Deployed`, `reservedForbidden`,
   * `edgeReservations`, `mediaPools`). Slot-derivation fields are immutable here.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {object} params.fields - Any of the patchable metadata keys above.
   * @returns {Promise<{ plan: object }>} 409 on lock contention.
   * @example
   * await sdk.networkPlans.update({ name: 'fleet', fields: { v6Deployed: true } });
   */
  update({ name, fields = {} }) {
    return this.sdk._fetch(`/network/plans/${encodeURIComponent(name)}`, 'PATCH', { body: fields });
  }

  /**
   * Delete a plan. Only allowed when no slot is allocated to a cluster (409
   * otherwise). Requires type-to-confirm.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.confirm - Must equal the plan name.
   * @returns {Promise<{ deleted: true }>}
   * @example
   * await sdk.networkPlans.delete({ name: 'fleet', confirm: 'fleet' });
   */
  delete({ name, confirm }) {
    return this.sdk._fetch(`/network/plans/${encodeURIComponent(name)}`, 'DELETE', { body: { confirm } });
  }

  // ── Slots ───────────────────────────────────────────────────

  /**
   * List a plan's slots plus a preview of the next free slot. Optional
   * `accountId`+`region`(+`provider`) make the preview account-aware — slots
   * whose CIDRs collide with a live VPC are skipped.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} [params.accountId]
   * @param {string} [params.region]
   * @param {string} [params.provider]
   * @returns {Promise<{
   *   slots: Array<object>,
   *   next: { slot, podCidr, serviceCidr, skipped }|null,
   *   skipped: Array<object>,
   *   liveCidrsUnavailable: boolean,
   * }>}
   * @example
   * const { next } = await sdk.networkPlans.slots({ name: 'fleet', accountId: 'acme', region: 'us-east-2' });
   */
  slots({ name, accountId, region, provider }) {
    return this.sdk._fetch(`/network/plans/${encodeURIComponent(name)}/slots`, 'GET', {
      query: { accountId, region, provider },
    });
  }

  /**
   * Allocate a slot. Defaults to the lowest free index; pass `slot` to pin a
   * specific index. With `accountId`+`region`, a slot colliding with a live VPC
   * is skipped automatically (or 409 if AWS can't be reached and `force` is off).
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.label
   * @param {string} [params.container]
   * @param {string} [params.cluster]
   * @param {string} [params.accountId]
   * @param {string} [params.region]
   * @param {string} [params.provider]
   * @param {boolean} [params.force] - Allocate even when live VPCs can't be verified.
   * @param {number} [params.slot]   - Pin a specific slot index.
   * @returns {Promise<{ slot: object, skipped: Array<object>, liveCidrsUnavailable: boolean }>} 201.
   * @example
   * const { slot } = await sdk.networkPlans.allocateSlot({ name: 'fleet', label: 'z-03', accountId: 'acme', region: 'us-east-2' });
   */
  allocateSlot({ name, label, container, cluster, accountId, region, provider, force, slot }) {
    return this.sdk._fetch(`/network/plans/${encodeURIComponent(name)}/slots`, 'POST', {
      body: { label, container, cluster, accountId, region, provider, force, slot },
    });
  }

  /**
   * Read a single slot.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {number|string} params.slot
   * @returns {Promise<{ slot: object }>} 404 if the plan or slot is missing.
   * @example
   * const { slot } = await sdk.networkPlans.getSlot({ name: 'fleet', slot: 0 });
   */
  getSlot({ name, slot }) {
    return this.sdk._fetch(
      `/network/plans/${encodeURIComponent(name)}/slots/${encodeURIComponent(slot)}`, 'GET');
  }

  /**
   * Patch a slot's `label`/`notes` only (derived CIDR fields are immutable).
   *
   * @param {object} params
   * @param {string} params.name
   * @param {number|string} params.slot
   * @param {object} params.fields - `{ label?, notes? }`.
   * @returns {Promise<{ slot: object }>} 409 on lock contention.
   * @example
   * await sdk.networkPlans.updateSlot({ name: 'fleet', slot: 0, fields: { notes: 'prod east' } });
   */
  updateSlot({ name, slot, fields = {} }) {
    return this.sdk._fetch(
      `/network/plans/${encodeURIComponent(name)}/slots/${encodeURIComponent(slot)}`, 'PATCH',
      { body: fields });
  }

  /**
   * Delete a slot. Only when it's unallocated (no cluster) and past its lock.
   * Requires type-to-confirm with the token `"<plan>:<slot>"`.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {number|string} params.slot
   * @param {string} params.confirm - Must equal `"<plan>:<slot>"`.
   * @returns {Promise<{ deleted: true }>}
   * @example
   * await sdk.networkPlans.deleteSlot({ name: 'fleet', slot: 3, confirm: 'fleet:3' });
   */
  deleteSlot({ name, slot, confirm }) {
    return this.sdk._fetch(
      `/network/plans/${encodeURIComponent(name)}/slots/${encodeURIComponent(slot)}`, 'DELETE',
      { body: { confirm } });
  }

  // ── Validation + materialization ────────────────────────────

  /**
   * Run the fleet-wide plan validator (walks all plans, VPC bundles, clusters;
   * reports CIDR overlaps). Read-only.
   *
   * @returns {Promise<{ ok: boolean, conflicts: Array<object> }>}
   * @example
   * const { ok, conflicts } = await sdk.networkPlans.validate();
   */
  validate() { return this.sdk._fetch('/network/plans/validate', 'POST'); }

  /**
   * Materialize a VPC bundle from a plan slot. Provider-aware (AWS default, or
   * `provider:'gcp'`). With `preview:true`, returns the bundle without persisting.
   *
   * @param {object} params
   * @param {string} params.plan
   * @param {number} params.slot
   * @param {string} params.region
   * @param {number}  [params.azCount=3]        - AWS only.
   * @param {string}  [params.natMode='single'] - AWS only.
   * @param {string}  [params.tiers='public-private'] - AWS only.
   * @param {string}  [params.accountId]
   * @param {boolean} [params.preview]
   * @param {string}  [params.provider]   - 'gcp' for a GCP bundle.
   * @param {string}  [params.project]    - Required for GCP.
   * @param {boolean} [params.natEnabled] - GCP only (default true).
   * @param {string}  [params.natIpMode]  - GCP only ('auto' | 'manual').
   * @param {string}  [params.name]       - GCP only: override bundle name.
   * @param {string}  [params.branch='main']
   * @returns {Promise<{ bundle: object, subnetPreview?: object, preview?: object }>}
   *   201 when persisted, 200 on preview; 409 if a bundle already exists.
   * @example
   * const { bundle } = await sdk.networkPlans.vpcFromSlot({ plan: 'fleet', slot: 0, region: 'us-east-2' });
   */
  vpcFromSlot({ plan, slot, region, azCount, natMode, tiers, accountId, preview, provider, project, natEnabled, natIpMode, name, branch }) {
    return this.sdk._fetch('/network/vpcs/from-slot', 'POST', {
      body: { plan, slot, region, azCount, natMode, tiers, accountId, preview, provider, project, natEnabled, natIpMode, name },
      query: { branch },
    });
  }
}
