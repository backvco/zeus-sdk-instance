// @ts-nocheck
/**
 * DnsService — provider-agnostic managed DNS zones.
 *
 * Accessed as `sdk.providers.dns`.
 *
 * A "zone" is a registered hosted/managed zone (Route53 or Google Cloud DNS) that
 * Zeus drives white-label CNAME records into. Zones are registered by id (looked
 * up live via {@link lookup} or provisioned via {@link createZone}); one is the
 * `primary` (root-domain) zone. Read helpers expose live name servers + records
 * and verify delegation.
 *
 * Typical lifecycle: `lookup` (or `createZone`) to find/provision the live zone →
 * `createOrUpdateZone` to register it → `setPrimary` for the root → `check`
 * delegation → inspect `nameservers` / `records`.
 *
 * Also hosts {@link providerDoc} for the generic `/api/providers/[id]/doc`
 * "coming soon" provider markdown endpoint (not DNS-specific, parked here).
 */
export class DnsService {
  constructor(sdk) { this.sdk = sdk; }

  _z(id) { return encodeURIComponent(id); }

  // ── Zones ───────────────────────────────────────────────────

  /**
   * List registered DNS zones + the primary zone id.
   *
   * @returns {Promise<{ zones: Array<object>, primaryZoneId: string|null }>}
   * @example
   * const { zones, primaryZoneId } = await sdk.providers.dns.zones();
   */
  zones() { return this.sdk._fetch('/providers/dns/zones', 'GET'); }

  /**
   * Register / update a DNS zone. Run {@link lookup} first to fill
   * zoneId/zoneName from the live provider.
   *
   * @param {object} params
   * @param {string} [params.id]           - Zone record id (omit to create).
   * @param {string} params.domain         - Domain the zone serves.
   * @param {string} params.provider       - 'aws-route53' | 'google-clouddns'.
   * @param {string} [params.accountId]    - AWS account id (Route53).
   * @param {string} [params.gcpAccountId] - GCP DNS account id (Cloud DNS).
   * @param {string} params.zoneId         - Provider zone id (Route53 hosted-zone id / Cloud DNS managed-zone name).
   * @param {string} [params.zoneName]     - Provider zone name.
   * @returns {Promise<{ zone: object, zones: Array<object> }>}
   * @example
   * await sdk.providers.dns.createOrUpdateZone({ domain: 'example.com', provider: 'aws-route53', accountId: '111122223333', zoneId: 'Z123' });
   */
  createOrUpdateZone({ id, domain, provider, accountId, gcpAccountId, zoneId, zoneName }) {
    return this.sdk._fetch('/providers/dns/zones', 'POST', {
      body: { id, domain, provider, accountId, gcpAccountId, zoneId, zoneName },
    });
  }

  /**
   * Get one registered zone. (Backed by the collection read — there is no
   * single-record GET; PUT/DELETE operate on the id.)
   *
   * Note: the route exposes only PUT/DELETE for a single zone id; use
   * {@link zones} to read, then operate by id.
   *
   * @param {object} params
   * @param {string} params.id     - Zone record id.
   * @param {object} [params.fields] - Fields to update.
   * @returns {Promise<{ zone: object, zones: Array<object>, primaryZoneId: string|null }>}
   * @example
   * await sdk.providers.dns.updateZone({ id: 'zone1', fields: { domain: 'example.org' } });
   */
  updateZone({ id, fields = {} }) {
    return this.sdk._fetch(`/providers/dns/zones/${this._z(id)}`, 'PUT', { body: fields });
  }

  /**
   * Make a registered zone the primary (root-domain) zone (PUT action=set-primary).
   *
   * @param {object} params
   * @param {string} params.id - Zone record id.
   * @returns {Promise<{ zones: Array<object>, primaryZoneId: string|null }>}
   * @example
   * await sdk.providers.dns.setPrimary({ id: 'zone1' });
   */
  setPrimary({ id }) {
    return this.sdk._fetch(`/providers/dns/zones/${this._z(id)}`, 'PUT', { body: { action: 'set-primary' } });
  }

  /**
   * Delete a registered zone (removes it from Zeus's config; does not delete the
   * live provider zone).
   *
   * @param {object} params
   * @param {string} params.id - Zone record id.
   * @returns {Promise<{ ok: true, zones: Array<object>, primaryZoneId: string|null }>}
   * @example
   * await sdk.providers.dns.deleteZone({ id: 'zone1' });
   */
  deleteZone({ id }) {
    return this.sdk._fetch(`/providers/dns/zones/${this._z(id)}`, 'DELETE');
  }

  /**
   * Get a zone's authoritative name servers (live from the provider's delegation set).
   *
   * @param {object} params
   * @param {string} params.id - Zone record id.
   * @returns {Promise<{ nameServers: Array<string> }>}
   * @example
   * const { nameServers } = await sdk.providers.dns.nameservers({ id: 'zone1' });
   */
  nameservers({ id }) {
    return this.sdk._fetch(`/providers/dns/zones/${this._z(id)}/nameservers`, 'GET');
  }

  /**
   * Get a zone's live records, each with an advisory `recommendIgnore` flag
   * (non-CNAME records are external/infrastructure).
   *
   * @param {object} params
   * @param {string} params.id - Zone record id.
   * @returns {Promise<{ records: Array<{ name: string, type: string, values: Array<string>, ttl: number|null, recommendIgnore: boolean }>, ignored: Array<string> }>}
   * @example
   * const { records } = await sdk.providers.dns.records({ id: 'zone1' });
   */
  records({ id }) {
    return this.sdk._fetch(`/providers/dns/zones/${this._z(id)}/records`, 'GET');
  }

  // ── Live provider operations ────────────────────────────────

  /**
   * Verify a domain's live DNS delegation against expected name servers. Provide
   * `expected` directly, or a registered `zoneId` to fetch the expected set.
   *
   * @param {object} params
   * @param {string} params.domain     - Domain to check.
   * @param {string[]} [params.expected] - Expected authoritative name servers.
   * @param {string} [params.zoneId]   - Registered zone id to derive expected from.
   * @returns {Promise<{ ok: boolean, resolved?: Array, expected?: Array, live?: Array, matched?: Array, missing?: Array, unexpected?: Array, error?: string }>}
   * @example
   * const r = await sdk.providers.dns.check({ domain: 'example.com', zoneId: 'zone1' });
   */
  check({ domain, expected, zoneId }) {
    return this.sdk._fetch('/providers/dns/check', 'POST', { body: { domain, expected, zoneId } });
  }

  /**
   * Provision a new public hosted/managed zone live at the provider (does NOT
   * register it in Zeus — call {@link createOrUpdateZone} with the returned id).
   *
   * @param {object} params
   * @param {string} params.domain      - Domain for the new zone.
   * @param {string} params.provider    - 'aws-route53' | 'google-clouddns'.
   * @param {string} [params.accountId] - Provider account id (AWS account / GCP DNS account).
   * @returns {Promise<{ zone: { id: string, name: string, nameServers: Array<string> } }>}
   * @example
   * const { zone } = await sdk.providers.dns.createZone({ domain: 'example.com', provider: 'aws-route53', accountId: '111122223333' });
   */
  createZone({ domain, provider, accountId }) {
    return this.sdk._fetch('/providers/dns/create-zone', 'POST', { body: { domain, provider, accountId } });
  }

  /**
   * Look up the live hosted/managed zone for a domain under a provider account.
   * `match` is the longest-suffix zone; its `id` is what to save as `zoneId`.
   *
   * @param {object} params
   * @param {string} params.domain      - Domain to resolve.
   * @param {string} params.provider    - 'aws-route53' | 'google-clouddns'.
   * @param {string} [params.accountId] - Provider account id.
   * @returns {Promise<{ match: { id: string, name: string }|null, candidates: Array<{ id: string, name: string }> }>}
   * @example
   * const { match } = await sdk.providers.dns.lookup({ domain: 'example.com', provider: 'aws-route53' });
   */
  lookup({ domain, provider, accountId }) {
    return this.sdk._fetch('/providers/dns/lookup', 'POST', { body: { domain, provider, accountId } });
  }

  // ── Generic provider doc ────────────────────────────────────

  /**
   * Get the markdown plan doc for a "coming soon" provider page (e.g. gcp-plan.md).
   * Generic `/api/providers/[id]/doc` endpoint — only `aws`/`gcp` are allowed.
   *
   * @param {object} params
   * @param {string} params.id - Provider id ('aws' | 'gcp').
   * @returns {Promise<{ markdown: string }>}
   * @example
   * const { markdown } = await sdk.providers.dns.providerDoc({ id: 'gcp' });
   */
  providerDoc({ id }) {
    return this.sdk._fetch(`/providers/${encodeURIComponent(id)}/doc`, 'GET');
  }
}
