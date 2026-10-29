// @ts-nocheck
/**
 * Transient-failure policy for {@link BaseSDK#_fetch}.
 *
 * Retries are limited to idempotent calls: safe HTTP methods, an explicit
 * `idempotent: true`, and a small set of POST reads (deploy status with no
 * mutating `action`, plus pure validate/preview/check endpoints). Mutating
 * calls — including `retry-public-access` — are never retried, even when the
 * failure is a connection reset.
 *
 * Gateway statuses only. A 500 is an application error and might mean the
 * write already happened; a 4xx will not succeed on a repeat. 502 and 503
 * use the full attempt budget. A 504 is retried at most once: an empty
 * gateway timeout usually means the handler is still running, and another
 * retry would start a second copy of a slow read.
 */

export const RETRYABLE_STATUSES = new Set([502, 503, 504]);
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 200;
export const DEFAULT_MAX_DELAY_MS = 2000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Read-only `action` values on `POST /v2configs/deploy/status`.
 * Anything absent (restart, scale, delete, apply, retry-public-access, …)
 * is a mutation and must not be replayed after a dropped response.
 */
export const IDEMPOTENT_STATUS_ACTIONS = new Set([
  'secret-value',
  'generate-service',
  'service-pods',
  'service-overview',
  'service-metrics',
  'service-custom-metrics',
  'service-rightsizing',
  'service-rightsizing-env',
  'efficiency-collect-status',
  'efficiency-collect-settings-get',
  'cluster-efficiency',
  'cluster-recommendations',
  'check-drift',
  'uninstall-preview',
  'list-crons',
  'cron-job-logs',
]);

/** POST endpoints that only validate, preview, or check. Exact paths, not prefixes. */
export const IDEMPOTENT_POST_PATHS = new Set([
  '/v2configs/validate',
  '/v2configs/validate-user-data',
  '/v2configs/user-data-preview',
  '/v2configs/generate',
  '/v2configs/generate/preview',
  '/v2configs/identities/validate-policy',
  '/v2configs/identities/validate-gcp-manifest',
  '/v2configs/networks/cidr-check',
]);

const STATUS_PATH = '/v2configs/deploy/status';

/**
 * @param {string} method
 * @param {string} endpoint
 * @param {{ idempotent?: boolean, body?: * }} [opts]
 * @returns {boolean}
 */
export function isIdempotentCall(method, endpoint, { idempotent, body } = {}) {
  if (idempotent === true) return true;
  if (idempotent === false) return false;
  const verb = String(method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(verb)) return true;
  if (verb !== 'POST') return false;

  const path = String(endpoint || '').split('?')[0];
  if (IDEMPOTENT_POST_PATHS.has(path)) return true;
  if (path !== STATUS_PATH) return false;

  // Default deploy.status body (no action) is a live read. A string body hides
  // the action, so it is treated as unsafe — a mutation may be inside it.
  if (body == null) return true;
  if (typeof body !== 'object' || Array.isArray(body)) return false;
  const action = body.action;
  if (action == null || action === '') return true;
  return IDEMPOTENT_STATUS_ACTIONS.has(String(action));
}

/**
 * Equal jitter: 50%–100% of the capped exponential delay.
 * `attempt` is the number of failures so far (0 before the first retry).
 *
 * @param {number} attempt
 * @param {{ baseDelayMs?: number, maxDelayMs?: number, random?: () => number }} [policy]
 * @returns {number}
 */
export function backoffDelayMs(attempt, {
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  random = Math.random,
} = {}) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const unit = Number(random());
  const jitter = 0.5 + (Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0) * 0.5;
  return Math.round(exp * jitter);
}

/**
 * Connection resets and undici's "fetch failed" wrapper. Caller aborts and
 * timeouts are not retried — repeating those only multiplies the wait.
 *
 * @param {*} err
 * @returns {boolean}
 */
export function isRetryableNetworkError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return false;
  const code = err.code || err.cause?.code;
  if (NETWORK_CODES.has(code)) return true;
  const msg = `${err.message || ''} ${err.cause?.message || ''}`;
  return /ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network error/i.test(msg);
}

/**
 * @param {*} err
 * @returns {boolean}
 */
export function isRetryableFailure(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return false;
  if (RETRYABLE_STATUSES.has(err.status)) return true;
  if (typeof err.status === 'number' && err.status >= 400) return false;
  return isRetryableNetworkError(err);
}

export function newRequestId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Run `run` up to `maxAttempts` times when `idempotent` is set.
 * Non-idempotent calls invoke `run` exactly once. A 504 stops after one
 * retry even when attempts remain.
 *
 * @param {object} opts
 * @param {boolean} opts.idempotent
 * @param {() => Promise<*>} opts.run
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.baseDelayMs]
 * @param {number} [opts.maxDelayMs]
 * @param {() => number} [opts.random]
 * @param {AbortSignal} [opts.signal]
 * @param {(err: *) => *} [opts.onGiveUp] - Map the final error (network → API error).
 * @returns {Promise<*>}
 */
export async function withTransientRetry({
  idempotent,
  run,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  random = Math.random,
  signal,
  onGiveUp,
} = {}) {
  const attempts = idempotent ? Math.max(1, maxAttempts) : 1;
  let lastErr;
  let seen504 = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const retry504 = err?.status === 504 && seen504;
      if (err?.status === 504) seen504 = true;
      const more = idempotent
        && attempt < attempts - 1
        && isRetryableFailure(err)
        && !retry504
        && !signal?.aborted;
      if (!more) throw onGiveUp ? onGiveUp(err) : err;
      await sleep(backoffDelayMs(attempt, { baseDelayMs, maxDelayMs, random }), signal);
    }
  }
  throw onGiveUp ? onGiveUp(lastErr) : lastErr;
}
