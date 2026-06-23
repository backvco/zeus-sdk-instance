# `sdk.runs` — unified run log (history, liveness, streams)

`RunsService` covers `/api/runs/**`: the single feed every long Zeus operation
(cluster provision/destroy, node-group apply, image build, helm rollout, VPC
apply, …) writes into. A run is keyed by a `domain` (operation family) and a
`scope` (the target). Non-streaming methods return the route's literal JSON and
throw on HTTP 4xx/5xx; `stream()` returns an SSE handle.

> **`scope` is a repeatable query key — always pass an array.** base.js appends
> array values as repeated `scope=` params, matching the routes'
> `url.searchParams.getAll('scope')`. e.g. `scope: ['app1', 'z-02']`.

| Method | Route | Notes |
|--------|-------|-------|
| `history({ domain, scope, limit? })` | GET `/runs/history` | → `{ domain, scope, runs:[{ runId, kind, startedAt, finishedAt, finalType, finalMessage, sizeBytes }] }`. 400 if domain/scope missing or domain unknown |
| `inFlight({ domain?, scope?, kind?, runKey? })` | GET `/runs/in-flight` | → `{ inFlight: boolean }`. Probe "is a run executing now?". `kind` defaults `'apply'`. Pass `runKey` instead of domain/scope to bypass key derivation |
| `stream({ domain, scope?, runId?, kind?, live?, runKey?, signal? })` | GET `/runs/stream` **[SSE]** | Live tail or disk replay. See below |

```js
const { runs } = await sdk.runs.history({ domain: 'cluster', scope: ['z-02'] });
const { inFlight } = await sdk.runs.inFlight({ domain: 'cluster', scope: ['z-02'], kind: 'destroy' });
```

## `stream()` — SSE

Resolution on the server:
1. **live in-memory run** matching the runKey → replays buffered history, then
   streams live events;
2. **disk replay** of `<runId>.jsonl` (or the newest run for the scope when
   `runId` is omitted).

Pass `live: '1'` for "is something running *right now*?" probes — it skips the
disk fallback and skips finished-but-lingering in-memory runs (so a completed
run isn't replayed as if fresh).

### Not-found behavior (no exception thrown — handle on the stream)
- `live:'1'` with nothing running → HTTP **204** (intentional: "nothing running"
  is not an error). The fetch reader treats the body-less 204 as a clean, empty
  stream that finishes immediately (`onDone` fires, no events).
- non-live with no live **and** no persisted run → HTTP **404** with body
  `{ error, hint }` → the transport raises a `ZeusStreamError` (status 404) to
  `onError` / the async iterator.

### Event `data` shapes (all carry an ISO `at`)
| `type` | payload | meaning |
|--------|---------|---------|
| `info` | `{ at, message, runId?, kind? }` | first event carries `runId` + `kind` |
| `step` | `{ at, message, ... }` | progress step |
| `success` | `{ at, message }` | a step succeeded |
| `warn` | `{ at, message }` | non-fatal warning |
| `error` | `{ at, message }` | fatal error |
| `done` | `{ at, ... }` | run completed (summary fields) |
| `reveal` | `{ at, ... }` | late-revealed sensitive payload |

Heartbeat comment frames are sent periodically and ignored by the parser.

```js
const s = sdk.runs.stream({ domain: 'cluster', scope: ['z-02'], kind: 'provision' });
s.onMessage = (ev) => console.log(ev.type, ev.data.message);
s.onDone = () => console.log('done');

// replay a specific historical run
for await (const ev of sdk.runs.stream({ domain: 'helm', scope: ['app1', 'z-02'], runId })) {
  if (ev.type === 'done') break;
}
```
