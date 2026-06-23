# `sdk.providers.dns` — provider-agnostic DNS

`DnsService` manages registered hosted/managed zones (Route53 or Google Cloud
DNS) that Zeus drives white-label CNAME records into. Zones are registered by id
(looked up live via `lookup` or provisioned via `createZone`); one is the
`primary` (root-domain) zone. Read helpers expose live name servers + records and
verify delegation. It also hosts `providerDoc` for the generic
`/api/providers/[id]/doc` "coming soon" provider markdown endpoint (parked here,
not DNS-specific).

Every method takes a single destructured object and returns the route's JSON
verbatim.

```js
const { match } = await sdk.providers.dns.lookup({ domain:'example.com', provider:'aws-route53', accountId:'111122223333' });
await sdk.providers.dns.createOrUpdateZone({ domain:'example.com', provider:'aws-route53', accountId:'111122223333', zoneId: match.id });
const { records } = await sdk.providers.dns.records({ id:'zone1' });
```

---

## Zones

| Method | Route | Returns |
|---|---|---|
| `zones()` | `GET /providers/dns/zones` | `{ zones, primaryZoneId }` |
| `createOrUpdateZone({ id?, domain, provider, accountId?, gcpAccountId?, zoneId, zoneName? })` | `POST /providers/dns/zones` | `{ zone, zones }` |
| `updateZone({ id, fields })` | `PUT /providers/dns/zones/[id]` | `{ zone, zones, primaryZoneId }` |
| `setPrimary({ id })` | `PUT …/[id]` (action=set-primary) | `{ zones, primaryZoneId }` |
| `deleteZone({ id })` | `DELETE /providers/dns/zones/[id]` | `{ ok, zones, primaryZoneId }` |
| `nameservers({ id })` | `GET …/[id]/nameservers` | `{ nameServers }` |
| `records({ id })` | `GET …/[id]/records` | `{ records, ignored }` |

The single-zone route only exposes PUT/DELETE — read the collection via `zones()`,
then operate by id. `records` flags non-CNAME records with `recommendIgnore`.
`provider` is `aws-route53` | `google-clouddns` (`accountId` = AWS account id,
`gcpAccountId` = GCP DNS account id).

## Live provider operations

| Method | Route | Returns |
|---|---|---|
| `check({ domain, expected?, zoneId? })` | `POST /providers/dns/check` | `{ ok, resolved?, expected?, live?, matched?, missing?, unexpected?, error? }` |
| `createZone({ domain, provider, accountId? })` | `POST /providers/dns/create-zone` | `{ zone: { id, name, nameServers } }` |
| `lookup({ domain, provider, accountId? })` | `POST /providers/dns/lookup` | `{ match, candidates }` |

`check` verifies live delegation; pass `expected` NS directly or a registered
`zoneId` to derive them. `createZone` provisions a live zone at the provider but
does NOT register it in Zeus — pass the returned `id` to `createOrUpdateZone`.
`lookup`'s `match` is the longest-suffix zone; its `id` is what to save as `zoneId`.

## Generic provider doc

| Method | Route | Returns |
|---|---|---|
| `providerDoc({ id })` | `GET /providers/[id]/doc` | `{ markdown }` |

Returns the markdown plan doc for a "coming soon" provider page. Only `aws`/`gcp`
are allowed (404 otherwise). Not DNS-specific — parked on `DnsService` for the
orchestrator to wire.
