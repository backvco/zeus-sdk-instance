// @ts-nocheck
/**
 * ServiceIdentitiesService — per-service cloud identities (AWS IAM users / GCP
 * workload identities) declared as desired state and reconciled to the cloud.
 *
 * Accessed as `sdk.services.identities`.
 *
 * Container-scoped: every method takes `{ container, name, ... }` where `name`
 * is the owning service. An identity carries a permission DSL (AWS) or a
 * manifest (GCP) plus optional delivery targets (clusters to push access keys
 * into as K8s secrets).
 *
 * Lifecycle: `create` (desired state only) → `reconcile` (apply to cloud, mint
 * a key) → `deliver` (push the active key into a cluster secret) → `createKey`
 * / `deleteKey` for rotation → `delete` (tear down on cloud + scrub). Use
 * `syncFromRepo` to import policy JSON discovered in the service's GitHub repo.
 */
export class ServiceIdentitiesService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List all identities declared for a service.
   * Route: GET /api/v2configs/[container]/services/[name]/identities
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ identities: object[] }>}
   * @example
   * const { identities } = await sdk.services.identities.list({ container: 'app1', name: 'api' });
   */
  list({ container, name, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/identities`, 'GET', { query: { branch } });
  }

  /**
   * Create an identity (persists desired state only; provider must be 'aws').
   * Also runs delivery sync for any `deliveries` on the identity.
   * Route: POST /api/v2configs/[container]/services/[name]/identities
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {object} params.identity      - { name, provider:'aws', permissions, deliveries?, deliverTo? }.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ identity: object, sync: object }>}
   * @example
   * await sdk.services.identities.create({
   *   container: 'app1', name: 'api',
   *   identity: { name: 'api-s3', provider: 'aws', permissions: [...] }
   * });
   */
  create({ container, name, identity, branch }) {
    return this.sdk._fetch(`/v2configs/${container}/services/${encodeURIComponent(name)}/identities`, 'POST', {
      body: { identity, branch },
    });
  }

  /**
   * Describe one identity (desired state, plus live cloud state unless aws=false).
   * Route: GET /api/v2configs/[container]/services/[name]/identities/[identity]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {boolean} [params.includeAws=true] - When false, skips read-only cloud calls (sent as `aws=false`).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ identity: object, describe?: object }>}
   * @example
   * const { identity, describe } = await sdk.services.identities.get({ container: 'app1', name: 'api', identity: 'api-s3' });
   */
  get({ container, name, identity, includeAws, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}`,
      'GET',
      { query: { branch, aws: includeAws === false ? 'false' : undefined } },
    );
  }

  /**
   * Update an identity's permissions/manifest/deliveries (name is immutable).
   * Route: PUT /api/v2configs/[container]/services/[name]/identities/[identity]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name (must match identity.name if set).
   * @param {object} params.identityData  - Updated identity blob (permissions for AWS, manifest for GCP).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ identity: object, sync: object }>}
   * @example
   * await sdk.services.identities.update({
   *   container: 'app1', name: 'api', identity: 'api-s3',
   *   identityData: { permissions: [...] }
   * });
   */
  update({ container, name, identity, identityData, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}`,
      'PUT',
      { body: { identity: identityData, branch } },
    );
  }

  /**
   * Delete an identity: tear it down on the cloud, scrub deliveries, drop from
   * the service JSON.
   * Route: DELETE /api/v2configs/[container]/services/[name]/identities/[identity]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} [params.branch='main'] - Config branch (sent as ?branch=).
   * @returns {Promise<{ success: true, cleaned: object[] }>}
   * @example
   * await sdk.services.identities.delete({ container: 'app1', name: 'api', identity: 'api-s3' });
   */
  delete({ container, name, identity, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}`,
      'DELETE',
      { query: { branch } },
    );
  }

  /**
   * Apply an identity's desired state to the cloud (ensure IAM user, put inline
   * policy, mint a key if deliverTo is set and none active).
   * Route: POST /api/v2configs/[container]/services/[name]/identities/[identity]/reconcile
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} Reconcile result.
   * @example
   * await sdk.services.identities.reconcile({ container: 'app1', name: 'api', identity: 'api-s3' });
   */
  reconcile({ container, name, identity, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}/reconcile`,
      'POST',
      { body: { branch } },
    );
  }

  /**
   * Push the identity's active access key into a K8s secret on a cluster.
   * Route: POST /api/v2configs/[container]/services/[name]/identities/[identity]/deliver
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} params.context       - Kubeconfig context (cluster identifier).
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ delivered: boolean, namespace: string, secret: string, accessKeyId: string }>}
   * @example
   * await sdk.services.identities.deliver({ container: 'app1', name: 'api', identity: 'api-s3', context: 'z-01' });
   */
  deliver({ container, name, identity, context, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}/deliver`,
      'POST',
      { body: { context, branch } },
    );
  }

  /**
   * Create a new access key for the identity (rotation). The secret is cached
   * encrypted server-side and never returned in this response — use deliver().
   * Route: POST /api/v2configs/[container]/services/[name]/identities/[identity]/keys
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ accessKeyId: string, createdAt: string }>}
   * @example
   * await sdk.services.identities.createKey({ container: 'app1', name: 'api', identity: 'api-s3' });
   */
  createKey({ container, name, identity, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}/keys`,
      'POST',
      { body: { branch } },
    );
  }

  /**
   * Reveal the cached cleartext secret for a Zeus-created key.
   * Route: GET /api/v2configs/[container]/services/[name]/identities/[identity]/keys/[keyId]?reveal=true
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} params.keyId         - Access key id.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ accessKeyId: string, secretAccessKey: string, slot: string|null }>}
   * @example
   * const { secretAccessKey } = await sdk.services.identities.revealKey({ container: 'app1', name: 'api', identity: 'api-s3', keyId: 'AKIA...' });
   */
  revealKey({ container, name, identity, keyId, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}/keys/${encodeURIComponent(keyId)}`,
      'GET',
      { query: { reveal: 'true', branch } },
    );
  }

  /**
   * Activate or deactivate an access key.
   * Route: PATCH /api/v2configs/[container]/services/[name]/identities/[identity]/keys/[keyId]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} params.keyId         - Access key id.
   * @param {'Active'|'Inactive'} params.status - New key status.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.services.identities.setKeyStatus({ container: 'app1', name: 'api', identity: 'api-s3', keyId: 'AKIA...', status: 'Inactive' });
   */
  setKeyStatus({ container, name, identity, keyId, status, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}/keys/${encodeURIComponent(keyId)}`,
      'PATCH',
      { body: { status, branch } },
    );
  }

  /**
   * Permanently delete an access key (off the cloud + cache).
   * Route: DELETE /api/v2configs/[container]/services/[name]/identities/[identity]/keys/[keyId]
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identity      - Identity name.
   * @param {string} params.keyId         - Access key id.
   * @param {string} [params.branch='main'] - Config branch (sent in JSON body).
   * @returns {Promise<{ success: true }>}
   * @example
   * await sdk.services.identities.deleteKey({ container: 'app1', name: 'api', identity: 'api-s3', keyId: 'AKIA...' });
   */
  deleteKey({ container, name, identity, keyId, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/${encodeURIComponent(identity)}/keys/${encodeURIComponent(keyId)}`,
      'DELETE',
      { body: { branch } },
    );
  }

  /**
   * Discover IAM policy JSON in the service's linked GitHub repo (read-only).
   * Route: GET /api/v2configs/[container]/services/[name]/identities/sync-from-repo
   *
   *   - op 'branches' (default) → { repo, branches }
   *   - op 'scan' (+ gitBranch) → { repo, branch, candidates }
   *   - op 'drift'              → { repo, drift }
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} [params.op='branches'] - 'branches' | 'scan' | 'drift'.
   * @param {string} [params.gitBranch]   - Required when op='scan'.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<object>} `{ repo, ... }` shaped per op.
   * @example
   * const { candidates } = await sdk.services.identities.scanRepo({ container: 'app1', name: 'api', op: 'scan', gitBranch: 'main' });
   */
  scanRepo({ container, name, op, gitBranch, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/sync-from-repo`,
      'GET',
      { query: { op, gitBranch, branch } },
    );
  }

  /**
   * Import a discovered policy candidate as an identity (create or update).
   * Route: POST /api/v2configs/[container]/services/[name]/identities/sync-from-repo
   *
   * @param {object} params
   * @param {string} params.container     - Workspace container.
   * @param {string} params.name          - Service name.
   * @param {string} params.identityName  - Target identity name.
   * @param {object} params.candidate     - Discovered candidate { policy, provider?, branch, path, sha? }.
   * @param {string} [params.deliverTo]   - Optional delivery target to set on the identity.
   * @param {string} [params.branch='main'] - Config branch.
   * @returns {Promise<{ identity: object }>}
   * @example
   * await sdk.services.identities.importFromRepo({
   *   container: 'app1', name: 'api', identityName: 'api-s3', candidate: { policy: {...}, branch: 'main', path: 'iam/s3.json' }
   * });
   */
  importFromRepo({ container, name, identityName, candidate, deliverTo, branch }) {
    return this.sdk._fetch(
      `/v2configs/${container}/services/${encodeURIComponent(name)}/identities/sync-from-repo`,
      'POST',
      { body: { identityName, candidate, deliverTo, branch } },
    );
  }
}
