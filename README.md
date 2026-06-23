# @zeusk8s/sdk-instance

JavaScript client SDK for the **Zeus instance API** — the API of a deployed Zeus
app that manages your Kubernetes clusters (EKS / GKE / k3s / Proxmox),
environments, services, infrastructure add-ons, networking, and cloud provider
accounts.

> This is distinct from `@zeusk8s/sdk` (the Zeus **Console** API, which handles
> cross-instance billing/licensing). Use **this** package to drive a single Zeus
> instance.

Works in the **browser** (session-cookie auth, same-origin) and in **Node.js /
scripts / LLM tools** (service-token auth, pointed at any instance).

---

## Install

```bash
npm install @zeusk8s/sdk-instance
```

Local development against the Zeus monorepo links it directly:

```jsonc
// zeus/package.json
"dependencies": { "@zeusk8s/sdk-instance": "file:../sdks/zeus-sdk-instance" }
```

---

## Instance & URL resolution

A Zeus deployment is reached at `https://<instance>.<rootUrl>`. Every customer
gets a unique **instance name** (the first hostname label):

| Environment | instance | rootUrl | resolved base |
|---|---|---|---|
| production | `acme` | `my.zeusk8s.com` (default) | `https://acme.my.zeusk8s.com/api` |
| development | `acme` | `my-dev.zeusk8s.com` | `https://acme.my-dev.zeusk8s.com/api` |

Resolution order:
1. explicit `baseURL` (wins over everything)
2. **browser default** → same-origin `/api` (the page is already on the instance host; instance auto-derived from `window.location`)
3. `https://<instance>.<rootUrl>/api`

`rootUrl` defaults to `my.zeusk8s.com` and can be overridden by the `rootUrl`
option or, in Node, the `ZEUS_ROOT_URL` environment variable (e.g.
`my-dev.zeusk8s.com`).

---

## Quick start

### Browser (inside the Zeus app or any page on the instance host)

```js
import { ZeusInstanceSDK } from '@zeusk8s/sdk-instance';

const sdk = new ZeusInstanceSDK();             // baseURL → '/api', cookie auth
const { containers } = await sdk.containers.list();
const { clusters }   = await sdk.clusters.list({ container: 'app1' });
```

### Node / scripts / LLM tools

```js
import { ZeusInstanceSDK } from '@zeusk8s/sdk-instance';

const sdk = new ZeusInstanceSDK({
  instance: 'acme',
  rootUrl:  'my-dev.zeusk8s.com',          // omit in prod → my.zeusk8s.com
  token:    process.env.ZEUS_TOKEN,        // 'zeus_...' service token
});

const { clusters } = await sdk.clusters.list({ container: 'app1' });
```

---

## Authentication

| Context | How | What the SDK sends |
|---|---|---|
| Browser | nothing — session cookie | `credentials: 'include'` |
| Node (service token) | `new ZeusInstanceSDK({ token: 'zeus_...' })` or `sdk.setToken(...)` | `Authorization: Bearer <token>` |

You can also inject a custom `fetch` (e.g. SvelteKit's `event.fetch` for SSR):
`new ZeusInstanceSDK({ baseURL: '/api', fetch: event.fetch })`.

---

## Return values & error handling

**Every method returns exactly what the endpoint returns** — the parsed JSON
body, with no unwrapping. A method for `GET /api/providers/aws/accounts` returns
the whole `{ accounts, defaultAccountId }`:

```js
const { accounts, defaultAccountId } = await sdk.providers.aws.accounts.list();
```

Non-2xx responses **throw** a `ZeusApiError`:

```js
import { ZeusApiError, ReachabilityAckRequiredError } from '@zeusk8s/sdk-instance';

try {
  await sdk.clusters.get({ container: 'app1', name: 'nope' });
} catch (err) {
  if (err instanceof ZeusApiError) {
    err.status;    // 404
    err.body;      // { error: 'Cluster not found' }
    err.endpoint;  // '/v2configs/app1/clusters/nope'
  }
}
```

A few infrastructure operations gate on cluster reachability and respond `412`;
those throw `ReachabilityAckRequiredError` (with `.payload`) so you can prompt
the user to acknowledge and retry.

---

## Streaming (Server-Sent Events)

Long-running operations — cluster provision/destroy, node-group apply, AMI/GCP
image builds, helm rollouts, credential rotation, k8s log tails, k8s resource
watches, the unified runs log, and the help-chat assistant — return a **stream
handle** instead of a promise. It is both async-iterable and callback-driven,
and cancelable.

```js
// async-iterator style
const stream = sdk.k8s.watch({ resource: 'pods', cluster: 'z-02' });
for await (const ev of stream) {
  if (ev.type === 'message') handlePod(ev.data);   // ev = { type, data, raw }
}

// callback style
const run = sdk.clusters.provision({ container: 'app1', name: 'z-04', /* ... */ });
run.onMessage = (ev) => console.log(ev.type, ev.data);
run.onDone    = () => console.log('done');
run.onError   = (e) => console.error(e);
// later: run.close();
```

Each event is `{ type, data, raw }` — `type` is the SSE event name (`'message'`
when unnamed), `data` is the JSON-parsed payload (falls back to the raw string),
`raw` is the untouched `data:` text.

---

## Services

| Namespace | Covers | Reference |
|---|---|---|
| `sdk.auth` | login, session, user setup, password reset, directory | [docs/auth.md](docs/auth.md) |
| `sdk.containers` | workspaces (config, list, create, delete, settings, cluster-links) | [docs/containers.md](docs/containers.md) |
| `sdk.clusters` | clusters + `.nodegroups .security .upgrade .storage .certs .overlay .extras` | [docs/clusters.md](docs/clusters.md) |
| `sdk.services` | services + `.identities .registry` | [docs/services.md](docs/services.md) |
| `sdk.environments` | environments, DNS, backup profiles | [docs/environments.md](docs/environments.md) |
| `sdk.infrastructure` | helm / EKS add-ons + `.backups .rotate` | [docs/infrastructure.md](docs/infrastructure.md) |
| `sdk.connections` | external-system connections + categories | [docs/connections.md](docs/connections.md) |
| `sdk.registries` | container image registries + pull secrets | [docs/registries.md](docs/registries.md) |
| `sdk.networkBundles` | VPC desired-state bundles | [docs/network-bundles.md](docs/network-bundles.md) |
| `sdk.networkPlans` | CIDR plans + slots | [docs/network-plans.md](docs/network-plans.md) |
| `sdk.deploy` | deploy / dryrun / generate / validate / env-files / common / github / identities | [docs/deploy.md](docs/deploy.md) |
| `sdk.k8s` | pods, nodes, deployments, logs (SSE), watch (SSE), events + `.logs .flags` | [docs/k8s.md](docs/k8s.md) |
| `sdk.runs` | unified run history + live stream (SSE) | [docs/runs.md](docs/runs.md) |
| `sdk.alerts` | cluster alerts | [docs/alerts.md](docs/alerts.md) |
| `sdk.amiRecipes` | AMI build recipes + builds (SSE) | [docs/ami-recipes.md](docs/ami-recipes.md) |
| `sdk.settings` | `.auth .builders .github .mail .npmTokens .serviceTokens .pricing .system` | [docs/settings.md](docs/settings.md) |
| `sdk.help` | assistant chat (SSE) + sessions + settings | [docs/help.md](docs/help.md) |
| `sdk.system` | egress/whoami IP, tooling, pricing, presets, geocode, fs browse | [docs/system.md](docs/system.md) |
| `sdk.agent` | bare-metal / Proxmox agent enroll + rekey | [docs/agent.md](docs/agent.md) |
| `sdk.providers.aws` | accounts, regions, VPC adopt, S3, IAM, Route53, setup | [docs/providers-aws.md](docs/providers-aws.md) |
| `sdk.providers.gcp` | accounts/projects, images (SSE), machine types, workload identity | [docs/providers-gcp.md](docs/providers-gcp.md) |
| `sdk.providers.proxmox` | accounts, sites, clusters, connect (lots of SSE) | [docs/providers-proxmox.md](docs/providers-proxmox.md) |
| `sdk.providers.dns` | DNS zones, records, delegation check, lookup | [docs/providers-dns.md](docs/providers-dns.md) |

Every method has a JSDoc block (description, params, literal response shape, and a
runnable example). The `docs/` directory mirrors this as Markdown for humans and
LLMs.

---

## Conventions

- Methods take a **single destructured object** argument, e.g.
  `sdk.clusters.get({ container, name })`.
- Container-scoped methods take `container` as the first field.
- Optional `branch` defaults to `main` server-side; pass it only when targeting
  another branch.
- Plain JS, ESM (`"type": "module"`), zero runtime dependencies.

## License

MIT
