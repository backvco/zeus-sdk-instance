# `sdk.amiRecipes` — AmiRecipesService

Machine-image (AMI) recipes, builds, distribution, and live-image management.

A **recipe** is a named, versioned definition of how to bake a custom EC2 AMI
(base image + source ref + per-region distribution). Lifecycle: create/save a
recipe → `plan` then `startBuild` (SSE) → watch/`cancelBuild` → `distribute`
(SSE) to other accounts → `attach` to a node group → manage live images with
`cloudImages`. The builder instance profile is provisioned with `builderProfile`.

Streaming methods (`startBuild`, `distribute`, `streamBuild`) return an SSE
stream handle: async-iterable plus `onOpen/onMessage/onError/onDone` callbacks
and `close()`. They emit progress events (`info` / `heartbeat` / `error` / `done`).

| Method | Route | Notes |
|--------|-------|-------|
| `list()` | `GET /api/ami-recipes` | enriched list |
| `create({ name, cloneFrom? })` | `POST /api/ami-recipes` | |
| `get({ name, bundle? })` | `GET /api/ami-recipes/:name` | `bundle:true` → `?bundle=1` editable bundle |
| `save({ name, recipe })` | `PUT /api/ami-recipes/:name` | `recipe` object is the body |
| `delete({ name })` | `DELETE /api/ami-recipes/:name` | 409 if builds/targets exist |
| `attach({ name, container, buildId, clusterName, ngName, region, branch? })` | `POST /api/ami-recipes/:name/attach` | |
| `builds({ name })` | `GET /api/ami-recipes/:name/builds` | |
| `startBuild({ name, sourceRegion, ... })` | `POST /api/ami-recipes/:name/builds` | **SSE** |
| `getBuild({ name, buildId })` | `GET /api/ami-recipes/:name/builds/:id` | |
| `cancelBuild({ name, buildId })` | `POST /api/ami-recipes/:name/builds/:id/cancel` | |
| `distribute({ name, buildId, targets })` | `POST /api/ami-recipes/:name/builds/:id/distribute` | **SSE** |
| `streamBuild({ name, buildId })` | `GET /api/ami-recipes/:name/builds/:id/stream` | **SSE** (live or replay log) |
| `cloudImages({ name, accountId? })` | `GET /api/ami-recipes/:name/cloud-images` | |
| `cloudImageAction({ name, action, ... })` | `POST /api/ami-recipes/:name/cloud-images` | action-routed |
| `plan({ name, input? })` | `POST /api/ami-recipes/:name/plan` | |
| `builderProfile({ accountId?, action? })` | `POST /api/ami-recipes/builder-profile` | `check`/`ensure` |

---

## Methods

### `list()`
List all recipes, each enriched with latest build, accounts (+regions) holding
AMIs, and node-group `targetCount`.
Response: `{ recipes: [{ name, displayName?, description?, arch?, type?, _system?, provider?, baseAmi?, source?, latestBuild, accounts, targetCount, error? }] }`
```js
const { recipes } = await sdk.amiRecipes.list();
```

### `create({ name, cloneFrom? })`
Create a recipe, optionally cloning another.
Response: `{ created }`
```js
await sdk.amiRecipes.create({ name: 'my-base', cloneFrom: 'rtpengine' });
```

### `get({ name, bundle? })`
Get a recipe with README, recent builds (AMI-exists annotated), and node-group
targets. `bundle:true` returns the editable bundle (`?bundle=1`) instead.
Response: `{ recipe, readme, builds, targets }` — or the bundle object when `bundle:true`.
```js
const { recipe, builds } = await sdk.amiRecipes.get({ name: 'rtpengine' });
```

### `save({ name, recipe })`
Create-or-update a recipe definition (`recipe` is sent as the body). System
recipes are read-only.
Response: `{ saved }`
```js
await sdk.amiRecipes.save({ name: 'my-base', recipe: { description: 'x', arch: 'arm64' } });
```

### `delete({ name })`
Delete a recipe. 409 if it has build records on disk or referencing node groups.
Response: delete result (e.g. `{ deleted: true }`).
```js
await sdk.amiRecipes.delete({ name: 'my-base' });
```

### `attach({ name, container, buildId, clusterName, ngName, region, branch? })`
Attach a built AMI (`success`/`partial` only) to a cluster node group; the server
picks the AMI in the cluster's account. Run the apply pipeline afterward.
Response: `{ attached, note }`
```js
await sdk.amiRecipes.attach({ name: 'rtpengine', container: 'app1', buildId, clusterName: 'z-01', ngName: 'rtp', region: 'us-east-2' });
```

### `builds({ name })`
List recent build records (AMI-exists annotated).
Response: `{ builds }`
```js
const { builds } = await sdk.amiRecipes.builds({ name: 'rtpengine' });
```

### `startBuild({ name, sourceRegion, sourceRef?, copyToRegions?, subnetId?, securityGroupIds?, accountId?, targetAccountIds? })` — SSE
Start a build. `sourceRegion` required. `accountId` (single) or `targetAccountIds`
(fan-out) select the account(s); both omitted → default account. 409 if the
computed buildId is already in flight.
Returns: SSE stream handle.
```js
const stream = sdk.amiRecipes.startBuild({ name: 'rtpengine', sourceRegion: 'us-east-2' });
for await (const ev of stream) console.log(ev.type, ev.message);
```

### `getBuild({ name, buildId })`
Get a single build record. Response: `{ build }`
```js
const { build } = await sdk.amiRecipes.getBuild({ name: 'rtpengine', buildId });
```

### `cancelBuild({ name, buildId })`
Request cancellation of an in-flight build. Response: `{ cancelled }`
```js
await sdk.amiRecipes.cancelBuild({ name: 'rtpengine', buildId });
```

### `distribute({ name, buildId, targets })` — SSE
COPY a finished AMI to other accounts. `targets: [{ accountId, regions? }]`
(omit `regions` to copy every region the source AMI exists in). 409 if a
distribute run is already in flight for this build.
Returns: SSE stream handle.
```js
const stream = sdk.amiRecipes.distribute({ name: 'rtpengine', buildId, targets: [{ accountId: '111122223333' }] });
stream.onMessage((ev) => console.log(ev));
```

### `streamBuild({ name, buildId })` — SSE
Reattach to an in-flight build (live + buffered) or replay a completed build's
JSONL log. 404 if neither exists.
Returns: SSE stream handle.
```js
const stream = sdk.amiRecipes.streamBuild({ name: 'rtpengine', buildId });
for await (const ev of stream) console.log(ev);
```

### `cloudImages({ name, accountId? })`
List live AMIs for a recipe in an account (region-aware) + retention policy.
Response: `{ regions, images, keepVersions, autoMakeCurrent }`
```js
const { images } = await sdk.amiRecipes.cloudImages({ name: 'rtpengine' });
```

### `cloudImageAction({ name, action, accountId?, region?, image?, force?, autoMakeCurrent?, keepVersions? })`
Action-routed live-image management.
`action`: `makeCurrent` | `useLatest` | `delete` | `protect` | `unprotect` | `setPolicy`.
`region` required for all but `setPolicy`; `image` required for
makeCurrent/delete/protect/unprotect; `force` for `delete`;
`autoMakeCurrent`/`keepVersions` for `setPolicy`.
Response: `{ ok, regions, images, keepVersions, autoMakeCurrent }`
```js
await sdk.amiRecipes.cloudImageAction({ name: 'rtpengine', action: 'makeCurrent', region: 'us-east-2', image: 'ami-0abc' });
await sdk.amiRecipes.cloudImageAction({ name: 'rtpengine', action: 'setPolicy', keepVersions: 3, autoMakeCurrent: true });
```

### `plan({ name, input? })`
Preview a build (resolves inputs/region/AMI selection; bakes nothing). `input`
is forwarded as the body. Response: `{ plan }`
```js
const { plan } = await sdk.amiRecipes.plan({ name: 'rtpengine', input: { sourceRegion: 'us-east-2' } });
```

### `builderProfile({ accountId?, action? })`
Check or provision the AMI-builder EC2 instance profile in an account.
`action`: `check` (default, → `{ exists, hasRole }`) | `ensure` (idempotent create, → `{ steps, ... }`).
Response: `{ ok, action, result }`
```js
await sdk.amiRecipes.builderProfile({ accountId: '111122223333', action: 'ensure' });
```
