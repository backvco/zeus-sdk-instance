// @ts-nocheck
import { K8sLogsService } from './k8s-logs.js';
import { K8sFlagsService } from './k8s-flags.js';

/**
 * K8sService — live Kubernetes operations against a managed cluster,
 * accessed as `sdk.k8s`.
 *
 * Every method targets a single cluster by its kube *context* (the cluster
 * name / `clusterArn`), passed as `cluster`. These wrap the in-app cluster-API
 * gateway, which transparently routes to EKS/GKE directly or to k3s/bare-metal
 * over the agent tunnel — the SDK surface is identical regardless of provider.
 *
 * Sub-namespaces:
 *   - `sdk.k8s.logs`  — pod log tail/stream/multi (see {@link K8sLogsService}).
 *   - `sdk.k8s.flags` — event flags / annotations (see {@link K8sFlagsService}).
 *
 * Streaming methods ({@link watch}, {@link nodeActionStream}) return an SSE
 * stream handle from `openStream`: async-iterable, with assignable
 * `onOpen/onMessage/onError/onDone` callbacks and `close()`. Each event is
 * `{ type, data, raw }`.
 *
 * Typical lifecycle: inspect with {@link clusterInfo}/{@link pods}/{@link nodes},
 * watch live changes with {@link watch}, then mutate with {@link scale},
 * {@link restart}, {@link deletePod}, or node actions.
 */
export class K8sService {
  constructor(sdk) {
    this.sdk = sdk;
    /** Pod log access (tail / stream / multi). @type {K8sLogsService} */
    this.logs = new K8sLogsService(sdk);
    /** Event flags (list / create / resolve / delete). @type {K8sFlagsService} */
    this.flags = new K8sFlagsService(sdk);
  }

  // ─── Cluster overview ──────────────────────────────────────────────────

  /**
   * Cluster summary used by the Dashboard tab (node/pod/namespace counts,
   * health rollup). Also triggers server-side pod-health alert detection.
   *
   * @param {object} params
   * @param {string} params.cluster - Kube context / cluster name (required).
   * @returns {Promise<object>} Cluster info bundle (counts, health, versions, …).
   * @example
   * const info = await sdk.k8s.clusterInfo({ cluster: 'z-01' });
   */
  clusterInfo({ cluster } = {}) {
    return this.sdk._fetch('/k8s/cluster-info', 'GET', { query: { cluster } });
  }

  /**
   * Autocomplete data for a cluster: namespaces, deployment/statefulset names,
   * and a `containers` map (workload name → container names). Pass `namespace`
   * to scope deployments to one namespace (else returned across all).
   *
   * @param {object} params
   * @param {string} params.cluster     - Kube context.
   * @param {string} [params.namespace] - Limit deployments to one namespace.
   * @returns {Promise<{ deployments: Array<string|{name,namespace}>, namespaces: string[], containers: Record<string,string[]> }>}
   * @example
   * const { namespaces, containers } = await sdk.k8s.autocomplete({ cluster: 'z-01' });
   */
  autocomplete({ cluster, namespace } = {}) {
    return this.sdk._fetch('/k8s/autocomplete', 'GET', { query: { cluster, namespace } });
  }

  // ─── Pods ──────────────────────────────────────────────────────────────

  /**
   * List pods (+ namespaces) for a cluster — the initial snapshot the live
   * pod views hydrate from. Uses the `action=list` mode of the pods route.
   *
   * @param {object} params
   * @param {string} params.cluster     - Kube context (required).
   * @param {string} [params.namespace] - Namespace filter (omit / `__all` for all).
   * @returns {Promise<{ pods: Array<object>, namespaces: string[] }>}
   * @example
   * const { pods } = await sdk.k8s.pods({ cluster: 'z-01', namespace: 'default' });
   */
  pods({ cluster, namespace } = {}) {
    return this.sdk._fetch('/k8s/pods', 'GET', { query: { action: 'list', cluster, namespace } });
  }

  /**
   * Read one pod's detail bundle (spec-derived fields + status). Optional
   * `include` parts: `'yaml'` (raw spec), `'metrics'` (Prometheus series),
   * `'events'` (pod-scoped events).
   *
   * @param {object} params
   * @param {string} params.name             - Pod name (required).
   * @param {string} params.namespace        - Namespace (required).
   * @param {string} params.cluster          - Kube context (required).
   * @param {string[]} [params.include]       - Extra parts: 'yaml' | 'metrics' | 'events'.
   * @param {number} [params.hours=1]        - Metrics history window (with include 'metrics').
   * @returns {Promise<object>} Pod detail (containers, tolerations, podResources, optional raw/metrics/events).
   * @example
   * const pod = await sdk.k8s.pod({ cluster: 'z-01', namespace: 'default', name: 'web-7d', include: ['yaml','events'] });
   */
  pod({ name, namespace, cluster, include, hours } = {}) {
    return this.sdk._fetch('/k8s/pods', 'GET', {
      query: { name, namespace, cluster, include: (include || []).join(',') || undefined, hours },
    });
  }

  /**
   * Delete a pod. `force` does an immediate (grace-period 0) deletion.
   *
   * @param {object} params
   * @param {string} params.name       - Pod name.
   * @param {string} params.namespace  - Namespace.
   * @param {string} params.cluster    - Kube context.
   * @param {boolean} [params.force=false] - Force-delete (no grace period).
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.k8s.deletePod({ cluster: 'z-01', namespace: 'default', name: 'web-7d' });
   */
  deletePod({ name, namespace, cluster, force = false } = {}) {
    return this.sdk._fetch('/k8s/pods', 'DELETE', { body: { name, namespace, cluster, force } });
  }

  /**
   * Live pod CPU/memory usage from metrics-server (polled, not streamed).
   * Returns `{ pods: [] }` (with `unavailable: true`) when metrics-server is
   * absent; HTTP 503 when the per-cluster breaker is open.
   *
   * @param {object} params
   * @param {string} params.cluster     - Kube context.
   * @param {string} [params.namespace='__all'] - Namespace (or `__all`).
   * @returns {Promise<{ pods: Array<{ namespace, name, cpuMillicores, memoryMi, timestamp, window }>, unavailable?: boolean, reason?: string }>}
   * @example
   * const { pods } = await sdk.k8s.podMetrics({ cluster: 'z-01', namespace: 'default' });
   */
  podMetrics({ cluster, namespace } = {}) {
    return this.sdk._fetch('/k8s/pod-metrics', 'GET', { query: { cluster, namespace } });
  }

  // ─── Workloads (deployments / statefulsets) ──────────────────────────────

  /**
   * List workloads (Deployments + StatefulSets) and namespaces for a cluster.
   * Each row carries `kind` and a derived `health` string.
   *
   * @param {object} params
   * @param {string} params.cluster     - Kube context (required).
   * @param {string} [params.namespace] - Namespace filter.
   * @returns {Promise<{ deployments: Array<object>, namespaces: string[] }>}
   * @example
   * const { deployments } = await sdk.k8s.deployments({ cluster: 'z-01' });
   */
  deployments({ cluster, namespace } = {}) {
    return this.sdk._fetch('/k8s/deployments', 'GET', { query: { cluster, namespace } });
  }

  /**
   * Single-workload detail bundle: spec + status + owned pods + recent events
   * (+ optional Prometheus metrics / raw yaml). Works for Deployment and
   * StatefulSet (set `kind`).
   *
   * @param {object} params
   * @param {string} params.namespace        - Namespace (path param, required).
   * @param {string} params.name             - Workload name (path param, required).
   * @param {string} params.cluster          - Kube context (required).
   * @param {string} [params.kind='Deployment'] - 'Deployment' | 'StatefulSet'.
   * @param {string[]} [params.include]       - Extra parts: 'metrics' | 'yaml'.
   * @param {number} [params.hours=1]        - Metrics history window.
   * @returns {Promise<object>} Workload detail (replicas, containers, conditions, hpa, pods, events, optional metrics/raw).
   * @example
   * const w = await sdk.k8s.workload({ cluster: 'z-01', namespace: 'default', name: 'web', kind: 'Deployment' });
   */
  workload({ namespace, name, cluster, kind, include, hours } = {}) {
    const ns = encodeURIComponent(namespace);
    const nm = encodeURIComponent(name);
    return this.sdk._fetch(`/k8s/workloads/${ns}/${nm}`, 'GET', {
      query: { cluster, kind, include: (include || []).join(',') || undefined, hours },
    });
  }

  /**
   * Scale a Deployment to a target replica count.
   *
   * @param {object} params
   * @param {string} params.name       - Deployment name.
   * @param {string} params.namespace  - Namespace.
   * @param {number} params.replicas   - Desired replica count.
   * @param {string} params.cluster    - Kube context.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.k8s.scale({ cluster: 'z-01', namespace: 'default', name: 'web', replicas: 3 });
   */
  scale({ name, namespace, replicas, cluster } = {}) {
    return this.sdk._fetch('/k8s/scale', 'POST', { body: { name, namespace, replicas, cluster } });
  }

  /**
   * Rolling-restart a Deployment or StatefulSet (patches a restart annotation).
   *
   * @param {object} params
   * @param {string} params.name       - Workload name.
   * @param {string} params.namespace  - Namespace.
   * @param {string} params.cluster    - Kube context.
   * @param {string} [params.kind='Deployment'] - 'Deployment' | 'StatefulSet'.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.k8s.restart({ cluster: 'z-01', namespace: 'default', name: 'web' });
   */
  restart({ name, namespace, cluster, kind } = {}) {
    return this.sdk._fetch('/k8s/restart', 'POST', { body: { name, namespace, cluster, kind } });
  }

  /**
   * Update a container's image on a Deployment (triggers a rollout).
   *
   * @param {object} params
   * @param {string} params.name       - Deployment name.
   * @param {string} params.namespace  - Namespace.
   * @param {string} params.container  - Container name within the pod template.
   * @param {string} params.image      - New image reference (repo:tag).
   * @param {string} params.cluster    - Kube context.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.k8s.setImage({ cluster: 'z-01', namespace: 'default', name: 'web', container: 'web', image: 'registry/web:abc123' });
   */
  setImage({ name, namespace, container, image, cluster } = {}) {
    return this.sdk._fetch('/k8s/image', 'POST', { body: { name, namespace, container, image, cluster } });
  }

  // ─── Nodes ───────────────────────────────────────────────────────────────

  /**
   * Node data by action. `action`:
   *   - `'list'`              → `{ nodes, podCounts, prometheusAvailable, pricing }`
   *   - `'detail'`            → `{ node, pods, prometheusAvailable, pricing }` (needs `node`)
   *   - `'metrics'`           → `{ metrics }`
   *   - `'history'`           → `{ history }` (needs `node`, optional `hours`)
   *   - `'prometheus-status'` → `{ available, ... }`
   *
   * @param {object} params
   * @param {string} params.cluster   - Kube context.
   * @param {string} [params.action='list'] - One of the actions above.
   * @param {string} [params.node]    - Node name (required for 'detail' / 'history').
   * @param {number} [params.hours=6] - History window (for 'history').
   * @returns {Promise<object>} Shape depends on `action` (see above).
   * @example
   * const { nodes } = await sdk.k8s.nodes({ cluster: 'z-01', action: 'list' });
   */
  nodes({ cluster, action = 'list', node, hours } = {}) {
    return this.sdk._fetch('/k8s/nodes', 'GET', { query: { cluster, action, node, hours } });
  }

  /**
   * Read kubelet-proxied node logs as plain text. Empty `path` returns the
   * directory listing; a path like `dmesg` or `pods/...` returns file content.
   * Many EKS kubelets disable this (surfaces as an error).
   *
   * @param {object} params
   * @param {string} params.cluster - Kube context (required).
   * @param {string} params.node    - Node name (required).
   * @param {string} [params.path]  - Log path appended to /logs/ (default '').
   * @returns {Promise<string>} Plain-text log content / directory listing.
   * @example
   * const text = await sdk.k8s.nodeLogs({ cluster: 'z-01', node: 'ip-10-0-1-5', path: 'dmesg' });
   */
  nodeLogs({ cluster, node, path } = {}) {
    return this.sdk._fetch('/k8s/nodes/logs', 'GET', { query: { cluster, node, path } });
  }

  /**
   * Synchronous (non-streaming) node lifecycle action. Use this for the JSON
   * actions: `cordon`, `uncordon`, `delete`, `set-taints`, `create-debug-pod`,
   * `delete-debug-pod`, `delete-nodeclaim`, `terminate-instance`.
   * For `drain` / `force-drain` (which stream), use {@link nodeActionStream}.
   *
   * @param {object} params
   * @param {string} params.cluster   - Kube context (required).
   * @param {string} params.name      - Node name (required).
   * @param {string} params.action    - One of the sync actions above.
   * @param {Array}  [params.taints]   - For 'set-taints': taint objects to apply.
   * @param {{namespace?:string,name:string}} [params.debugPod] - For 'delete-debug-pod'.
   * @param {string} [params.providerID] - For 'terminate-instance': the node's providerID.
   * @param {number} [params.gracePeriodSeconds] - For 'delete'/'drain': eviction grace period.
   * @param {boolean} [params.drainBeforeDelete]  - For 'delete': drain the node first.
   * @param {boolean} [params.force]               - For 'delete'/'drain': force past PDBs/standalone pods.
   * @returns {Promise<{ ok: true, message: string, [extra]: * }>} Shape varies by action.
   * @example
   * await sdk.k8s.nodeAction({ cluster: 'z-01', name: 'ip-10-0-1-5', action: 'cordon' });
   */
  nodeAction({ cluster, name, action, taints, debugPod, providerID, gracePeriodSeconds, drainBeforeDelete, force } = {}) {
    return this.sdk._fetch('/k8s/nodes/action', 'POST', {
      body: { cluster, name, action, taints, debugPod, providerID, gracePeriodSeconds, drainBeforeDelete, force },
    });
  }

  /**
   * Streaming node drain. `action` must be `'drain'` or `'force-drain'` — these
   * return an SSE progress stream (run-style `info`/`step`/`success`/`error`
   * events). Set `drainBeforeDelete` to also delete the Node object after a
   * successful drain.
   *
   * @param {object} params
   * @param {string} params.cluster   - Kube context (required).
   * @param {string} params.name      - Node name (required).
   * @param {string} [params.action='drain'] - 'drain' | 'force-drain'.
   * @param {number} [params.gracePeriodSeconds=60] - Eviction grace period.
   * @param {boolean} [params.drainBeforeDelete=false] - Delete the node after draining.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE progress stream.
   * @example
   * const s = sdk.k8s.nodeActionStream({ cluster: 'z-01', name: 'ip-10-0-1-5', action: 'drain' });
   * s.onMessage = (ev) => console.log(ev.type, ev.data);
   */
  nodeActionStream({ cluster, name, action = 'drain', gracePeriodSeconds, drainBeforeDelete } = {}) {
    return this.sdk._stream('/k8s/nodes/action', 'POST', {
      body: { cluster, name, action, gracePeriodSeconds, drainBeforeDelete },
    });
  }

  // ─── Events & live watch ─────────────────────────────────────────────────

  /**
   * List recent K8s events across all namespaces (newest first server-side).
   *
   * @param {object} params
   * @param {string} params.cluster   - Kube context (required).
   * @param {number} [params.limit=500] - Max events to return.
   * @returns {Promise<{ events: Array<object> }>}
   * @example
   * const { events } = await sdk.k8s.events({ cluster: 'z-01', limit: 200 });
   */
  events({ cluster, limit } = {}) {
    return this.sdk._fetch('/k8s/events', 'GET', { query: { cluster, limit } });
  }

  /**
   * Open a live SSE watch on a resource type. Emits typed events:
   *   - `message`     → `{ phase: 'ADDED'|'MODIFIED'|'DELETED', item }`
   *   - `heartbeat`   → `{ ts }` (every 10s — connection liveness)
   *   - `unavailable` → cluster-unhealthy payload (breaker open / watch failed)
   *
   * @param {object} params
   * @param {string} params.resource  - 'pods' | 'nodes' | 'deployments' | 'events' | 'ingresses' (required).
   * @param {string} [params.cluster] - Kube context (defaults server-side).
   * @param {string} [params.namespace] - Namespace (or `__all` / use `allNamespaces`).
   * @param {boolean} [params.allNamespaces=false] - Watch across all namespaces.
   * @returns {ReturnType<import('../stream.js').openStream>} SSE watch stream.
   * @example
   * const s = sdk.k8s.watch({ resource: 'pods', cluster: 'z-01', allNamespaces: true });
   * s.onMessage = (ev) => { if (ev.type === 'message') handle(ev.data.phase, ev.data.item); };
   */
  watch({ resource, cluster, namespace, allNamespaces } = {}) {
    return this.sdk._stream('/k8s/watch', 'GET', {
      query: { resource, cluster, namespace, allNamespaces: allNamespaces ? '1' : undefined },
    });
  }

  // ─── ConfigMaps & Secrets ────────────────────────────────────────────────

  /**
   * Read a ConfigMap's data map.
   *
   * @param {object} params
   * @param {string} params.name      - ConfigMap name (required).
   * @param {string} params.namespace - Namespace (required).
   * @param {string} [params.cluster] - Kube context.
   * @returns {Promise<Record<string,string>>} The ConfigMap's `data` object.
   * @example
   * const data = await sdk.k8s.configMap({ cluster: 'z-01', namespace: 'default', name: 'app-config' });
   */
  configMap({ name, namespace, cluster } = {}) {
    return this.sdk._fetch('/k8s/configmap', 'GET', { query: { name, namespace, cluster } });
  }

  /**
   * Read a (decoded) value from a Secret. Resolve the cluster either by kube
   * context (`clusterName` looked up in the container's v2configs) — pass the
   * v2configs cluster name, not the ARN.
   *
   * @param {object} params
   * @param {string} params.namespace    - Namespace (required).
   * @param {string} params.secretName   - Secret name (required).
   * @param {string} [params.key]        - Specific key (omit for whole secret behavior per route).
   * @param {string} [params.clusterName] - v2configs cluster name to resolve the context from.
   * @param {string} [params.container='app1'] - Container owning the cluster record.
   * @param {string} [params.branch='main']    - v2configs branch.
   * @returns {Promise<{ value: * }>} The decoded secret value.
   * @example
   * const { value } = await sdk.k8s.secret({ clusterName: 'z-01', namespace: 'default', secretName: 'db', key: 'password' });
   */
  secret({ namespace, secretName, key, clusterName, container, branch } = {}) {
    return this.sdk._fetch('/k8s/secret', 'POST', {
      body: { container, clusterName, namespace, secretName, key, branch },
    });
  }

  // ─── Ingress ─────────────────────────────────────────────────────────────

  /**
   * List ingress-related state for a cluster: ingresses, ingress classes,
   * cert-manager certificates/issuers, controllers, services, TLS cert
   * expiries, and a service→endpoint map.
   *
   * @param {object} params
   * @param {string} params.cluster - Kube context (required).
   * @returns {Promise<{ ingresses, ingressClasses, certificates, issuers, controllers, services, certExpiries, endpointMap, certManagerAvailable }>}
   * @example
   * const { ingresses, controllers } = await sdk.k8s.ingresses({ cluster: 'z-01' });
   */
  ingresses({ cluster } = {}) {
    return this.sdk._fetch('/k8s/ingress', 'GET', { query: { cluster, action: 'list' } });
  }

  /**
   * Delete an Ingress.
   *
   * @param {object} params
   * @param {string} params.name      - Ingress name.
   * @param {string} params.namespace - Namespace.
   * @param {string} [params.cluster] - Kube context (defaults to the default cluster server-side).
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.k8s.deleteIngress({ cluster: 'z-01', namespace: 'default', name: 'web' });
   */
  deleteIngress({ name, namespace, cluster } = {}) {
    return this.sdk._fetch('/k8s/ingress', 'DELETE', { body: { name, namespace, cluster } });
  }

  // ─── Metrics ─────────────────────────────────────────────────────────────

  /**
   * Aggregated workspace metrics on a cluster — a Prometheus query filtered to
   * a set of namespaces (the union of a container's environment namespaces).
   *
   * @param {object} params
   * @param {string} params.cluster      - Kube context (required).
   * @param {string[]|string} params.namespaces - Namespaces (array joined with commas; required, non-empty).
   * @param {number} [params.hours=1]    - History window.
   * @returns {Promise<{ metrics: object }>}
   * @example
   * const { metrics } = await sdk.k8s.workspaceMetrics({ cluster: 'z-01', namespaces: ['app-prod','app-stg'] });
   */
  workspaceMetrics({ cluster, namespaces, hours } = {}) {
    const ns = Array.isArray(namespaces) ? namespaces.join(',') : namespaces;
    return this.sdk._fetch('/k8s/workspace-metrics', 'GET', { query: { cluster, ns, hours } });
  }
}
