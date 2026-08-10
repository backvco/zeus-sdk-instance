// @ts-nocheck
/**
 * ServiceRunsService — ephemeral (run-to-completion) invocations of a service.
 *
 * Accessed as `sdk.services.runs`.
 *
 * Zeus stamps a one-shot K8s Job from a service's existing definition plus
 * allowlisted per-invocation env overrides (`params`), tracks it durably in
 * Postgres through `pending → running → succeeded|failed|cancelled|lost`,
 * cleans it up, and alerts if it loses track. A service must opt in with an
 * `ephemeralRun` config block (`allowedParamKeys`, `allowedEnvironments`, etc.)
 * before `create()` will succeed.
 *
 * Container-scoped: every method takes `{ container, name, ... }` where `name`
 * is the service to run. Status is advanced by a server-side watch+sweep
 * daemon, never solely by the request that created the run — poll `get()`/
 * `list()`, or use `stream()` for live push.
 *
 * Auth: a service token's policy can be scoped to invoke/view runs for a
 * single service — see `docs/service-runs.md` for the example policy.
 */
export class ServiceRunsService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Start a run: stamp and launch a one-shot Job from the service's
   * `ephemeralRun` config, with `params` overlaid as allowlisted env vars.
   * Route: POST /api/v2configs/[container]/services/[name]/runs
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name (must have `ephemeralRun.enabled`).
   * @param {string} params.environment   - Target environment (must be in `allowedEnvironments`).
   * @param {object} [params.params]      - Env-var overrides; keys must be in the service's `allowedParamKeys`.
   * @param {string} [params.dedupKey]    - Idempotency key; a second call with the same key while
   *   the prior run is in-flight returns 409 instead of starting a duplicate.
   * @param {string} [params.requireCluster] - Hard pin: run only on this cluster (must be in the
   *   environment and the service's `allowedClusters` if set). 400/409 if unavailable.
   * @param {string} [params.preferCluster]  - Soft preference: try this cluster first, then the
   *   service's `preferredClusters`, then remaining env clusters. Ignored if ineligible.
   *   When both `requireCluster` and `preferCluster` are set, require wins.
   * @returns {Promise<{ runId: string, status: string, cluster: string }>} 201 on success.
   * @throws {import('../errors.js').ZeusApiError} 409 `{ error:'in-flight', run }` on a live dedup collision,
   *   429 when the service's `maxConcurrent` in-flight cap is hit, 400 on a disallowed/invalid param.
   * @example
   * const { runId, status, cluster } = await sdk.services.runs.create({
   *   container: 'app1', name: 'meeting-recorder', environment: 'prod',
   *   params: { MEETING_URL: 'https://meet.example.com/abc' }, dedupKey: 'meeting-abc',
   *   preferCluster: 'z-02',
   * });
   */
  create({ container, name, environment, params, dedupKey, requireCluster, preferCluster }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/runs`, 'POST', {
      body: { environment, params, dedupKey, requireCluster, preferCluster },
    });
  }

  /**
   * List runs for a service, newest first.
   * Route: GET /api/v2configs/[container]/services/[name]/runs
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.environment] - Filter by environment.
   * @param {string} [params.status]      - Filter by status (pending|running|succeeded|failed|cancelled|lost).
   * @param {number} [params.limit]       - Max rows to return.
   * @returns {Promise<{ runs: object[] }>}
   * @example
   * const { runs } = await sdk.services.runs.list({ container: 'app1', name: 'meeting-recorder', status: 'running' });
   */
  list({ container, name, environment, status, limit }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/runs`, 'GET', {
      query: { environment, status, limit },
    });
  }

  /**
   * Get one run by id.
   * Route: GET /api/v2configs/[container]/services/[name]/runs/[runId]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.runId         - Run id.
   * @returns {Promise<{ run: object }>}
   * @example
   * const { run } = await sdk.services.runs.get({ container: 'app1', name: 'meeting-recorder', runId });
   */
  get({ container, name, runId }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}`,
      'GET',
    );
  }

  /**
   * Cancel an in-flight run: delete its Job and mark it `cancelled`.
   * Route: DELETE /api/v2configs/[container]/services/[name]/runs/[runId]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.runId         - Run id.
   * @returns {Promise<{ run: object }>}
   * @throws {import('../errors.js').ZeusApiError} 409 `{ error:'terminal', run }` if the run already finished.
   * @example
   * await sdk.services.runs.cancel({ container: 'app1', name: 'meeting-recorder', runId });
   */
  cancel({ container, name, runId }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}`,
      'DELETE',
    );
  }

  /**
   * Fetch a run's logs — the live pod log tail while running, or the
   * persisted `log_tail` captured at finalize once terminal (the pod is
   * gone after its TTL).
   * Route: GET /api/v2configs/[container]/services/[name]/runs/[runId]/logs
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.runId         - Run id.
   * @returns {Promise<{ log: string, live: boolean }>} `live` is true when pulled from the running pod.
   * @example
   * const { log, live } = await sdk.services.runs.logs({ container: 'app1', name: 'meeting-recorder', runId });
   */
  logs({ container, name, runId }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/logs`,
      'GET',
    );
  }

  /**
   * Stream a run's status live (SSE) — a convenience over polling `get()`.
   * Emits `event: run` with the current run row first, then again on every
   * status transition. Polling `get()`/`list()` remains the restart-safe
   * source of truth; this is push for UI.
   * Route: GET /api/v2configs/[container]/services/[name]/runs/[runId]/stream
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.runId         - Run id.
   * @param {AbortSignal} [params.signal]  - Abort signal to close the stream.
   * @returns {ReturnType<import('../stream.js').openStream>} Stream handle (async-iterable + onMessage/onDone/onError + close()).
   * @example
   * const s = sdk.services.runs.stream({ container: 'app1', name: 'meeting-recorder', runId });
   * s.onMessage = (ev) => { if (ev.type === 'run') console.log(ev.data.status); };
   */
  stream({ container, name, runId, signal }) {
    return this.sdk._stream(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/stream`,
      'GET',
      { signal },
    );
  }
}
