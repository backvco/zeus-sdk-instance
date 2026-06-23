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
 *     err.status;   // 404
 *     err.body;     // { error: 'Cluster not found' }
 *     err.endpoint; // '/v2configs/app1/clusters/does-not-exist'
 *   }
 * }
 */
export class ZeusApiError extends Error {
  /**
   * @param {string} message  - Human-readable message (body.error || body.message || `HTTP <status>`).
   * @param {object} [opts]
   * @param {number} [opts.status]   - HTTP status code.
   * @param {*}      [opts.body]     - Parsed response body (object or string).
   * @param {string} [opts.endpoint] - Endpoint path (relative to baseURL) that failed.
   * @param {string} [opts.method]   - HTTP method used.
   */
  constructor(message, { status, body, endpoint, method } = {}) {
    super(message);
    this.name = 'ZeusApiError';
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
    this.method = method;
  }
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
