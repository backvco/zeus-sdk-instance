// @ts-nocheck
/**
 * K8sLogsService — pod log access, accessed as `sdk.k8s.logs`.
 *
 * Three flavors:
 *   - {@link tail}   — one-shot snapshot of the last N lines (JSON).
 *   - {@link stream} — follow a single pod/container live (SSE).
 *   - {@link multi}  — multiplex several pods into one live feed (SSE).
 *
 * Streaming methods return an SSE stream handle (from `openStream`): it is
 * async-iterable (`for await (const ev of s)`) and exposes assignable
 * `onOpen/onMessage/onError/onDone` callbacks plus `close()`. Each emitted
 * event is `{ type, data, raw }`; for these log streams `type` is `'message'`
 * and `data` holds the per-line payload described in each method.
 */
export class K8sLogsService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * One-shot pod log snapshot — last `tailLines` lines, no follow.
   *
   * @param {object} params
   * @param {string} params.name              - Pod name (required).
   * @param {string} [params.namespace]       - Pod namespace.
   * @param {string} [params.cluster]         - Kube context / cluster name.
   * @param {string} [params.container]       - Container name (defaults to first container server-side).
   * @param {number} [params.tailLines=200]   - Number of trailing lines.
   * @returns {Promise<{ logs: string }>} Newline-joined log text.
   * @example
   * const { logs } = await sdk.k8s.logs.tail({ cluster: 'z-01', namespace: 'default', name: 'web-7d' });
   */
  tail({ name, namespace, cluster, container, tailLines } = {}) {
    return this.sdk._fetch('/k8s/logs', 'GET', {
      query: { name, namespace, cluster, container, tailLines },
    });
  }

  /**
   * Follow a single pod/container's logs as a live SSE stream.
   *
   * Each event's `data` is a single log line (a string). Error lines arrive as
   * `[error] <message>`. The stream stays open until you `close()` it or the
   * pod's log stream ends.
   *
   * @param {object} params
   * @param {string} params.name              - Pod name (required).
   * @param {string} [params.namespace]       - Pod namespace (defaults server-side).
   * @param {string} [params.cluster]         - Kube context (defaults server-side).
   * @param {string} [params.container]       - Container (defaults to first container).
   * @param {number} [params.tailLines=200]   - Initial lookback.
   * @param {boolean} [params.previous=false] - Logs from the previous (crashed) container instance.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE stream of log-line strings.
   * @example
   * const s = sdk.k8s.logs.stream({ cluster: 'z-01', namespace: 'default', name: 'web-7d' });
   * s.onMessage = (ev) => console.log(ev.data);
   * // later: s.close();
   */
  stream({ name, namespace, cluster, container, tailLines, previous } = {}) {
    return this.sdk._stream('/k8s/logs/stream', 'GET', {
      query: {
        name,
        namespace,
        cluster,
        container,
        tailLines,
        previous: previous ? '1' : undefined,
      },
    });
  }

  /**
   * Multiplex several pods' logs into one live SSE feed.
   *
   * Each event's `data` is `{ pod, container, line }` so the client can
   * colour-code per source. Pin a container per pod with `pod/container`
   * syntax in the `pods` list; otherwise the first container is resolved.
   * A single pod failing emits a `[error]` line for that pod without tearing
   * down the rest of the feed.
   *
   * @param {object} params
   * @param {string[]|string} params.pods     - Pod names (or `pod/container` specs). Array joined with commas.
   * @param {string} [params.namespace]       - Single namespace for all pods (defaults server-side).
   * @param {string} [params.cluster]         - Kube context (defaults server-side).
   * @param {number} [params.tailLines=200]   - Initial lookback per pod.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE stream of `{ pod, container, line }`.
   * @example
   * const s = sdk.k8s.logs.multi({ cluster: 'z-01', namespace: 'default', pods: ['web-7d/web', 'web-7d/sidecar'] });
   * s.onMessage = (ev) => { const { pod, container, line } = ev.data; console.log(`[${pod}/${container}] ${line}`); };
   */
  multi({ pods, namespace, cluster, tailLines } = {}) {
    const podsParam = Array.isArray(pods) ? pods.join(',') : pods;
    return this.sdk._stream('/k8s/logs/multi', 'GET', {
      query: { pods: podsParam, namespace, cluster, tailLines },
    });
  }
}
