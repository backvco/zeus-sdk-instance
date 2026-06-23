# `sdk.registries` — image-registry configs & pull secrets

`RegistriesService` covers workspace-level container-image registry push
configurations and encrypted per-cluster pull secrets. Every method returns the
route's literal JSON body (no unwrapping) and throws on HTTP 4xx/5xx. All methods
are container-scoped (`{ container, ... }`).

1. **Registries** — named push-credential entries at
   `data/containers/<name>/registries.json`. Exactly one is the default (the first
   created becomes default automatically).
2. **Pull secrets** — encrypted secrets keyed by `"envName/clusterName"`; the raw
   secret is never returned (list reports only `{ hasSecret }`).

```js
const { registries } = await sdk.registries.list({ container: 'app1' });
await sdk.registries.setPullSecret({ container: 'app1', envName: 'prod', clusterName: 'z-01', secret: '...' });
```

---

## Registries

| Method | Route | Notes |
|--------|-------|-------|
| `list({ container })` | GET `/v2configs/[container]/registries` | → `{ registries: [{ id, name, type, cluster, project, robot, robotId, host, isDefault, createdAt, hasSecret }] }` |
| `create({ container, name, type, cluster, project, robot?, robotId?, host?, isDefault? })` | POST `/v2configs/[container]/registries` | → the created entry (HTTP 201). `name`/`type`/`cluster`/`project` required; first entry auto-defaults |
| `update({ container, id, patch })` | PUT `/v2configs/[container]/registries/[id]` | → updated entry (shallow merge). `patch.isDefault:true` clears others; 404 if missing |
| `delete({ container, id })` | DELETE `/v2configs/[container]/registries/[id]` | → `{ ok: true }`. Promotes first remaining entry if the default was removed; 404 if missing |
| `setEnvProjects({ container, id, projects, branch? })` | PUT `/v2configs/[container]/registries/[id]/env-projects` | → `{ ok: true, projects }`. `projects` = envName → project map; `''` clears an override |

```js
await sdk.registries.create({ container: 'app1', name: 'prod', type: 'harbor', cluster: 'z-01', project: 'app1' });
await sdk.registries.update({ container: 'app1', id: 'reg_123', patch: { isDefault: true } });
await sdk.registries.setEnvProjects({ container: 'app1', id: 'reg_123', projects: { prod: 'app1-prod', dev: '' } });
```

## Pull secrets

| Method | Route | Notes |
|--------|-------|-------|
| `listPullSecrets({ container, env? })` | GET `/v2configs/[container]/registry-pull-secrets` | → `{ "envName/clusterName": { hasSecret } }`. `env` filters to one environment |
| `setPullSecret({ container, envName, clusterName, secret? })` | POST `/v2configs/[container]/registry-pull-secrets` | → `{ ok: true, hasSecret }`. Empty/omitted `secret` clears it; value encrypted at rest |

```js
const secrets = await sdk.registries.listPullSecrets({ container: 'app1', env: 'prod' });
await sdk.registries.setPullSecret({ container: 'app1', envName: 'prod', clusterName: 'z-01', secret: '' }); // clear
```
