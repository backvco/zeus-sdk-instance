// @ts-nocheck
/**
 * ClusterStorageService — cloud storage resources backing a cluster's
 * persistent volumes / object stores. Accessed as `sdk.clusters.storage`.
 *
 * Families:
 *   - **S3 buckets** + **S3 IAM users** (AWS object storage).
 *   - **EFS filesystems** + **EFS lifecycle/discover** (AWS elastic file storage).
 *   - **GCS buckets** + **GCS service accounts** (GCP object storage).
 *   - **Filestore instances** (GCP NFS).
 *
 * Create / delete operations STREAM (SSE) — they provision cloud resources; the
 * route's terminal `done` event carries the result (or `{ error }` in-band).
 * Update / rename / lifecycle operations return JSON. Every route reads
 * `?branch=` (default 'main').
 *
 * All methods are container + cluster scoped: pass `{ container, name, ... }`.
 */
export class ClusterStorageService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  // ─── S3 ─────────────────────────────────────────────────────────────────────

  /**
   * List tracked + live S3 buckets for the cluster.
   * @returns {Promise<{ buckets: Array<object>, reason?: string }>}
   * @example const { buckets } = await sdk.clusters.storage.s3Buckets({ container:'app1', name:'z-01' });
   */
  s3Buckets({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/s3-buckets`, 'GET', { query: { branch } });
  }

  /**
   * Create an S3 bucket. STREAMING.
   * @param {object} params - container, name (cluster), branch, resourceName (the new bucket's
   *   friendly name → body `name`, required) + body: region, encryption ('SSE-S3'), kmsKeyId,
   *   versioning, publicAccessBlocked, transitionToIA, transitionToGlacier, expireAfter.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ name, bucketName }`.
   * @example const s = sdk.clusters.storage.createS3Bucket({ container:'app1', name:'z-01', resourceName:'data' });
   */
  createS3Bucket({ container, name, branch, resourceName, ...rest }) {
    return this.sdk._stream(`${this._base(container, name)}/s3-buckets`, 'POST', { body: { name: resourceName, ...rest }, query: { branch } });
  }

  /**
   * Update an S3 bucket's settings (any subset).
   * @param {object} params - container, name, bucketName (friendly), branch + body:
   *   encryption, kmsKeyId, versioning, publicAccessBlocked, transitionToIA, transitionToGlacier, expireAfter.
   * @returns {Promise<{ success: true, updates }>}
   * @example await sdk.clusters.storage.updateS3Bucket({ container:'app1', name:'z-01', bucketName:'data', versioning:true });
   */
  updateS3Bucket({ container, name, bucketName, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/s3-buckets/${encodeURIComponent(bucketName)}`, 'POST', { body, query: { branch } });
  }

  /**
   * Delete an S3 bucket. STREAMING (409 JSON if a storage class references it).
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ destroyed, bucketName }`.
   * @example const s = sdk.clusters.storage.deleteS3Bucket({ container:'app1', name:'z-01', bucketName:'data' });
   */
  deleteS3Bucket({ container, name, bucketName, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/s3-buckets/${encodeURIComponent(bucketName)}`, 'DELETE', { query: { branch } });
  }

  /**
   * Rename an S3 bucket's friendly name.
   * @returns {Promise<{ success: true, bucketName?, name?, unchanged?, awsRenamed?, persistWarning? }>}
   * @example await sdk.clusters.storage.renameS3Bucket({ container:'app1', name:'z-01', bucketName:'data', newName:'data2' });
   */
  renameS3Bucket({ container, name, bucketName, newName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/s3-buckets/${encodeURIComponent(bucketName)}/rename`, 'POST', { body: { newName }, query: { branch } });
  }

  /**
   * Describe the IAM user for an S3 purpose/bucket.
   * @param {object} params - container, name, purpose (required), bucketName, branch.
   * @returns {Promise<{ userName, exists, keys }>}
   * @example const u = await sdk.clusters.storage.s3IamUser({ container:'app1', name:'z-01', purpose:'backups' });
   */
  s3IamUser({ container, name, purpose, bucketName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/s3-iam-users`, 'GET', { query: { purpose, bucketName, branch } });
  }

  /**
   * Manage an S3 IAM user: action 'generate-keys' or 'sync-policy'.
   * @param {object} params - container, name, branch + body: action, purpose, bucketName.
   * @returns {Promise<object>} For 'generate-keys' `{ accessKeyId, secretAccessKey, ... }`;
   *   for 'sync-policy' `{ ...ensureBucketUser, policySynced: true }`.
   * @example await sdk.clusters.storage.s3IamUserAction({ container:'app1', name:'z-01', action:'generate-keys', purpose:'backups' });
   */
  s3IamUserAction({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/s3-iam-users`, 'POST', { body, query: { branch } });
  }

  // ─── EFS ─────────────────────────────────────────────────────────────────────

  /**
   * Discover/reconcile the cluster's EFS filesystem.
   * @returns {Promise<{ fileSystemId, lifeCycleState, changes, reconciled } | { fileSystemId: null, reason }>}
   * @example const d = await sdk.clusters.storage.efsDiscover({ container:'app1', name:'z-01' });
   */
  efsDiscover({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/efs-discover`, 'GET', { query: { branch } });
  }

  /**
   * List tracked + live EFS filesystems.
   * @returns {Promise<{ filesystems: Array<object>, reason?: string }>}
   * @example const { filesystems } = await sdk.clusters.storage.efsFilesystems({ container:'app1', name:'z-01' });
   */
  efsFilesystems({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/efs-filesystems`, 'GET', { query: { branch } });
  }

  /**
   * Create an EFS filesystem. STREAMING.
   * @param {object} params - container, name (cluster), branch, resourceName (the new filesystem's
   *   friendly name → body `name`, required, not 'default') + body: performanceMode, throughputMode,
   *   availability, availabilityZone, encrypted, transitionToIA, transitionToPrimary.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ name, fileSystemId }`.
   * @example const s = sdk.clusters.storage.createEfsFilesystem({ container:'app1', name:'z-01', resourceName:'shared' });
   */
  createEfsFilesystem({ container, name, branch, resourceName, ...rest }) {
    return this.sdk._stream(`${this._base(container, name)}/efs-filesystems`, 'POST', { body: { name: resourceName, ...rest }, query: { branch } });
  }

  /**
   * Update an EFS filesystem's lifecycle policies.
   * @param {object} params - container, name, fsName (friendly), branch + body:
   *   transitionToIA, transitionToPrimary.
   * @returns {Promise<{ success: true, policies }>}
   * @example await sdk.clusters.storage.updateEfsFilesystem({ container:'app1', name:'z-01', fsName:'shared', transitionToIA:'AFTER_30_DAYS' });
   */
  updateEfsFilesystem({ container, name, fsName, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/efs-filesystems/${encodeURIComponent(fsName)}`, 'POST', { body, query: { branch } });
  }

  /**
   * Delete an EFS filesystem. STREAMING (refuses 'default'; 409 if referenced).
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ fsName, destroyed }`.
   * @example const s = sdk.clusters.storage.deleteEfsFilesystem({ container:'app1', name:'z-01', fsName:'shared' });
   */
  deleteEfsFilesystem({ container, name, fsName, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/efs-filesystems/${encodeURIComponent(fsName)}`, 'DELETE', { query: { branch } });
  }

  /**
   * Rename an EFS filesystem's friendly name.
   * @returns {Promise<{ success: true, fileSystemId?, name?, unchanged?, awsRenamed?, persistWarning? }>}
   * @example await sdk.clusters.storage.renameEfsFilesystem({ container:'app1', name:'z-01', fsName:'shared', newName:'shared2' });
   */
  renameEfsFilesystem({ container, name, fsName, newName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/efs-filesystems/${encodeURIComponent(fsName)}/rename`, 'POST', { body: { newName }, query: { branch } });
  }

  /**
   * Get the cluster's EFS lifecycle policy (live + desired).
   * @returns {Promise<{ found: true, fileSystemId, live, desired } | { found: false, note }>}
   * @example const lc = await sdk.clusters.storage.efsLifecycle({ container:'app1', name:'z-01' });
   */
  efsLifecycle({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/efs-lifecycle`, 'GET', { query: { branch } });
  }

  /**
   * Set the cluster's EFS lifecycle policy.
   * @param {object} params - container, name, branch + body: transitionToIA, transitionToPrimary.
   * @returns {Promise<{ success: true, policies, appliedToAws?, persistWarning? }>}
   * @example await sdk.clusters.storage.setEfsLifecycle({ container:'app1', name:'z-01', transitionToIA:'AFTER_30_DAYS' });
   */
  setEfsLifecycle({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/efs-lifecycle`, 'POST', { body, query: { branch } });
  }

  // ─── GCS ─────────────────────────────────────────────────────────────────────

  /**
   * List tracked + live GCS buckets.
   * @returns {Promise<{ buckets: Array<object>, reason?: string }>}
   * @example const { buckets } = await sdk.clusters.storage.gcsBuckets({ container:'app1', name:'z-03' });
   */
  gcsBuckets({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/gcs-buckets`, 'GET', { query: { branch } });
  }

  /**
   * Create a GCS bucket. STREAMING.
   * @param {object} params - container, name (cluster), branch, resourceName (the new bucket's
   *   friendly name → body `name`, required) + body: location, storageClass,
   *   encryption ('GMEK'|'CMEK'), kmsKeyName, versioning, publicAccessBlocked,
   *   transitionToIA, transitionToArchive, expireAfter.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ name, bucketName }`.
   * @example const s = sdk.clusters.storage.createGcsBucket({ container:'app1', name:'z-03', resourceName:'data' });
   */
  createGcsBucket({ container, name, branch, resourceName, ...rest }) {
    return this.sdk._stream(`${this._base(container, name)}/gcs-buckets`, 'POST', { body: { name: resourceName, ...rest }, query: { branch } });
  }

  /**
   * Update a GCS bucket's settings (any subset).
   * @param {object} params - container, name, bucketName (friendly), branch + body:
   *   encryption, kmsKeyName, versioning, publicAccessBlocked, transitionToIA, transitionToArchive, expireAfter.
   * @returns {Promise<{ success: true, updates }>}
   * @example await sdk.clusters.storage.updateGcsBucket({ container:'app1', name:'z-03', bucketName:'data', versioning:true });
   */
  updateGcsBucket({ container, name, bucketName, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/gcs-buckets/${encodeURIComponent(bucketName)}`, 'POST', { body, query: { branch } });
  }

  /**
   * Delete a GCS bucket. STREAMING (409 if a storage class references it).
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ destroyed, bucketName }`.
   * @example const s = sdk.clusters.storage.deleteGcsBucket({ container:'app1', name:'z-03', bucketName:'data' });
   */
  deleteGcsBucket({ container, name, bucketName, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/gcs-buckets/${encodeURIComponent(bucketName)}`, 'DELETE', { query: { branch } });
  }

  /**
   * Rename a GCS bucket's friendly name.
   * @returns {Promise<{ success: true, bucketName?, name?, unchanged?, gcsRenamed?, persistWarning? }>}
   * @example await sdk.clusters.storage.renameGcsBucket({ container:'app1', name:'z-03', bucketName:'data', newName:'data2' });
   */
  renameGcsBucket({ container, name, bucketName, newName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/gcs-buckets/${encodeURIComponent(bucketName)}/rename`, 'POST', { body: { newName }, query: { branch } });
  }

  /**
   * Describe the service account for a GCS purpose/bucket.
   * @param {object} params - container, name, purpose (required), bucketName, branch.
   * @returns {Promise<{ userName, exists, keys, policy }>}
   * @example const sa = await sdk.clusters.storage.gcsServiceAccount({ container:'app1', name:'z-03', purpose:'backups' });
   */
  gcsServiceAccount({ container, name, purpose, bucketName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/gcs-service-accounts`, 'GET', { query: { purpose, bucketName, branch } });
  }

  /**
   * Manage a GCS service account: action 'generate-keys' or 'sync-policy'.
   * @param {object} params - container, name, branch + body: action, purpose (required), bucketName (required).
   * @returns {Promise<object>} For 'generate-keys' `{ encodedKey, accessKeyId }`;
   *   for 'sync-policy' `{ ...ensureBucketServiceAccount, policySynced: true }`.
   * @example await sdk.clusters.storage.gcsServiceAccountAction({ container:'app1', name:'z-03', action:'generate-keys', purpose:'backups', bucketName:'data' });
   */
  gcsServiceAccountAction({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/gcs-service-accounts`, 'POST', { body, query: { branch } });
  }

  // ─── Filestore ────────────────────────────────────────────────────────────────

  /**
   * List GCP Filestore instances for the cluster.
   * @returns {Promise<{ instances: Array<object>, reason?: string }>}
   * @example const { instances } = await sdk.clusters.storage.filestoreInstances({ container:'app1', name:'z-03' });
   */
  filestoreInstances({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/filestore-instances`, 'GET', { query: { branch } });
  }

  /**
   * Create a Filestore instance. STREAMING.
   * @param {object} params - container, name (cluster), branch, resourceName (the new instance's
   *   friendly name → body `name`, required) + body: tier, capacityGb.
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ name, instanceId, ipAddress }`.
   * @example const s = sdk.clusters.storage.createFilestoreInstance({ container:'app1', name:'z-03', resourceName:'shared', capacityGb:1024 });
   */
  createFilestoreInstance({ container, name, branch, resourceName, ...rest }) {
    return this.sdk._stream(`${this._base(container, name)}/filestore-instances`, 'POST', { body: { name: resourceName, ...rest }, query: { branch } });
  }

  /**
   * Delete a Filestore instance. STREAMING (409 if a storage class references its IP).
   * @returns {ReturnType<import('../../stream.js').openStream>} SSE; `done` `{ destroyed, instanceId }`.
   * @example const s = sdk.clusters.storage.deleteFilestoreInstance({ container:'app1', name:'z-03', fsName:'shared' });
   */
  deleteFilestoreInstance({ container, name, fsName, branch }) {
    return this.sdk._stream(`${this._base(container, name)}/filestore-instances/${encodeURIComponent(fsName)}`, 'DELETE', { query: { branch } });
  }
}
