// @ts-nocheck
/**
 * Optimistic-concurrency (CAS) helper for whole-document config saves.
 *
 * Zeus's config-store rejects a whole-doc replace unless the request carries
 * the `_rev` the writer read (`baseRev`). A mismatch means someone else wrote
 * the doc since your read — the server answers HTTP 409
 * `{ kind: 'stale-save', currentRev }` and writes nothing, so a stale client
 * can never silently revert another writer's fields.
 *
 * `casMutate` is the ergonomic wrapper: fetch fresh → apply the caller's
 * mutation → save with the fetched `_rev` — and on a stale-save 409, re-fetch
 * and re-apply the mutation against the NEW document, then try again. That
 * retry is safe precisely because the mutation function re-runs on the fresh
 * doc (compare-and-swap retry, not a merge of stale state).
 */
import { ZeusApiError } from './errors.js';

/**
 * Read-mutate-write with stale-save retry.
 *
 * @param {object} opts
 * @param {() => Promise<object>} opts.read  - Fetch the CURRENT document (must include `_rev`).
 * @param {(doc: object, baseRev: number|null) => Promise<*>} opts.write - Persist `doc` asserting `baseRev`.
 * @param {(doc: object) => object|void|Promise<object|void>} opts.mutate - Edit the doc in place (or return a replacement).
 * @param {number} [opts.retries=3] - Stale-save retry attempts after the first try.
 * @returns {Promise<*>} The `write` result of the attempt that succeeded.
 * @throws {ZeusApiError} The final stale-save 409 when retries are exhausted, or any non-stale-save error immediately.
 */
export async function casMutate({ read, write, mutate, retries = 3 }) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const doc = await read();
    const next = (await mutate(doc)) ?? doc;
    try {
      return await write(next, doc?._rev ?? null);
    } catch (err) {
      const staleSave =
        err instanceof ZeusApiError && err.status === 409 && err.body?.kind === 'stale-save';
      if (!staleSave) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Resolve the `baseRev` a replace-style `update()` should send: an explicit
 * value wins; otherwise the `_rev` riding on the document (present whenever
 * the doc came from a `get()`); otherwise `null`, which asserts "I expect no
 * document to exist yet" (valid for create; 409s loudly if one does — the
 * signal to fetch-before-write instead of building the doc blind).
 *
 * @param {object|undefined} data   - The document being written.
 * @param {number|null} [baseRev]   - Explicit override from the caller.
 * @returns {number|null}
 */
export function resolveBaseRev(data, baseRev) {
  if (baseRev !== undefined) return baseRev;
  const rev = data?._rev;
  return typeof rev === 'number' ? rev : null;
}
