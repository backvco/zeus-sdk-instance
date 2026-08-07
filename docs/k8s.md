# `sdk.k8s` — K8sService

Live Kubernetes operations against a managed cluster. Every method targets a
single cluster by its kube **context** (the cluster name / `clusterArn`), passed
as `cluster`. The underlying cluster-API gateway routes to EKS/GKE directly or to
k3s/bare-metal over the agent tunnel — the SDK surface is identical regardless of
provider.

Methods throw `ZeusApiError` on HTTP 4xx/5xx — you don't handle errors yourself.

**Streaming methods** (`watch`, `nodeActionStream`, and everything under
`sdk.k8s.logs`) return an SSE stream handle from `openStream`: it is
async-iterable (`for await (const ev of s)`) and exposes assignable
`onOpen/onMessage/onError/onDone` callbacks plus `close()`. Each event is
`{ type, data, raw }`.

Sub-namespaces:
- [`sdk.k8s.logs`](#sdkk8slogs--k8slogsservice) — pod logs (tail / stream / multi)
- [`sdk.k8s.flags`](#sdkk8sflags--k8sflagsservice) — event flags

## Cluster overview

### `clusterInfo({ cluster })`
Dashboard cluster summary (counts, health, versions); also triggers server-side
pod-health alert detection. **`GET /api/k8s/cluster-info`**
- Returns: cluster info bundle (object)
```js
const info = await sdk.k8s.clusterInfo({ cluster: 'z-01' });
```

### `autocomplete({ cluster, namespace? })`
Namespaces, deployment/statefulset names, and a `containers` map. **`GET /api/k8s/autocomplete`**
- Returns: `{ deployments: Array<string|{name,namespace}>, namespaces: string[], containers: Record<string,string[]> }`
```js
const { namespaces } = await sdk.k8s.autocomplete({ cluster: 'z-01' });
```

## Pods

### `pods({ cluster, namespace? })`
Pod list snapshot (+ namespaces). **`GET /api/k8s/pods?action=list`**
- Returns: `{ pods: object[], namespaces: string[] }`
```js
const { pods } = await sdk.k8s.pods({ cluster: 'z-01', namespace: 'default' });
```

### `pod({ name, namespace, cluster, include?, hours? })`
One pod's detail bundle. `include`: `'yaml'`, `'metrics'`, `'events'`. **`GET /api/k8s/pods`**
- Returns: pod detail object (containers, tolerations, podResources, optional raw/metrics/events)
```js
const p = await sdk.k8s.pod({ cluster: 'z-01', namespace: 'default', name: 'web-7d', include: ['yaml'] });
```

### `deletePod({ name, namespace, cluster, force?, gracePeriodSeconds? })`
Delete a pod. `force` skips the normal graceful-shutdown wait, deleting after
`gracePeriodSeconds` (default `0` = immediate) instead. **`DELETE /api/k8s/pods`**
- Returns: `{ ok: true }`
```js
await sdk.k8s.deletePod({ cluster: 'z-01', namespace: 'default', name: 'web-7d' });
await sdk.k8s.deletePod({ cluster: 'z-02', namespace: 'd00', name: 'stuck-pod', force: true });
```

### `podMetrics({ cluster, namespace? })`
Live CPU/mem from metrics-server (polled). Returns `unavailable:true` when
metrics-server is missing; HTTP 503 when the cluster breaker is open. **`GET /api/k8s/pod-metrics`**
- Returns: `{ pods: Array<{ namespace, name, cpuMillicores, memoryMi, timestamp, window }>, unavailable?, reason? }`
```js
const { pods } = await sdk.k8s.podMetrics({ cluster: 'z-01', namespace: 'default' });
```

## Workloads (Deployments / StatefulSets)

### `deployments({ cluster, namespace? })`
List Deployments + StatefulSets (+ namespaces), each with `kind` + `health`. **`GET /api/k8s/deployments`**
- Returns: `{ deployments: object[], namespaces: string[] }`
```js
const { deployments } = await sdk.k8s.deployments({ cluster: 'z-01' });
```

### `workload({ namespace, name, cluster, kind?, include?, hours? })`
Single-workload detail (spec + status + owned pods + events, optional metrics/yaml).
`kind` = `'Deployment'` (default) | `'StatefulSet'`. **`GET /api/k8s/workloads/{namespace}/{name}`**
- Returns: workload detail object (replicas, containers, conditions, hpa, pods, events, optional metrics/raw)
```js
const w = await sdk.k8s.workload({ cluster: 'z-01', namespace: 'default', name: 'web' });
```

### `scale({ name, namespace, replicas, cluster })`
Scale a Deployment. **`POST /api/k8s/scale`**
- Returns: `{ ok: true }`
```js
await sdk.k8s.scale({ cluster: 'z-01', namespace: 'default', name: 'web', replicas: 3 });
```

### `restart({ name, namespace, cluster, kind? })`
Rolling-restart a Deployment/StatefulSet. **`POST /api/k8s/restart`**
- Returns: `{ ok: true }`
```js
await sdk.k8s.restart({ cluster: 'z-01', namespace: 'default', name: 'web' });
```

### `setImage({ name, namespace, container, image, cluster })`
Update a container's image on a Deployment. **`POST /api/k8s/image`**
- Returns: `{ ok: true }`
```js
await sdk.k8s.setImage({ cluster: 'z-01', namespace: 'default', name: 'web', container: 'web', image: 'registry/web:abc123' });
```

## Nodes

### `nodes({ cluster, action?, node?, hours? })`
Node data by `action`: `'list'` (default), `'detail'` (needs `node`), `'metrics'`,
`'history'` (needs `node`, optional `hours`), `'prometheus-status'`. **`GET /api/k8s/nodes`**
- Returns (list): `{ nodes, podCounts, prometheusAvailable, pricing }`
- Returns (detail): `{ node, pods, prometheusAvailable, pricing }`
- Returns (metrics): `{ metrics }` · (history): `{ history }` · (prometheus-status): `{ available, ... }`
```js
const { nodes } = await sdk.k8s.nodes({ cluster: 'z-01', action: 'list' });
```

### `nodeLogs({ cluster, node, path? })`
Kubelet-proxied node logs as **plain text** (directory listing if `path` empty).
Often disabled on EKS. **`GET /api/k8s/nodes/logs`**
- Returns: string
```js
const text = await sdk.k8s.nodeLogs({ cluster: 'z-01', node: 'ip-10-0-1-5', path: 'dmesg' });
```

### `nodeAction({ cluster, name, action, taints?, debugPod?, providerID? })`
Synchronous (JSON) node action: `cordon`, `uncordon`, `delete`, `set-taints`,
`create-debug-pod`, `delete-debug-pod`, `delete-nodeclaim`, `terminate-instance`.
For `drain`/`force-drain` use `nodeActionStream`. **`POST /api/k8s/nodes/action`**
- Returns: `{ ok: true, message, ...extra }` (shape varies by action)
```js
await sdk.k8s.nodeAction({ cluster: 'z-01', name: 'ip-10-0-1-5', action: 'cordon' });
```

### `nodeActionStream({ cluster, name, action?, gracePeriodSeconds?, drainBeforeDelete? })` — streaming
`action` = `'drain'` (default) | `'force-drain'`. Returns an SSE progress stream
(run-style `info`/`step`/`success`/`error` events). **`POST /api/k8s/nodes/action`**
- Returns: SSE stream handle
```js
const s = sdk.k8s.nodeActionStream({ cluster: 'z-01', name: 'ip-10-0-1-5', action: 'drain' });
s.onMessage = (ev) => console.log(ev.type, ev.data);
```

## Events & live watch

### `events({ cluster, limit? })`
Recent events across all namespaces, newest-first. **`GET /api/k8s/events`**
- Returns: `{ events: object[] }`
```js
const { events } = await sdk.k8s.events({ cluster: 'z-01', limit: 200 });
```

### `watch({ resource, cluster?, namespace?, allNamespaces? })` — streaming
Live SSE watch. `resource` = `pods` | `nodes` | `deployments` | `events` | `ingresses`.
Event types: `message` (`{ phase, item }`), `heartbeat` (`{ ts }`), `unavailable`
(breaker open / watch failed). **`GET /api/k8s/watch`**
- Returns: SSE stream handle
```js
const s = sdk.k8s.watch({ resource: 'pods', cluster: 'z-01', allNamespaces: true });
s.onMessage = (ev) => { if (ev.type === 'message') handle(ev.data.phase, ev.data.item); };
```

## ConfigMaps & Secrets

### `configMap({ name, namespace, cluster? })`
Read a ConfigMap's data map. **`GET /api/k8s/configmap`**
- Returns: `Record<string,string>` (the `data` object)
```js
const data = await sdk.k8s.configMap({ cluster: 'z-01', namespace: 'default', name: 'app-config' });
```

### `secret({ namespace, secretName, key?, clusterName?, container?, branch? })`
Read a decoded Secret value. Resolve the context via `clusterName` (a v2configs
cluster name, looked up in `container`/`branch`). **`POST /api/k8s/secret`**
- Returns: `{ value }`
```js
const { value } = await sdk.k8s.secret({ clusterName: 'z-01', namespace: 'default', secretName: 'db', key: 'password' });
```

## Ingress

### `ingresses({ cluster })`
All ingress-related state for a cluster. **`GET /api/k8s/ingress?action=list`**
- Returns: `{ ingresses, ingressClasses, certificates, issuers, controllers, services, certExpiries, endpointMap, certManagerAvailable }`
```js
const { ingresses, controllers } = await sdk.k8s.ingresses({ cluster: 'z-01' });
```

### `deleteIngress({ name, namespace, cluster? })`
Delete an Ingress. **`DELETE /api/k8s/ingress`**
- Returns: `{ ok: true }`
```js
await sdk.k8s.deleteIngress({ cluster: 'z-01', namespace: 'default', name: 'web' });
```

## Metrics

### `workspaceMetrics({ cluster, namespaces, hours? })`
Aggregated Prometheus metrics across a set of namespaces (`namespaces` may be an
array or comma string; must be non-empty). **`GET /api/k8s/workspace-metrics`**
- Returns: `{ metrics: object }`
```js
const { metrics } = await sdk.k8s.workspaceMetrics({ cluster: 'z-01', namespaces: ['app-prod','app-stg'] });
```

---

# `sdk.k8s.logs` — K8sLogsService

Pod log access. `tail` is one-shot JSON; `stream` and `multi` are SSE.

### `tail({ name, namespace?, cluster?, container?, tailLines? })`
Last `tailLines` (default 200) lines, no follow. **`GET /api/k8s/logs`**
- Returns: `{ logs: string }`
```js
const { logs } = await sdk.k8s.logs.tail({ cluster: 'z-01', namespace: 'default', name: 'web-7d' });
```

### `stream({ name, namespace?, cluster?, container?, tailLines?, previous? })` — streaming
Follow one pod/container live. Each event's `data` is a single log line (string);
errors arrive as `[error] <message>`. `previous` reads the crashed container's logs.
**`GET /api/k8s/logs/stream`**
- Returns: SSE stream handle
```js
const s = sdk.k8s.logs.stream({ cluster: 'z-01', namespace: 'default', name: 'web-7d' });
s.onMessage = (ev) => console.log(ev.data);
```

### `multi({ pods, namespace?, cluster?, tailLines? })` — streaming
Multiplex several pods into one feed. `pods` is an array (or comma string); pin a
container with `pod/container` syntax. Each event's `data` is `{ pod, container, line }`.
**`GET /api/k8s/logs/multi`**
- Returns: SSE stream handle
```js
const s = sdk.k8s.logs.multi({ cluster: 'z-01', namespace: 'default', pods: ['web/web', 'web/sidecar'] });
s.onMessage = (ev) => { const { pod, line } = ev.data; console.log(`[${pod}] ${line}`); };
```

---

# `sdk.k8s.flags` — K8sFlagsService

Event flags — operator triage markers persisted on Kubernetes events.

### `list({ status?, cluster?, container? })`
List flags newest-first. `status` = `'open'` | `'resolved'` | `'all'` (default). **`GET /api/k8s/event-flags`**
- Returns: `{ flags: object[] }`
```js
const { flags } = await sdk.k8s.flags.list({ status: 'open', cluster: 'z-01' });
```

### `create({ event, cluster, container?, note? })`
Flag an event. **`POST /api/k8s/event-flags`**
- Returns: `{ flag }`
```js
await sdk.k8s.flags.create({ event, cluster: 'z-01', note: 'OOMKills' });
```

### `get({ id })`
Fetch one flag. **`GET /api/k8s/event-flags/{id}`**
- Returns: `{ flag }`
```js
const { flag } = await sdk.k8s.flags.get({ id: 'flg_123' });
```

### `update({ id, action?, resolutionNote? })`
Resolve or reopen. `action` = `'resolve'` (default) | `'reopen'`. **`PATCH /api/k8s/event-flags/{id}`**
- Returns: `{ flag }`
```js
await sdk.k8s.flags.update({ id: 'flg_123', action: 'resolve', resolutionNote: 'transient' });
```

### `delete({ id })`
Delete a flag. **`DELETE /api/k8s/event-flags/{id}`**
- Returns: `{ ok: true }`
```js
await sdk.k8s.flags.delete({ id: 'flg_123' });
```
