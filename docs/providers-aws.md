# `sdk.providers.aws` — AWS / EKS provider

`AwsService` covers the AWS surface: EKS cluster-access remediation, region /
VPC / AZ / EKS-version discovery, VPC adopt, S3 helpers, provider settings, the
IAM permission coverage check + tiers, and the low-level `/api/aws/*` resource
probes (EC2 describe, IRSA roles, Route53). Two sub-namespaces hang off it:

| Sub-namespace | Class | Covers |
|---|---|---|
| `.accounts` | `AwsAccountsService` | linked-account CRUD + default + STS verify |
| `.linkSetup` | `AwsLinkSetupService` | CLI account-link flow + permission-fix flow (token-based) |

Every method takes a single destructured object and returns the route's JSON
verbatim (no unwrapping). Many reads accept an optional `accountId` to scope to
one linked account; omit it for the default account (which degrades to the
ambient credential chain when none are linked). Streaming methods return an SSE
handle (async-iterable + `onMessage/onDone/onError` + `close()`).

```js
const { accounts } = await sdk.providers.aws.accounts.list();
const { regions }  = await sdk.providers.aws.regions();
const s = sdk.providers.aws.permissionsCheck();
s.onDone = (ev) => console.log(ev.data?.result);
```

---

## `.accounts` — `AwsAccountsService`

| Method | Route | Returns |
|---|---|---|
| `list()` | `GET /providers/aws/accounts` | `{ accounts, defaultAccountId }` |
| `create({ accountId, alias, displayName, credentialType, accessKeyId, secretAccessKey, defaultRegion })` | `POST /providers/aws/accounts` | `{ account }` |
| `get({ accountId })` | `GET /providers/aws/accounts/[accountId]` | `{ account }` |
| `update({ accountId, fields })` | `PUT /providers/aws/accounts/[accountId]` | `{ account }` |
| `setDefault({ accountId })` | `PUT …/[accountId]` (action=set-default) | `{ account, defaulted }` |
| `delete({ accountId, force })` | `DELETE …/[accountId]?force=1` | `{ ok }` |
| `verify({ accountId, accessKeyId?, secretAccessKey?, region? })` | `POST …/[accountId]/verify` | `{ ok, callerArn?, account?, matchesAccountId?, error? }` |

`verify` with ad-hoc keys verifies pre-save; without, verifies the saved account.
Never throws on bad creds (returns `{ ok:false }`, HTTP 200).

## `.linkSetup` — `AwsLinkSetupService`

CLI flows hand the operator a `curl … | bash` command bound to a single-use
token; the script beacons back via claim/complete; the UI polls status.

| Method | Route | Returns |
|---|---|---|
| `linkInit()` | `POST /providers/aws/accounts/link/init` | `{ token, expiresAt, command, zeusUrl }` |
| `linkClaim({ token })` | `POST …/link/claim` | `{ ok }` |
| `linkComplete({ token, accountId, alias?, accessKeyId, secretAccessKey, defaultRegion?, callerArn? })` | `POST …/link/complete` | `{ ok, account }` |
| `linkStatus({ token })` | `GET …/link/status?token` | `{ status, … }` |
| `fixInit({ tiers, accountId?, userName? })` | `POST /providers/aws/setup/fix/init` | `{ token, expiresAt, command }` |
| `fixClaim({ token })` | `POST /providers/aws/setup/fix/claim` | `{ tiers, accountId, userName }` |
| `fixComplete({ token, error? })` | `POST /providers/aws/setup/fix/complete` | `{ ok }` |
| `fixStatus({ token })` | `GET /providers/aws/setup/fix/status?token` | `{ status, error? }` |

---

## EKS cluster access (`sdk.providers.aws`)

| Method | Route | Returns |
|---|---|---|
| `clusterAccess({ accountId? })` | `GET /providers/aws/cluster-access` | `{ principalArn, clusters }` |
| `clusterAccessGrant({ clusters, policy?, accountId? })` | `POST /providers/aws/cluster-access` | `{ principalArn, policyArn, results }` |
| `clustersByVpc({ region, accountId? })` | `GET /providers/aws/clusters-by-vpc` | `{ byVpcId }` |
| `clustersDrift({ branch? })` | `GET /providers/aws/clusters-drift` | `{ clusters, summary }` |

`clusterAccessGrant` targets are `[{ name, region, accountId?, clusterArn? }]`;
idempotent. `clustersByVpc` requires `region`.

## Identity, regions & VPCs

| Method | Route | Returns |
|---|---|---|
| `identity({ accountId? })` | `GET /providers/aws/identity` | `{ callerArn, account, principalArn, principal }` |
| `regions()` | `GET /providers/aws/regions` | `{ regions }` |
| `regionAzs({ region })` | `GET /providers/aws/regions/[region]/azs` | `{ azs }` |
| `regionEksVersions({ region })` | `GET …/[region]/eks-versions` | `{ versions }` |
| `regionSecurityGroups({ region, vpcId?, accountId? })` | `GET …/[region]/security-groups` | `{ groups }` |
| `regionVpcs({ region, accountId?, branch? })` | `GET …/[region]/vpcs` | `{ vpcs }` |
| `vpc({ region, vpcId })` | `GET …/[region]/vpcs/[vpcId]` | `{ vpc, subnets, nats, igws, routeTables }` |
| `vpcAdoptPreview({ region, vpcId, accountId?, branch? })` | `GET …/[vpcId]/adopt` | `{ preview }` |
| `vpcAdopt({ region, vpcId, bundleName, dryRun?, accountId?, branch? })` | `POST …/[vpcId]/adopt` | `{ bundle, dryRun }` |

`vpcAdopt` 409s if the bundle name already exists.

## S3, settings, permissions & setup

| Method | Route | Returns |
|---|---|---|
| `createBucket({ name, region })` | `POST /providers/aws/s3/create-bucket` | `{ bucket }` |
| `listBuckets({ region? })` | `GET /providers/aws/s3/list-buckets` | `{ buckets }` |
| `getSettings({ branch? })` | `GET /providers/aws/settings` | `{ settings: { favoritedRegions } }` |
| `saveSettings({ favoritedRegions, branch? })` | `PUT /providers/aws/settings` | `{ settings }` |
| `permissionsCheck({ accountId? })` | `POST /providers/aws/permissions-check` | **SSE** — `done` carries `{ result }` |
| `setupSmokeTest({ accountId?, region? })` | `POST /providers/aws/setup` | smoke-test results |
| `setupTiers()` | `GET /providers/aws/setup/tiers` | `{ tiers }` |

## `/api/aws/*` resource probes

| Method | Route | Returns |
|---|---|---|
| `ec2({ resource, region?, vpcId?, owner?, arch?, name? })` | `GET /aws/ec2` | `{ data }` |
| `iamRoles(body)` | `POST /aws/iam-roles` | depends on `action` |
| `route53({ resource, domain?, zoneId?, name?, accountId? })` | `GET /aws/route53` | `{ zones? | zone? | records? }` |

- **`ec2` `resource`**: `security-groups` | `subnets` | `availability-zones` |
  `vpcs` | `key-pairs` | `amis` (AMIs take `owner`/`arch`/`name`).
- **`iamRoles` `action`** (full body passed through; `branch` defaults `main`):
  `search` `{ container, clusterName, query? }` → `{ roles, oidcIssuer }`;
  `describe` `{ roleName }` → `{ role }`;
  `ensure-trust` `{ container, clusterName, roleName, serviceAccountNamespace, serviceAccountName }`;
  `create` `{ container, clusterName, roleName, policyDocPath?|managedPolicyArns?|zeusManagedPolicy, serviceAccountNamespace, serviceAccountName, description? }`.
- **`route53` `resource`**: `hosted-zones` → `{ zones }`; `find-zone` (needs
  `domain`) → `{ zone }`; `records` (needs `zoneId`, optional `name`) → `{ records }`.
