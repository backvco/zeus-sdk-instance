# `sdk.services.runs` — ServiceRunsService

Ephemeral (run-to-completion) invocations of a service. Zeus stamps a one-shot
K8s Job from the service's existing definition plus allowlisted per-invocation
env overrides (`params`), tracks it durably through
`pending → running → succeeded|failed|cancelled|lost`, cleans it up, and
alerts if it loses track.

A service must opt in with an `ephemeralRun` config block (`enabled`,
`allowedParamKeys`, `allowedEnvironments`, `maxConcurrent`, ...) before
`create()` will succeed — see the service-doc `ephemeralRun` section.

All methods take `{ container, name, ... }` where `name` is the service to
run. **Status is advanced by a server-side watch+sweep daemon, never solely
by the request that created the run** — poll `get()`/`list()`, or use
`stream()` for live push. Polling remains the restart-safe source of truth.

---

### `create({ container, name, environment, params, dedupKey, requireCluster, preferCluster })`
Start a run. `POST /api/v2configs/[container]/services/[name]/runs` with body
`{ environment, params?, dedupKey?, requireCluster?, preferCluster? }` →
201 `{ runId, status, cluster }`.

- `params` — env-var overrides; every key must be in the service's
  `allowedParamKeys`, else 400.
- `dedupKey` — idempotency key. A second call with the same key while the
  prior run for that (container, service, environment, dedupKey) is still
  `pending`/`running` returns **409** `{ error:'in-flight', run }` instead of
  starting a duplicate.
- `requireCluster` — hard pin to one cluster (must be in the environment and
  the service's `allowedClusters` if set). **400** if not allowed, **409** if
  the cluster record cannot be resolved.
- `preferCluster` — soft preference: try this cluster first, then the
  service's `preferredClusters[]`, then remaining env clusters. Ignored when
  ineligible. When both are set, `requireCluster` wins.
- **429** when the service's `maxConcurrent` in-flight cap is already hit.

Service-level defaults (on `ephemeralRun`): `allowedClusters[]` (empty = any
env cluster) and ordered `preferredClusters[]`.

```js
const { runId, status, cluster } = await sdk.services.runs.create({
  container: 'app1', name: 'meeting-recorder', environment: 'prod',
  params: { MEETING_URL: 'https://meet.example.com/abc' },
  dedupKey: 'meeting-abc',
  preferCluster: 'z-02',
});
```

### `list({ container, name, environment, status, limit })`
List runs for a service, newest first. `GET .../runs?environment=&status=&limit=`
→ `{ runs }`. `status` filters to one of
`pending|running|succeeded|failed|cancelled|lost`.

### `get({ container, name, runId })`
Get one run by id. `GET .../runs/[runId]` → `{ run }`.

### `cancel({ container, name, runId })`
Cancel an in-flight run: deletes its Job, marks it `cancelled`.
`DELETE .../runs/[runId]` → `{ run }`. **409** `{ error:'terminal', run }` if
the run already finished.

### `logs({ container, name, runId })`
Fetch a run's logs. `GET .../runs/[runId]/logs` → `{ log, live }` — `live` is
true when pulled from the still-running pod; once terminal it returns the
persisted `log_tail` captured at finalize (the pod is gone after its TTL).

### `stream({ container, name, runId, signal })` — **SSE**
Live status push over polling `get()`. `GET .../runs/[runId]/stream`. Emits
`event: run` with the current run row first, then again on every status
transition.

```js
const s = sdk.services.runs.stream({ container: 'app1', name: 'meeting-recorder', runId });
s.onMessage = (ev) => { if (ev.type === 'run') console.log(ev.data.status); };
s.onDone = () => console.log('stream ended');
```

---

## Auth: scoping a token to one service's runs

Service tokens are policy-scoped. A customer-facing token can be limited to
invoking/viewing runs for a single service (its own), rather than the whole
container:

```json
{
  "statements": [
    {
      "effect": "allow",
      "actions": ["instance:services:runs:invoke", "instance:services:runs:view"],
      "resources": ["<container>/<service>"]
    }
  ]
}
```

`instance:services:runs:invoke` gates `create()` and `cancel()`;
`instance:services:runs:view` gates `list()`, `get()`, `logs()`, and
`stream()`. Scope `resources` to `<container>/<service>` so the token can
only trigger runs for the one service it's meant to drive.
