# `sdk.networkPlans` — NetworkPlansService

Fleet-wide CIDR **allocation plans**. A plan carves a large umbrella CIDR into
deterministic per-cluster **slots** (each a pod CIDR + service CIDR). Allocating a
slot reserves non-overlapping space; a slot can be materialized into a VPC bundle.
Backed by `/api/network/**`.

Methods throw `ZeusApiError` on HTTP 4xx/5xx.

Lifecycle: `create` → `slots` (preview next free, account-aware) →
`allocateSlot` → `vpcFromSlot` → `validate` (fleet overlap check).

## Plans

### `list()`
All plans. **`GET /api/network/plans`**
- Returns: `{ plans }`

### `create({ name })`
New empty plan (lowercase/digits/dashes). **`POST /api/network/plans`**
- Returns: `{ plan }` (201; 409 if exists)

### `get({ name })`
Read a plan. **`GET /api/network/plans/[name]`**
- Returns: `{ plan }` (404 if missing)

### `update({ name, fields })`
Patch metadata only (`v6Deployed`, `reservedForbidden`, `edgeReservations`, `mediaPools`). **`PATCH /api/network/plans/[name]`**
- Returns: `{ plan }` (409 on lock)
```js
await sdk.networkPlans.update({ name: 'fleet', fields: { v6Deployed: true } });
```

### `delete({ name, confirm })`
Delete a plan (no allocated slots; `confirm` must equal the name). **`DELETE /api/network/plans/[name]`**
- Returns: `{ deleted: true }`

## Slots

### `slots({ name, accountId?, region?, provider? })`
List slots + preview the next free slot (account-aware skips live-VPC collisions). **`GET /api/network/plans/[name]/slots`**
- Returns: `{ slots, next, skipped, liveCidrsUnavailable }`
```js
const { next } = await sdk.networkPlans.slots({ name: 'fleet', accountId: 'acme', region: 'us-east-2' });
```

### `allocateSlot({ name, label, container?, cluster?, accountId?, region?, provider?, force?, slot? })`
Allocate the next (or pinned `slot`) slot; skips live-VPC collisions when account-scoped. **`POST /api/network/plans/[name]/slots`**
- Returns: `{ slot, skipped, liveCidrsUnavailable }` (201; 409 on lock or unverifiable)
```js
const { slot } = await sdk.networkPlans.allocateSlot({ name: 'fleet', label: 'z-03', accountId: 'acme', region: 'us-east-2' });
```

### `getSlot({ name, slot })`
Read one slot. **`GET /api/network/plans/[name]/slots/[slot]`**
- Returns: `{ slot }` (404 if missing)

### `updateSlot({ name, slot, fields })`
Patch `label`/`notes` only. **`PATCH /api/network/plans/[name]/slots/[slot]`**
- Returns: `{ slot }` (409 on lock)

### `deleteSlot({ name, slot, confirm })`
Delete an unallocated, unlocked slot; `confirm` must equal `"<plan>:<slot>"`. **`DELETE /api/network/plans/[name]/slots/[slot]`**
- Returns: `{ deleted: true }`
```js
await sdk.networkPlans.deleteSlot({ name: 'fleet', slot: 3, confirm: 'fleet:3' });
```

## Validation + materialization

### `validate()`
Fleet-wide overlap check across plans/bundles/clusters. **`POST /api/network/plans/validate`**
- Returns: `{ ok, conflicts }`

### `vpcFromSlot({ plan, slot, region, azCount?, natMode?, tiers?, accountId?, preview?, provider?, project?, natEnabled?, natIpMode?, name?, branch? })`
Materialize a VPC bundle from a slot. AWS default, or `provider:'gcp'` (needs `project`). `preview:true` returns without persisting. **`POST /api/network/vpcs/from-slot`** (`branch` via query)
- Returns: `{ bundle, subnetPreview? }` (AWS) / `{ bundle, preview? }` (GCP); 201 persisted, 200 preview, 409 if exists
```js
const { bundle } = await sdk.networkPlans.vpcFromSlot({ plan: 'fleet', slot: 0, region: 'us-east-2' });
```
