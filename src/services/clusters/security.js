// @ts-nocheck
/**
 * ClusterSecurityService — access entries, security groups, and IAM node-role
 * management for a single cluster. Accessed as `sdk.clusters.security`.
 *
 * Covers three concerns:
 *   - **access entries** — EKS access entries / GKE access bindings (who can
 *     reach the API server, with which policy).
 *   - **security groups** — the cluster's desired SG plan + per-SG rule reads.
 *   - **iam** — discovering, creating, validating, and patching the node IAM role.
 *
 * All methods are container + cluster scoped: pass `{ container, name, ... }`.
 * Note the `branch` placement varies by route (matched to each handler below):
 * GET/DELETE read it from the query, most POSTs read it from the body, but
 * `access-entries` POST/DELETE read it from the query.
 */
export class ClusterSecurityService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  // ─── Access entries ─────────────────────────────────────────────────────────

  /**
   * List cluster access entries + auth mode.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ authMode, selfPrincipalArn, policies, entries }>}
   * @example
   * const { entries } = await sdk.clusters.security.accessEntries({ container:'app1', name:'z-01' });
   */
  accessEntries({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/access-entries`, 'GET', { query: { branch } });
  }

  /**
   * Grant a principal access to the cluster.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.principalArn
   * @param {string} [params.policy='view']
   * @param {string} [params.branch='main'] - Read from query.
   * @returns {Promise<{ success, [out]: * }>}
   * @example
   * await sdk.clusters.security.grantAccess({ container:'app1', name:'z-01', principalArn:'arn:...', policy:'admin' });
   */
  grantAccess({ container, name, principalArn, policy, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/access-entries`, 'POST', { body: { principalArn, policy }, query: { branch } });
  }

  /**
   * Revoke a principal's access.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.principalArn
   * @param {string} [params.branch='main'] - Read from query.
   * @returns {Promise<{ success, [out]: * }>}
   * @example
   * await sdk.clusters.security.revokeAccess({ container:'app1', name:'z-01', principalArn:'arn:...' });
   */
  revokeAccess({ container, name, principalArn, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/access-entries`, 'DELETE', { body: { principalArn }, query: { branch } });
  }

  // ─── Security groups ────────────────────────────────────────────────────────

  /**
   * Get the cluster's security-group plan + last sync time.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main']
   * @returns {Promise<{ plan, lastSyncedAt }>}
   * @example
   * const { plan } = await sdk.clusters.security.securityGroups({ container:'app1', name:'z-01' });
   */
  securityGroups({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/security-groups`, 'GET', { query: { branch } });
  }

  /**
   * Apply (create/reconcile) the cluster's managed security groups.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.branch='main'] - Read from body.
   * @returns {Promise<{ ok, plan, lastSyncedAt, applied: { created, reconciled } }>}
   * @example
   * await sdk.clusters.security.applySecurityGroups({ container:'app1', name:'z-01' });
   */
  applySecurityGroups({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/security-groups`, 'POST', { body: { branch } });
  }

  /**
   * Read a single security group's live rules by AWS group id.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.groupId - AWS security-group id (e.g. sg-...).
   * @param {string} [params.branch='main']
   * @returns {Promise<{ sg: { awsGroupId, name, description, vpcId, ownerId, inbound, outbound, tags, fetchedAt } }>}
   * @example
   * const { sg } = await sdk.clusters.security.securityGroup({ container:'app1', name:'z-01', groupId:'sg-abc' });
   */
  securityGroup({ container, name, groupId, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/sg/${encodeURIComponent(groupId)}`, 'GET', { query: { branch } });
  }

  // ─── IAM node role ──────────────────────────────────────────────────────────

  /**
   * Create a node IAM role (and optionally attach SSM + extra policies).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.roleName
   * @param {boolean} [params.attachSsm=true]
   * @param {string[]} [params.additionalPolicyArns=[]]
   * @param {string} [params.description]
   * @param {string} [params.branch='main'] - Read from body.
   * @returns {Promise<{ roleArn, roleName, attached, alreadyExisted, validation }>}
   * @example
   * await sdk.clusters.security.createNodeRole({ container:'app1', name:'z-01', roleName:'z-01-node' });
   */
  createNodeRole({ container, name, roleName, attachSsm, additionalPolicyArns, description, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/iam/create-node-role`, 'POST', {
      body: { roleName, attachSsm, additionalPolicyArns, description, branch },
    });
  }

  /**
   * Discover the node IAM role Zeus would use for a given consumer.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.consumer='managed-ng'] - 'managed-ng' | 'auto-mode' | 'self-managed'.
   * @param {string} [params.branch='main']
   * @returns {Promise<{ roleArn, source, sourceDetail?, steps, error? }>}
   * @example
   * const r = await sdk.clusters.security.discoverNodeRole({ container:'app1', name:'z-01' });
   */
  discoverNodeRole({ container, name, consumer, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/iam/discover-node-role`, 'GET', { query: { consumer, branch } });
  }

  /**
   * Validate a node IAM role for a consumer (trust policy, attached policies, SSM).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.roleArn
   * @param {string} [params.consumer='managed-ng'] - 'managed-ng' | 'auto-mode' | 'self-managed'.
   * @returns {Promise<{ valid, consumer, exists, trustPolicyOk, requiredPolicyStatus, ssmAttached, issues }>}
   * @example
   * const v = await sdk.clusters.security.validateRole({ container:'app1', name:'z-01', roleArn:'arn:...' });
   */
  validateRole({ container, name, roleArn, consumer }) {
    return this.sdk._fetch(`${this._base(container, name)}/iam/validate-role`, 'POST', { body: { roleArn, consumer } });
  }

  /**
   * Attach the SSM managed policy to a node group's role.
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} params.ngName
   * @param {string} params.roleArn
   * @param {string} [params.branch='main'] - Read from body.
   * @returns {Promise<{ ok, ssm }>}
   * @example
   * await sdk.clusters.security.attachSsm({ container:'app1', name:'z-01', ngName:'workers', roleArn:'arn:...' });
   */
  attachSsm({ container, name, ngName, roleArn, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/iam/attach-ssm`, 'POST', { body: { ngName, roleArn, branch } });
  }

  /**
   * Report Zeus's IAM capabilities for this cluster (role-creation scope + expansion).
   * @param {object} params
   * @param {string} params.container
   * @param {string} params.name
   * @param {string} [params.prefix=''] - Role-name prefix to test.
   * @param {string} [params.branch='main']
   * @param {AbortSignal} [params.signal] - Optional abort signal (timeout/cancel).
   * @returns {Promise<{ scope, principal, canCreateZeusRole, canCreateAnyRole, account, expansion }>}
   * @example
   * const cap = await sdk.clusters.security.zeusCapabilities({ container:'app1', name:'z-01' });
   */
  zeusCapabilities({ container, name, prefix, branch, signal }) {
    return this.sdk._fetch(`${this._base(container, name)}/iam/zeus-capabilities`, 'GET', { query: { prefix, branch }, signal });
  }
}
