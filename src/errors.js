// @ts-nocheck
/**
 * Error types thrown by the Zeus instance SDK.
 *
 * Every service method throws on HTTP 4xx/5xx. The thrown error is a
 * {@link ZeusApiError} carrying the parsed body, status code, and the endpoint
 * that failed — so you can branch on `err.status` or read `err.body.error`.
 *
 * A small number of endpoints have a documented "soft failure" contract that
 * callers must handle specially; those throw a dedicated subclass so existing
 * call sites keep their behavior after migrating to the SDK. Today the only one
 * is {@link ReachabilityAckRequiredError} (HTTP 412 from cluster-reachability
 * gated infrastructure operations).
 */

/**
 * Thrown for any non-OK HTTP response.
 *
 * @example
 * try {
 *   await sdk.clusters.get({ container: 'app1', name: 'does-not-exist' });
 * } catch (err) {
 *   if (err instanceof ZeusApiError) {
 *     err.status;    // 404
 *     err.body;      // { error: 'Cluster not found' }
 *     err.endpoint;  // '/v2configs/app1/clusters/does-not-exist'
 *     err.requestId; // x-request-id, when the response or the client sent one
 *   }
 * }
 */
export class ZeusApiError extends Error {
  /**
   * @param {string} message  - Human-readable message (body.error || body.message || `HTTP <status>`).
   * @param {object} [opts]
   * @param {number} [opts.status]    - HTTP status code.
   * @param {*}      [opts.body]      - Parsed response body (object or string).
   * @param {string} [opts.endpoint]  - Endpoint path (relative to baseURL) that failed.
   * @param {string} [opts.method]    - HTTP method used.
   * @param {string} [opts.requestId] - `x-request-id` from the response, else the id this call sent.
   * @param {Error}  [opts.cause]     - Underlying transport error, when the failure never got a response.
   */
  constructor(message, { status, body, endpoint, method, requestId, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ZeusApiError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
    this.method = method;
    this.requestId = requestId || null;
  }
}

/**
 * Build the message callers log. Gateway failures and empty bodies include
 * status, method, endpoint, and request id. A 4xx that already has a server
 * message keeps that text; `requestId` is still set on the error object.
 *
 * @param {string} serverMessage
 * @param {{ status?: number, endpoint?: string, method?: string, requestId?: string, network?: boolean }} [ctx]
 * @returns {string}
 */
export function formatApiErrorMessage(serverMessage, { status, endpoint, method, requestId, network = false } = {}) {
  const where = [method, endpoint].filter(Boolean).join(' ');
  const parts = [];
  if (network) parts.push('network error');
  else if (status) parts.push(`HTTP ${status}`);
  if (where) parts.push(where);
  if (requestId) parts.push(`request ${requestId}`);
  const suffix = parts.join(' ');
  const base = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  if (!base || (status && base === `HTTP ${status}`)) return suffix || base || 'request failed';
  if (requestId && base.includes(requestId)) return base;
  return suffix ? `${base} (${suffix})` : base;
}

/**
 * Thrown when an infrastructure operation is blocked because the target cluster
 * has not been confirmed reachable (server responds HTTP 412 with
 * `requiresAcknowledgement: true`). Mirrors the legacy
 * `ReachabilityAckRequiredError` in `env-infra-manage/fetchHelpers.js` so
 * callers can prompt the user to acknowledge and retry with the ack flag.
 *
 * @example
 * try {
 *   await sdk.infrastructure.helm({ container, ...body });
 * } catch (err) {
 *   if (err instanceof ReachabilityAckRequiredError) {
 *     // err.payload → { error, requiresAcknowledgement: true, ...context }
 *     // show a confirm dialog, then retry the call with the ack field set
 *   }
 * }
 */
export class ReachabilityAckRequiredError extends ZeusApiError {
  /**
   * @param {object} payload - The parsed 412 response body.
   */
  constructor(payload) {
    super(payload?.error || 'Reachability acknowledgement required', {
      status: 412,
      body: payload,
    });
    this.name = 'ReachabilityAckRequiredError';
    this.payload = payload;
  }
}
