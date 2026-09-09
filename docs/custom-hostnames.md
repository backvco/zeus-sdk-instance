# `sdk.customHostnames` — bring-your-own-domain hostnames

`CustomHostnamesService` covers `/api/v2configs/{container}/environments/{env}/custom-hostnames/**`.
A custom hostname binds a customer-owned domain (e.g. `help.example.com`, CNAMEd to a Zeus-published
record) to a deployed service: Zeus renders an Ingress + TLS (HTTP-01 via cert-manager) on the
target clusters and keeps it reconciled. Each method returns the route's literal JSON and throws a
`ZeusApiError` on HTTP 4xx/5xx.

| Method | Route | Notes |
|--------|-------|-------|
| `list({ container, env, service?, q?, state?, cluster?, limit?, cursor?, branch? })` | GET `/custom-hostnames` | Paged (`limit` default 100, max 500), server-side filtered. → `{ items, next, counts:{total,pending,ready,error} }` |
| `get({ container, env, hostname, branch? })` | GET `/custom-hostnames/{hostname}` | → `{ hostname: doc }`; 404 if missing |
| `put({ container, env, hostname, service, clusters?, issuingCluster?, expectTargets?, force?, branch? })` | PUT `/custom-hostnames/{hostname}` | Idempotent upsert. 422 on invalid hostname or CNAME mismatch (unless `force:true`). → `{ hostname: doc, reconcile }` |
| `delete({ container, env, hostname, branch? })` | DELETE `/custom-hostnames/{hostname}` | Prunes k8s resources everywhere, then deletes the doc. → `{ deleted: true, pruned }` |
| `action({ container, env, hostname, action, branch? })` | POST `/custom-hostnames/{hostname}` | `action` ∈ `verify`, `reissue`, `sync` |
| `syncAll({ container, env, service?, branch? })` | POST `/custom-hostnames` (`{action:'sync-all'}`) | **STREAMING** — SSE run reconciling every matching hostname |

## Typical join gate

Bring a new custom hostname up without disturbing traffic on the shared record it CNAMEs to:

```js
// 1. Point the customer's DNS: help.example.com CNAME → portals.example.com

// 2. Bind it — validates, checks the CNAME, saves, and reconciles onto the target clusters.
await sdk.customHostnames.put({
  container: 'app1', env: 'dev-d00',
  hostname: 'help.example.com', service: 'customer-portals',
});

// 3. Poll until the certificate is issued and the Ingress is live everywhere.
let doc;
do {
  await new Promise((r) => setTimeout(r, 5000));
  ({ hostname: doc } = await sdk.customHostnames.get({ container: 'app1', env: 'dev-d00', hostname: 'help.example.com' }));
} while (doc.status.state === 'pending');

if (doc.status.state === 'error') throw new Error('custom hostname failed to come up');

// 4. Only now let the shared record start serving this cluster for this hostname
//    (a per-record override — other hostnames on the same clusters are unaffected).
await sdk.globalEndpoints.override({ name: 'portals.example.com', type: 'clear-weight', cluster: 'z-01' });
```

## Bulk sync

```js
const s = sdk.customHostnames.syncAll({ container: 'app1', env: 'dev-d00' });
for await (const ev of s) {
  if (ev.type === 'info') console.log(ev.data?.message);
  if (ev.type === 'done') console.log('sync complete');
}
```

## Errors

- `422 { error: 'cname-mismatch', verify }` from `put` — the hostname's CNAME doesn't resolve to an
  expected Zeus target yet. Retry with `force: true` only when you know propagation is just slow.
- `422 { error, errors: [...] }` from `put` — hostname failed validation (not a valid FQDN, wildcard,
  or it names a zone Zeus already manages — use the service's Ingress/additionalHosts for those).

## Zeus-managed DNS

Pass `manageDns: true` (with `expectTargets: ['<target>']`) to `put()` to have Zeus create/update the
CNAME itself instead of asking the customer to:

```js
await sdk.customHostnames.put({
  container: 'app1', env: 'dev-d00',
  hostname: 'help.example.com', service: 'customer-portals',
  manageDns: true, expectTargets: ['portals.example.com'],
});
```

This only takes effect when `help.example.com` lies in a DNS zone Zeus manages (registered in
Settings → DNS) — if it doesn't, `manageDns` is a no-op recorded in `status.dns.managed: false`
(never an error), and the hostname behaves exactly like a customer-managed CNAME. When it does
apply, `status.dns` carries `{ managed: true, zoneId, provider, target, appliedAt }`, and Zeus
deletes the record automatically when the hostname is deleted. A drifted/missing record is
self-healed on the daemon's 6h CNAME re-verify pass.
