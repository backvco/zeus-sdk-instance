// @ts-nocheck
/**
 * `activate-block-storage` apply is an unnamed SSE `data:` stream from
 * progress.js. Each frame's JSON `type` is info/step/warn/success/error/done.
 * Dry-run is a normal JSON body. storageAction() awaits the apply stream and
 * leaves every other action on _fetch.
 */
import { ZeusStreamError } from '../../../stream.js';

const ACTIVATE_ACTION = 'activate-block-storage';

/** Same flag check as the storage route (`true` or `'true'`). */
export function dryRunFlagOn(value) {
  return value === true || value === 'true';
}

/** Apply (not dry-run) of activate-block-storage. That call is the SSE stream. */
export function isActivateBlockStorageApply(payload) {
  return !!payload && payload.action === ACTIVATE_ACTION && !dryRunFlagOn(payload.dryRun);
}

function frameData(ev) {
  const data = ev?.data;
  if (!data || typeof data !== 'object') return null;
  return data;
}

function notify(onProgress, data) {
  if (typeof onProgress !== 'function') return;
  try { onProgress(data); } catch { /* a listener must not abort the apply */ }
}

/**
 * HTTP status from a stream-open failure. The published SDK and the vendored
 * copy are different constructors, so `instanceof ZeusStreamError` misses
 * the error `_stream` actually throws. Match `name` and `status` /
 * `statusCode` instead.
 * @param {object} err
 */
function streamHttpStatus(err) {
  if (typeof err.status === 'number') return err.status;
  if (typeof err.statusCode === 'number') return err.statusCode;
  return undefined;
}

/**
 * Turn a non-OK stream open into an error whose message is the route's
 * `error` string (confirm phrase, in-flight, missing storage, …).
 * @param {unknown} err
 */
function explainStreamHttpError(err) {
  if (!err || typeof err !== 'object') return err;
  const named = err.name === 'ZeusStreamError';
  const status = streamHttpStatus(err);
  if (!named && typeof status !== 'number') return err;
  if (typeof err.body !== 'string') return err;
  let parsed;
  try { parsed = JSON.parse(err.body); } catch { return err; }
  if (!parsed || typeof parsed !== 'object') return err;
  const message = parsed.error || parsed.message;
  if (!message) {
    err.body = parsed;
    return err;
  }
  return new ZeusStreamError(String(message), status, parsed);
}

/**
 * Read an activate-block-storage apply stream to its terminal frame.
 * `onProgress` receives each non-terminal frame (`info`, `step`, `warn`,
 * `success`). Resolves with the `done` payload. Rejects on an `error` frame,
 * a non-OK HTTP status (ZeusStreamError), or a stream that ends without `done`.
 *
 * @param {AsyncIterable<{ type: string, data: *, raw: string }>} stream
 * @param {(ev: object) => void} [onProgress]
 * @returns {Promise<object>}
 */
export async function consumeActivateBlockStorageStream(stream, onProgress) {
  try {
    for await (const ev of stream) {
      const data = frameData(ev);
      if (!data) continue;
      if (data.type === 'done') return data;
      if (data.type === 'error') {
        const err = new Error(data.message || 'activation failed');
        err.name = 'ActivateBlockStorageError';
        err.event = data;
        throw err;
      }
      notify(onProgress, data);
    }
  } catch (err) {
    throw explainStreamHttpError(err);
  }
  throw new Error('activate-block-storage stream ended without a done event');
}

/**
 * storageAction() implementation. `onProgress` and `signal` are client
 * options and are not posted. An explicit `body` is the request body
 * verbatim (same as before); pass `onProgress` / `signal` beside it.
 *
 * @param {{ sdk: { _fetch: Function, _stream: Function }, _base: (id: string) => string }} service
 * @param {object} params
 */
export function storageActionWithActivateStream(service, { id, body, onProgress, signal, ...rest }) {
  const payload = body ?? rest;
  if (isActivateBlockStorageApply(payload)) {
    const stream = service.sdk._stream(`${service._base(id)}/storage`, 'POST', {
      body: payload,
      signal
    });
    return consumeActivateBlockStorageStream(stream, onProgress);
  }
  return service.sdk._fetch(`${service._base(id)}/storage`, 'POST', { body: payload });
}
