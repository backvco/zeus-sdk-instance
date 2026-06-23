# sdk.containers

Workload containers (workspaces). A container owns a set of v2configs entities —
services, environments, clusters, whitelabels, infrastructure add-ons. `app1` is
the default. Most other namespaces take a `container` argument.

| Method | HTTP | Description |
|---|---|---|
| `config()` | GET `/api/v2configs/config` | Workspace root DNS domain + zone → `{ rootDomain, rootDomainZoneId }` |
| `list()` | GET `/api/v2configs/containers` | All containers with entity counts → `{ containers: [{ name, createdAt, counts }] }` |
| `create({ name, cloneFrom? })` | POST `/api/v2configs/containers` | Create (optionally seed from another) → `{ name, cloned }` |
| `delete({ name })` | DELETE `/api/v2configs/containers/:name` | Delete an empty container → `{ success }` (409 if non-empty) |
| `workspaces()` | GET `/api/dashboard/workspaces` | Landing-page summaries → `{ workspaces }` |
| `settings({ container })` | GET `/api/v2configs/:c/settings` | Build/npm defaults → `{ settings }` |
| `updateSettings({ container, settings })` | PUT `/api/v2configs/:c/settings` | Merge partial settings → `{ settings }` |
| `workspaceClusters({ container, branch? })` | GET `/api/v2configs/:c/workspace-clusters` | Owned + linked clusters → `{ clusters }` |
| `namespaces({ container, branch? })` | GET `/api/v2configs/:c/namespaces` | Known k8s namespaces → `{ namespaces }` |
| `clusterLinks({ container, branch? })` | GET `/api/v2configs/:c/cluster-links` | Links + linkable clusters → `{ links, available }` |
| `createClusterLink({ container, name, branch? })` | POST `/api/v2configs/:c/cluster-links` | Link a cluster from another container → `{ links }` |
| `deleteClusterLink({ container, name, branch? })` | DELETE `/api/v2configs/:c/cluster-links` | Remove a link → `{ links }` |

```js
const { containers } = await sdk.containers.list();
const { settings } = await sdk.containers.settings({ container: 'app1' });
await sdk.containers.updateSettings({ container: 'app1', settings: { npmTokenIds: ['tok_1'] } });
```
