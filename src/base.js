// @ts-nocheck
import { ZeusApiError, ReachabilityAckRequiredError } from './errors.js';
import { openStream } from './stream.js';

/**
 * BaseSDK — low-level HTTP + SSE transport shared by every service namespace.
 *
 * You normally don't instantiate this directly; use {@link ZeusInstanceSDK}.
 * It is exported so you can extend it for a custom client.
 *
 * ─── Instance & URL resolution ────────────────────────────────────────────────
 *
 * A Zeus deployment is reached at `https://<instance>.<rootUrl>`. Each customer
 * gets a unique instance name (the first hostname label):
 *   - dev:  instance `acme` + rootUrl `my-dev.zeusk8s.com` → acme.my-dev.zeusk8s.com
 *   - prod: instance `acme` + rootUrl `my.zeusk8s.com`     → acme.my.zeusk8s.com
 *
 * The base URL is resolved in this order:
 *   1. explicit `baseURL` option (wins over everything)
 *   2. browser default — same-origin `/api` (the page is already on the instance host)
 *   3. `https://<instance>.<rootUrl>/api`
 *
 * `rootUrl` defaults to `my.zeusk8s.com` (production) and can be overridden by
 * the constructor or, in Node, the `ZEUS_ROOT_URL` environment variable
 * (e.g. `my-dev.zeusk8s.com` for development).
 *
 * ─── Auth ─────────────────────────────────────────────────────────────────────
 *
 *   Browser — no token needed; the session cookie is sent via `credentials:'include'`.
 *   Node    — pass `token` (a `zeus_...` service token → `Authorization: Bearer`)
 *             or `devKey` (the `DEV_API_KEY` → `x-dev-key` header).
 *
 * @example
 * import { BaseSDK } from '@zeusk8s/sdk-instance';
 * const client = new BaseSDK({ instance: 'acme', rootUrl: 'my-dev.zeusk8s.com', devKey: '...' });
 * const cfg = await client._fetch('/v2configs/config', 'GET');
 */
export class BaseSDK {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseURL]  - Explicit API base (e.g. "http://localhost:5199/api"). Trailing slash stripped.
   * @param {string} [opts.instance] - Instance name / first hostname label. Browser: auto-derived from window.location.
   * @param {string} [opts.rootUrl]  - Root domain (default "my.zeusk8s.com" or ZEUS_ROOT_URL; "my-dev.zeusk8s.com" in dev).
   * @param {string} [opts.token]    - Service token ("zeus_...") → Authorization: Bearer.
   * @param {string} [opts.devKey]   - Dev API key → x-dev-key header.
   * @param {typeof fetch} [opts.fetch] - Injected fetch (SvelteKit `event.fetch`, tests).
   */
  constructor({ baseURL, instance, rootUrl, token, devKey, fetch: fetchImpl } = {}) {
    const isBrowser = typeof window !== 'undefined';
    const envRoot = typeof process !== 'undefined' && process.env ? process.env.ZEUS_ROOT_URL : undefined;

    this.instance = instance || (isBrowser ? deriveInstanceFromLocation() : null);
    this.rootUrl = rootUrl || envRoot || 'my.zeusk8s.com';

    if (baseURL) {
      this.baseURL = baseURL.replace(/\/$/, '');
    } else if (isBrowser && !instance && !rootUrl) {
      // Page is already served from the instance host — call same-origin.
      this.baseURL = '/api';
    } else if (this.instance) {
      this.baseURL = `https://${this.instance}.${this.rootUrl}/api`;
    } else {
      this.baseURL = '/api';
    }

    this.token = token || null;
    this.devKey = devKey || null;
    this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this.debugMode = false;
  }

  /**
   * Replace the service token at runtime.
   * @param {string} token
   */
  setToken(token) { this.token = token; }

  /**
   * Toggle debug mode (inspectable as `this.debugMode` in overrides).
   * @param {boolean} [on=true]
   * @returns {this}
   */
  debug(on = true) { this.debugMode = on; return this; }

  /**
   * Build the auth/content headers for a request.
   * @private
   */
  _authHeaders(extra = {}) {
    const h = { ...extra };
    if (this.token && !h.Authorization && !h.authorization) h.Authorization = `Bearer ${this.token}`;
    if (this.devKey && !h['x-dev-key']) h['x-dev-key'] = this.devKey;
    return h;
  }

  /**
   * Core JSON request. Every non-streaming service method calls this.
   *
   * Returns exactly what the server returned — `await res.json()` (or text when
   * the response isn't JSON). No unwrapping: the caller reads the same fields it
   * read before the SDK existed.
   *
   * On HTTP 4xx/5xx it throws a {@link ZeusApiError} (or
   * {@link ReachabilityAckRequiredError} for a 412 `requiresAcknowledgement`).
   *
   * @param {string} endpoint  - Path relative to baseURL, e.g. "/v2configs/containers".
   * @param {string} method    - "GET" | "POST" | "PUT" | "PATCH" | "DELETE".
   * @param {object} [opts]
   * @param {*}      [opts.body]    - Request body, JSON-serialised automatically.
   * @param {object} [opts.query]   - Query params. Array values become repeated keys.
   * @param {object} [opts.headers] - Extra headers merged over defaults.
   * @param {AbortSignal} [opts.signal] - Optional abort signal (timeouts / cancellation).
   * @returns {Promise<*>} Parsed JSON (or text) response body.
   *
   * @example
   * const { containers } = await sdk._fetch('/v2configs/containers', 'GET');
   * const created = await sdk._fetch('/v2configs/containers', 'POST', { body: { name: 'app2' } });
   * const slots = await sdk._fetch('/network/plans/main/slots', 'GET', { query: { region: 'us-east-2' } });
   * // with cancellation:
   * const ac = new AbortController();
   * sdk._fetch('/aws/ec2', 'GET', { query: { resource: 'vpcs' }, signal: ac.signal });
   */
  async _fetch(endpoint, method, { body, query, headers = {}, signal } = {}) {
    const url = this._url(endpoint, query);
    const h = this._authHeaders(headers);
    const hasBody = body !== undefined && method.toUpperCase() !== 'GET';
    if (hasBody && !h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(url, {
      method,
      headers: h,
      credentials: 'include',
      body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal,
    });

    const ct = res.headers.get('content-type') || '';
    const parse = async () =>
      ct.includes('application/json') ? res.json().catch(() => ({})) : res.text();

    if (!res.ok) {
      const errBody = await parse();
      if (res.status === 412 && errBody && errBody.requiresAcknowledgement) {
        throw new ReachabilityAckRequiredError(errBody);
      }
      throw new ZeusApiError(
        (errBody && (errBody.error || errBody.message)) || `HTTP ${res.status}`,
        { status: res.status, body: errBody, endpoint, method },
      );
    }
    return parse();
  }

  /**
   * Low-level streaming request — returns the raw `fetch` Response (auth +
   * credentials applied), for consumers that run their own SSE/reader loop and
   * need full control over status handling (e.g. the shared run-store, which
   * treats 204/404 as "no live run" and detects mid-stream interruptions).
   * Prefer {@link _stream} for new code.
   *
   * @param {string} path - A full "/api/..." path or absolute URL (used as-is),
   *   or an endpoint relative to baseURL.
   * @param {object} [opts]
   * @param {string} [opts.method='GET']
   * @param {*}      [opts.body]
   * @param {object} [opts.headers]
   * @returns {Promise<Response>} The raw fetch Response.
   *
   * @example
   * const res = await sdk.requestStream('/api/runs/stream?domain=cluster-apply&scope=app1', {});
   * if (res.ok && res.body) consumeMyOwnReader(res.body);
   */
  requestStream(path, { method = 'GET', body, headers = {} } = {}) {
    const url = (/^https?:\/\//.test(path) || path.startsWith('/api')) ? path : `${this.baseURL}${path}`;
    const h = this._authHeaders(headers);
    const hasBody = body !== undefined && method.toUpperCase() !== 'GET';
    if (hasBody && !h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';
    return this.fetchImpl(url, {
      method,
      headers: h,
      credentials: 'include',
      body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
  }

  /**
   * Create a native `EventSource` for a GET SSE endpoint, with credentials
   * (cookies) enabled and the URL resolved against baseURL. For browser
   * consumers that manage their own `onmessage`/`onerror`/reconnect. Browser
   * only (EventSource is not built into Node). Prefer {@link _stream} for new
   * code; this exists so existing `new EventSource('/api/...')` call sites can
   * route through the SDK with a minimal change.
   *
   * @param {string} path - Full "/api/..." path or absolute URL (used as-is),
   *   or an endpoint relative to baseURL.
   * @returns {EventSource}
   *
   * @example
   * const es = sdk.eventSource('/api/k8s/watch?resource=pods&cluster=z-02');
   * es.onmessage = (e) => handle(JSON.parse(e.data));
   * // later: es.close();
   */
  eventSource(path) {
    const url = (/^https?:\/\//.test(path) || path.startsWith('/api')) ? path : `${this.baseURL}${path}`;
    return new EventSource(url, { withCredentials: true });
  }

  /**
   * Open a Server-Sent-Events stream. Streaming service methods call this.
   * See {@link openStream} for the returned handle's shape (async-iterable +
   * `onOpen/onMessage/onError/onDone` callbacks + `close()`).
   *
   * @param {string} endpoint
   * @param {string} [method='GET']
   * @param {object} [opts]
   * @param {*}      [opts.body]
   * @param {object} [opts.query]
   * @param {object} [opts.headers]
   * @param {AbortSignal} [opts.signal]
   * @returns {ReturnType<typeof openStream>}
   */
  _stream(endpoint, method = 'GET', { body, query, headers = {}, signal } = {}) {
    return openStream({
      url: this._url(endpoint, query),
      method,
      body,
      headers: this._authHeaders(headers),
      withCredentials: true,
      signal,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * Resolve a full URL from an endpoint + query object.
   * @private
   */
  _url(endpoint, query) {
    let url = `${this.baseURL}${endpoint}`;
    if (query && Object.keys(query).length) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) for (const item of v) sp.append(k, item);
        else sp.append(k, v);
      }
      const qs = sp.toString();
      if (qs) url += `?${qs}`;
    }
    return url;
  }
}

/**
 * Derive the instance name from the current browser hostname's first label.
 * `acme.my.zeusk8s.com` → `acme`; `acme.my-dev.zeusk8s.com` → `acme`.
 * Returns null for bare hostnames (localhost, IPs).
 * @returns {string | null}
 */
export function deriveInstanceFromLocation() {
  if (typeof window === 'undefined' || !window.location) return null;
  const host = window.location.hostname || '';
  if (!host || /^[\d.]+$/.test(host) || host === 'localhost') return null;
  const parts = host.split('.');
  return parts.length >= 3 ? parts[0] : null;
}
