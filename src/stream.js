// @ts-nocheck
/**
 * Server-Sent-Events transport for the Zeus instance SDK.
 *
 * Zeus exposes ~12 long-running operations as SSE streams — cluster
 * provision/destroy, node-group apply, AMI/GCP image builds, helm rollouts,
 * credential rotation, k8s log tails, k8s resource watches, the unified
 * `/api/runs/stream` log, and the help-chat assistant. Some are `GET`
 * (watch/logs/runs), some are `POST` with a JSON body (provision/build/rotate).
 *
 * `openStream()` unifies both into a single handle that is:
 *   - **async-iterable** — `for await (const ev of stream) { ... }`
 *   - **callback-driven** — pass `{ onOpen, onMessage, onError, onDone }`
 *   - **cancelable** — `stream.close()` (also abort via an `AbortSignal`)
 *
 * Each emitted event is `{ type, data, raw }`:
 *   - `type`  — the SSE `event:` name, or `'message'` when unnamed.
 *   - `data`  — the `data:` payload parsed as JSON, falling back to the raw string.
 *   - `raw`   — the raw `data:` string, untouched.
 *
 * Transport selection: a browser `GET` with no explicit token uses the native
 * `EventSource` (cookie auth + automatic reconnect). Everything else (any
 * `POST`, or any call carrying an Authorization / x-dev-key header, or Node)
 * uses `fetch()` + a streaming body reader — the exact frame-parsing the app
 * already does in `AwsSetupPanel.svelte` and `streamRuns.svelte.js`.
 */

/**
 * Parse a batch of raw SSE text into discrete `{ type, data, raw }` events.
 * Frames are separated by a blank line; `event:` sets the type, `data:` lines
 * are concatenated. Used by the fetch-reader path.
 *
 * @param {string} chunk - One or more complete SSE frames.
 * @returns {Array<{ type: string, data: *, raw: string }>}
 */
function parseFrames(chunk) {
  const out = [];
  for (const frame of chunk.split('\n\n')) {
    if (!frame.trim()) continue;
    let type = 'message';
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      // ignore `id:`, `retry:`, comments (`:`)
    }
    if (!dataLines.length) continue;
    const raw = dataLines.join('\n');
    let data = raw;
    try { data = JSON.parse(raw); } catch { /* keepalive / non-JSON */ }
    out.push({ type, data, raw });
  }
  return out;
}

/**
 * Open an SSE stream. Normally called via a service method
 * (e.g. `sdk.runs.stream(...)`, `sdk.clusters.provision(...)`), not directly.
 *
 * @param {object} cfg
 * @param {string}   cfg.url               - Fully-resolved URL (baseURL + endpoint + query).
 * @param {string}   [cfg.method='GET']    - HTTP method.
 * @param {*}        [cfg.body]            - JSON body for POST streams.
 * @param {object}   [cfg.headers]         - Extra headers (auth, content-type) from BaseSDK.
 * @param {boolean}  [cfg.withCredentials] - Send cookies (browser session auth).
 * @param {AbortSignal} [cfg.signal]       - External abort signal.
 * @param {boolean}  [cfg.forceFetch]      - Force the fetch-reader path (skip EventSource).
 * @param {typeof fetch} [cfg.fetchImpl]   - Injected fetch.
 * @param {function} [cfg.onOpen]          - Called once the stream connects.
 * @param {function} [cfg.onMessage]       - Called with each `{ type, data, raw }` event.
 * @param {function} [cfg.onError]         - Called with a transport error.
 * @param {function} [cfg.onDone]          - Called once when the stream ends.
 * @returns {{
 *   close: () => void,
 *   [Symbol.asyncIterator]: () => AsyncGenerator<{type:string,data:*,raw:string}>,
 * }}
 *
 * @example
 * // callback style
 * const stream = sdk.runs.stream({ domain: 'cluster-apply', scope: ['app1','z-02'] });
 * stream.onMessage = (ev) => console.log(ev.type, ev.data);
 * stream.onDone = () => console.log('finished');
 *
 * @example
 * // async-iterator style
 * for await (const ev of sdk.k8s.watch({ resource: 'pods', cluster: 'z-02' })) {
 *   if (ev.type === 'message') handlePodEvent(ev.data);
 * }
 */
export function openStream(cfg) {
  const {
    url,
    method = 'GET',
    body,
    headers = {},
    withCredentials = true,
    signal,
    forceFetch = false,
    fetchImpl,
  } = cfg;

  const handlers = {
    onOpen: cfg.onOpen || null,
    onMessage: cfg.onMessage || null,
    onError: cfg.onError || null,
    onDone: cfg.onDone || null,
  };

  // Queue bridging the producer (transport) and the async-iterator consumer.
  const queue = [];
  let waiters = [];
  let ended = false;
  let errored = null;

  const push = (ev) => {
    handlers.onMessage?.(ev);
    if (waiters.length) waiters.shift().resolve({ value: ev, done: false });
    else queue.push(ev);
  };
  const finish = (err) => {
    if (ended) return;
    ended = true;
    if (err) { errored = err; handlers.onError?.(err); }
    handlers.onDone?.();
    for (const w of waiters) err ? w.reject(err) : w.resolve({ value: undefined, done: true });
    waiters = [];
  };

  let close = () => {};
  const hasAuthHeader = Object.keys(headers).some((k) => /^(authorization|x-dev-key)$/i.test(k));
  const isBrowser = typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';
  const useEventSource =
    !forceFetch && isBrowser && method.toUpperCase() === 'GET' && !hasAuthHeader;

  if (useEventSource) {
    const es = new window.EventSource(url, { withCredentials });
    let opened = false;
    es.onopen = () => { if (!opened) { opened = true; handlers.onOpen?.(); } };
    es.onmessage = (e) => push({ type: 'message', data: safeJson(e.data), raw: e.data });
    es.onerror = (e) => {
      // EventSource auto-reconnects on transient errors; surface but don't end
      // unless it's closed.
      if (es.readyState === window.EventSource.CLOSED) finish(new Error('stream closed'));
      else handlers.onError?.(e);
    };
    close = () => { try { es.close(); } catch { /* noop */ } finish(); };
    if (signal) signal.addEventListener('abort', close, { once: true });
  } else {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    close = () => { try { ac.abort(); } catch { /* noop */ } };

    const doFetch = fetchImpl || fetch;
    const reqHeaders = { ...headers, Accept: 'text/event-stream' };
    if (body !== undefined && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    (async () => {
      try {
        const res = await doFetch(url, {
          method,
          headers: reqHeaders,
          credentials: withCredentials ? 'include' : 'same-origin',
          body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          throw new ZeusStreamError(`stream HTTP ${res.status}`, res.status, text);
        }
        handlers.onOpen?.();
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() || '';
          for (const f of frames) for (const ev of parseFrames(f + '\n\n')) push(ev);
        }
        if (buf.trim()) for (const ev of parseFrames(buf + '\n\n')) push(ev);
        finish();
      } catch (err) {
        if (ac.signal.aborted) finish();
        else finish(err);
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    })();
  }

  const handle = {
    close,
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
          if (errored) return Promise.reject(errored);
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
        },
        return() { close(); return Promise.resolve({ value: undefined, done: true }); },
      };
    },
  };
  // Expose the handlers as live properties so callback-style consumers can
  // assign `stream.onMessage = fn` after the stream is created and have it take
  // effect (the transport reads `handlers.*` on every event).
  for (const key of ['onOpen', 'onMessage', 'onError', 'onDone']) {
    Object.defineProperty(handle, key, {
      get: () => handlers[key],
      set: (fn) => { handlers[key] = fn; },
      enumerable: true,
    });
  }
  return handle;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return s; }
}

/** Error raised when a streaming request returns a non-OK HTTP status. */
export class ZeusStreamError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ZeusStreamError';
    this.status = status;
    this.body = body;
  }
}
