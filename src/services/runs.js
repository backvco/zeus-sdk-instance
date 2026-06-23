// @ts-nocheck
/**
 * RunsService — the unified run log: history, liveness, and live/replay streams.
 *
 * Accessed as `sdk.runs`.
 *
 * Zeus runs every long operation (cluster provision/destroy, node-group apply,
 * AMI/GCP image build, helm rollout, credential rotation, VPC apply, …) as a
 * "run" identified by a `domain` (the operation family) and a `scope` (the
 * target — e.g. a cluster name, or `[cluster, nodegroup]` for multi-segment
 * scopes). Each run streams progress events live and is persisted to a
 * `<runId>.jsonl` log on disk so it can be replayed after it finishes.
 *
 * `scope` is a **repeatable** query key: pass it as an array (`scope: ['app1',
 * 'z-02']`) — base.js appends array values as repeated `scope=` params, exactly
 * as the routes expect via `url.searchParams.getAll('scope')`.
 *
 * Typical lifecycle:
 *   1. `history({ domain, scope })`  — list past runs for a target.
 *   2. `stream({ domain, scope })`   — tail the live run, or replay the newest
 *      persisted one; pass `runId` to replay a specific historical run.
 *   3. `inFlight({ domain, scope })` — cheap boolean probe: is a run executing
 *      right now? (Used to detect a stuck "destroying" status after a restart.)
 *
 * ─── Stream event shapes ──────────────────────────────────────────────────────
 *
 * `stream()` yields `{ type, data, raw }` events (see {@link openStream}). The
 * server emits these `data` payload shapes (all carry an ISO `at` timestamp):
 *   - `{ type:'info',    at, message, runId?, kind? }`  — first event carries runId+kind
 *   - `{ type:'step',    at, message, ... }`            — progress step
 *   - `{ type:'success', at, message }`                 — a step succeeded
 *   - `{ type:'warn',    at, message }`                 — non-fatal warning
 *   - `{ type:'error',   at, message }`                 — fatal error
 *   - `{ type:'done',    at, ... }`                     — run completed (summary fields)
 *   - `{ type:'reveal',  at, ... }`                     — late-revealed sensitive payload
 *   - heartbeat comment frames (ignored by the parser)
 */
export class RunsService {
	constructor(sdk) {
		this.sdk = sdk;
	}

	/**
	 * List past runs for a (domain, scope) target, newest first.
	 *
	 * @param {object} params
	 * @param {string}   params.domain  - Operation family (e.g. 'cluster', 'vpc', 'nodepool', 'helm').
	 * @param {string[]} params.scope   - Target scope segment(s) — repeatable key (e.g. ['app1','z-02']).
	 * @param {number}   [params.limit] - Max runs to return (defaults to the domain's retention count).
	 * @returns {Promise<{
	 *   domain: string,
	 *   scope: string[],
	 *   runs: Array<{
	 *     runId: string, kind: string, startedAt: string, finishedAt: string,
	 *     finalType: string, finalMessage: string, sizeBytes: number
	 *   }>
	 * }>}
	 * @example
	 * const { runs } = await sdk.runs.history({ domain: 'cluster', scope: ['z-02'] });
	 * // → { domain:'cluster', scope:['z-02'], runs:[{ runId:'2026-...', kind:'provision', ... }] }
	 */
	history({ domain, scope, limit }) {
		return this.sdk._fetch('/runs/history', 'GET', { query: { domain, scope, limit } });
	}

	/**
	 * Liveness probe — is a run for this (domain, scope, kind) executing right now?
	 * A persisted status (e.g. cluster `state:'destroying'`) only records that a
	 * run STARTED; after a server restart it sticks even though the run is gone.
	 * This surfaces that mismatch so the UI can offer recovery instead of tailing
	 * a log that will never end.
	 *
	 * Provide either (domain + scope[, kind]) or an explicit `runKey`.
	 *
	 * @param {object} params
	 * @param {string}   [params.domain]  - Operation family.
	 * @param {string[]} [params.scope]   - Target scope segment(s) — repeatable key.
	 * @param {string}   [params.kind='apply'] - Run variant (apply|destroy|provision|build).
	 * @param {string}   [params.runKey]  - Explicit in-memory run key (bypasses domain/scope).
	 * @returns {Promise<{ inFlight: boolean }>}
	 * @example
	 * const { inFlight } = await sdk.runs.inFlight({ domain: 'cluster', scope: ['z-02'], kind: 'destroy' });
	 */
	inFlight({ domain, scope, kind, runKey }) {
		return this.sdk._fetch('/runs/in-flight', 'GET', { query: { domain, scope, kind, runKey } });
	}

	/**
	 * Open a run's event stream — live tail of an in-flight run, or a disk replay
	 * of a persisted run (SSE). Resolution order on the server:
	 *   1. live in-memory run matching the runKey (replays buffered history, then
	 *      streams live events);
	 *   2. disk replay of `<runId>.jsonl` (or the newest run for the scope when
	 *      `runId` is omitted).
	 *
	 * Pass `live: '1'` for "is something running right now?" probes — it skips the
	 * disk fallback and skips finished-but-lingering in-memory runs, so it never
	 * replays a completed run as if it were fresh.
	 *
	 * NOT-FOUND BEHAVIOR (no exception is thrown — handle on the returned stream):
	 *   - `live:'1'` with nothing running → HTTP **204** (intentional: nothing is
	 *     running is not an error). The fetch reader treats a body-less 204 as a
	 *     clean, empty stream that finishes immediately.
	 *   - non-live with no live AND no persisted run → HTTP **404** with body
	 *     `{ error, hint }`. The fetch transport raises a `ZeusStreamError`
	 *     (status 404) to the stream's `onError` / async-iterator.
	 *
	 * @param {object} params
	 * @param {string}   params.domain   - Operation family (required).
	 * @param {string[]} [params.scope]  - Target scope segment(s) — repeatable key (required unless runKey).
	 * @param {string}   [params.runId]  - Replay a specific historical run id (omit to tail live / newest).
	 * @param {string}   [params.kind='apply'] - Run variant; disambiguates the runKey for apply-vs-destroy domains.
	 * @param {string}   [params.live]   - '1' to require a live run (204 when none; no replay).
	 * @param {string}   [params.runKey] - Explicit in-memory run key (overrides scope-derived key).
	 * @param {AbortSignal} [params.signal] - Abort signal to close the stream.
	 * @returns {ReturnType<import('../stream.js').openStream>} Stream handle (async-iterable + onMessage/onDone/onError + close()).
	 * @example
	 * const s = sdk.runs.stream({ domain: 'cluster', scope: ['z-02'], kind: 'provision' });
	 * s.onMessage = (ev) => console.log(ev.type, ev.data.message);
	 * s.onDone = () => console.log('stream ended');
	 * @example
	 * // replay a specific historical run
	 * for await (const ev of sdk.runs.stream({ domain: 'helm', scope: ['app1','z-02'], runId })) {
	 *   if (ev.type === 'done') break;
	 * }
	 */
	stream({ domain, scope, runId, kind, live, runKey, signal }) {
		return this.sdk._stream('/runs/stream', 'GET', {
			query: { domain, scope, runId, kind, live, runKey },
			signal
		});
	}
}
