# `sdk.networkBundles` — NetworkBundlesService

Managed **VPC bundles** (`data/vpcs/<name>.json`) — the desired state of one VPC
plus its subnets, NAT gateways, internet gateway, and route tables, managed as a
unit and tagged `zeus:managed-by=zeus`. Backed by `/api/v2configs/vpcs/**`. Every
method takes an optional `branch` (default `'main'`, sent as `?branch=`).

Methods throw `ZeusApiError` on HTTP 4xx/5xx. `apply` and `destroy` (POST) return
an SSE stream handle from `openStream` (async-iterable +
`onOpen/onMessage/onError/onDone` + `close()`); events are run progress
`{ type, data, raw }`.

Lifecycle: `create` → `plan` → `apply` (SSE) → `live`/`drift` → edit
subnets/NATs/route-tables → `destroy` (SSE).

## Collection

### `list({ branch? })`
All bundles (raw JSON). **`GET /api/v2configs/vpcs`**
- Returns: `{ vpcs }`
```js
const { vpcs } = await sdk.networkBundles.list();
```

### `create({ name, region, cidr, azCount, natMode, dnsHostnames?, dnsSupport?, extraTags?, accountId?, branch? })`
Create desired state (no AWS calls). **`POST /api/v2configs/vpcs`**
- Returns: `{ vpc }` (201; 409 if name exists)
```js
await sdk.networkBundles.create({ name: 'mesh-a', region: 'us-east-2', cidr: '10.20.0.0/16', azCount: 3, natMode: 'single' });
```

### `drift({ branch? })`
Aggregate drift across all bundles. **`GET /api/v2configs/vpcs/drift`**
- Returns: `{ bundles, summary }`
```js
const { summary } = await sdk.networkBundles.drift();
```

## Single bundle

### `get({ name, branch? })`
Read one bundle. **`GET /api/v2configs/vpcs/[name]`**
- Returns: `{ vpc }` (404 if missing)

### `update({ name, fields, branch? })`
Patch mutable fields (cidr/azCount/natMode/region immutable → 400). **`PATCH /api/v2configs/vpcs/[name]`**
- Returns: `{ vpc }`
```js
await sdk.networkBundles.update({ name: 'mesh-a', fields: { extraTags: { team: 'core' } } });
```

### `delete({ name, force?, branch? })`
Delete the JSON (409 with a live VPC unless `force` → `?force=1`; does NOT tear down AWS). **`DELETE /api/v2configs/vpcs/[name]`**
- Returns: `{ ok, alreadyMissing? }`

### `plan({ name, withDiff?, branch? })`
Render the desired-state plan; optional live diff (`?withDiff=1`). **`GET /api/v2configs/vpcs/[name]/plan`**
- Returns: `{ plan, diff?, diffError? }`
```js
const { plan, diff } = await sdk.networkBundles.plan({ name: 'mesh-a', withDiff: true });
```

### `live({ name, branch? })`
Live AWS state. **`GET /api/v2configs/vpcs/[name]/live`**
- Returns: `{ vpc, subnets, nats, igws, routeTables }` (404 if not applied)

## Apply / destroy (SSE)

### `apply({ name, branch? })` — streaming
Provision the bundle; persists final `status`. **`POST /api/v2configs/vpcs/[name]/apply`**
- Returns: SSE stream handle (409 if already running)
```js
const s = sdk.networkBundles.apply({ name: 'mesh-a' });
s.onMessage = (ev) => console.log(ev.data);
```

### `destroyPreview({ name, region?, accountId?, branch? })`
Destroy preview (blockers/warnings/deletable). **`GET /api/v2configs/vpcs/[name]/destroy`**
- Returns: `{ preview }`

### `destroy({ name, confirm, force?, region?, accountId?, branch? })` — streaming
Tear down live resources. Requires `confirm === "CONFIRM-DESTROY <name>"`. **`POST /api/v2configs/vpcs/[name]/destroy`**
- Returns: SSE stream handle
```js
const s = sdk.networkBundles.destroy({ name: 'mesh-a', confirm: 'CONFIRM-DESTROY mesh-a' });
```

## Subnets

### `createSubnet({ name, az, cidr, tier, branch? })`
Create a subnet (`tier`=`public`|`private`). **`POST /api/v2configs/vpcs/[name]/subnets`**
- Returns: `{ subnet }` (201)

### `deleteSubnet({ name, subnetId, branch? })`
Delete a subnet. **`DELETE /api/v2configs/vpcs/[name]/subnets/[subnetId]`**
- Returns: `{ ok }`

## NAT gateways

### `createNat({ name, subnetId, branch? })`
Create a NAT GW in a public subnet (allocates EIP, waits available). **`POST /api/v2configs/vpcs/[name]/nats`**
- Returns: `{ nat }` (201)

### `deleteNat({ name, natId, branch? })`
Delete a NAT GW + release EIP. **`DELETE /api/v2configs/vpcs/[name]/nats/[natId]`**
- Returns: `{ ok, eipReleased }`

## Route tables

### `createRouteTable({ name, resourceName?, tier?, az?, defaultRoute?, branch? })`
Create a route table (optional default route `{ igwId? | natGatewayId? }`). **`POST /api/v2configs/vpcs/[name]/route-tables`**
- Returns: `{ routeTable }` (201)

### `deleteRouteTable({ name, rtId, branch? })`
Delete a route table (409 if associations remain). **`DELETE /api/v2configs/vpcs/[name]/route-tables/[rtId]`**
- Returns: `{ ok }`

### `associateSubnet({ name, rtId, subnetId, branch? })`
Associate a subnet. **`POST /api/v2configs/vpcs/[name]/route-tables/[rtId]/associations`**
- Returns: `{ associationId }` (201)

### `disassociateSubnet({ name, rtId, associationId, branch? })`
Disassociate (`?associationId=`). **`DELETE /api/v2configs/vpcs/[name]/route-tables/[rtId]/associations`**
- Returns: `{ ok }`

### `setDefaultRoute({ name, rtId, target, branch? })`
Set/replace/clear the 0.0.0.0/0 default route (`target:null` clears). **`POST /api/v2configs/vpcs/[name]/route-tables/[rtId]/routes`**
- Returns: `{ ok }`
```js
await sdk.networkBundles.setDefaultRoute({ name: 'mesh-a', rtId: 'rtb-0abc', target: { natGatewayId: 'nat-0abc' } });
```
