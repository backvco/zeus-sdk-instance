# sdk.system

Instance-wide utility endpoints — small, mostly read-only helpers that don't
belong to a single resource.

| Method | HTTP | Description |
|---|---|---|
| `egressIp()` | GET `/api/system/egress-ip` | Zeus's outbound public IP (for cloud allow-lists) → `{ ip, cached? }` |
| `whoami()` | GET `/api/whoami` | The caller's public IP → `{ ip }` |
| `tools()` | GET `/api/system/tools` | Managed CLI tool status (helm) → `{ helm: { installed, version?, path? } }` |
| `installTool({ tool })` | POST `/api/system/tools` | Install/refresh a tool (e.g. `'helm'`) → `{ ok, helm? }` |
| `pricing({ types })` | GET `/api/pricing` | On-demand hourly price per instance/machine type → `{ prices: { [type]: number\|null } }` |
| `sgPresets()` | GET `/api/sg-presets` | Built-in security-group rule presets → `{ presets }` |
| `geocode({ query })` | POST `/api/geo/geocode` | Geocode a place query (connectivity geo map) |
| `browseFilesystem({ path? })` | GET `/api/filesystem/browse` | Host directory listing for path pickers → `{ path, parent, entries }` |
| `dashboardWorkspaces()` | GET `/api/dashboard/workspaces` | Landing-page container summaries → `{ workspaces }` |

```js
const { ip } = await sdk.system.egressIp();
const { prices } = await sdk.system.pricing({ types: ['m5.large', 't3.medium'] });
```
