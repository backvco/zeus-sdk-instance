// @ts-nocheck
/**
 * ClusterCertsService — cert-manager issuers + their DNS-solver credentials, plus
 * the cluster's live addon inventory. Accessed as `sdk.clusters.certs`.
 *
 * Covers:
 *   - **cert issuers** — read/save/apply ClusterIssuers.
 *   - **issuer creds** — the DNS01 solver secret (AWS Route53, GCP Cloud DNS).
 *   - **issuer IAM** — the Route53 IAM user backing the AWS solver.
 *   - **addons-live** — the cluster's installed addons vs. the Zeus catalog.
 *
 * All methods are container + cluster scoped: pass `{ container, name, ... }`.
 * Every route reads `?branch=` (default 'main').
 */
export class ClusterCertsService {
  constructor(sdk) { this.sdk = sdk; }

  _base(container, name) {
    return `/v2configs/${encodeURIComponent(container)}/clusters/${encodeURIComponent(name)}`;
  }

  /**
   * List the cluster's cert issuers.
   * @returns {Promise<{ certIssuers: Array<object> }>}
   * @example const { certIssuers } = await sdk.clusters.certs.issuers({ container:'app1', name:'z-01' });
   */
  issuers({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuers`, 'GET', { query: { branch } });
  }

  /**
   * Apply cert issuers to the cluster (optionally saving the given list first).
   * @param {object} params - container, name, branch, certIssuers? (array to save then apply).
   * @returns {Promise<{ success, applied, details, errors, note? }>}
   * @example await sdk.clusters.certs.applyIssuers({ container:'app1', name:'z-01' });
   */
  applyIssuers({ container, name, certIssuers, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuers`, 'POST', { body: { certIssuers }, query: { branch } });
  }

  /**
   * Save (persist) the cert-issuer config without applying.
   * @param {object} params - container, name, branch, certIssuers (array, required).
   * @returns {Promise<{ success, certIssuers }>}
   * @example await sdk.clusters.certs.saveIssuers({ container:'app1', name:'z-01', certIssuers:[...] });
   */
  saveIssuers({ container, name, certIssuers, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuers`, 'PUT', { body: { certIssuers }, query: { branch } });
  }

  /**
   * Get the AWS Route53 DNS-solver secret status.
   * @param {object} params - container, name, branch, secretName? (def 'aws-route53-secret'),
   *   namespace? (def 'cert-manager').
   * @returns {Promise<{ exists, namespace, secretName, accessKeyId? }>}
   * @example const c = await sdk.clusters.certs.issuerCreds({ container:'app1', name:'z-01' });
   */
  issuerCreds({ container, name, secretName, namespace, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuer-creds`, 'GET', { query: { secretName, namespace, branch } });
  }

  /**
   * Set / rotate the AWS Route53 DNS-solver secret.
   * @param {object} params - container, name, branch, secretName?, namespace?, accessKeyId?, secretAccessKey?.
   * @returns {Promise<{ success, namespace, secretName, accessKeyId, rotated }>}
   * @example await sdk.clusters.certs.setIssuerCreds({ container:'app1', name:'z-01', accessKeyId, secretAccessKey });
   */
  setIssuerCreds({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuer-creds`, 'POST', { body, query: { branch } });
  }

  /**
   * Get the GCP Cloud DNS solver secret status.
   * @param {object} params - container, name, branch, secretName? (def 'CLOUDDNS_SECRET'),
   *   namespace? (def 'cert-manager'), gcpAccountId?.
   * @returns {Promise<{ exists, namespace, secretName, clientEmail, projectId }>}
   * @example const c = await sdk.clusters.certs.issuerGcpCreds({ container:'app1', name:'z-03' });
   */
  issuerGcpCreds({ container, name, secretName, namespace, gcpAccountId, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuer-gcp-creds`, 'GET', { query: { secretName, namespace, gcpAccountId, branch } });
  }

  /**
   * Set the GCP Cloud DNS solver secret (from a registered GCP account).
   * @param {object} params - container, name, branch, secretName?, namespace?, gcpAccountId.
   * @returns {Promise<{ success, namespace, secretName, projectId, clientEmail }>}
   * @example await sdk.clusters.certs.setIssuerGcpCreds({ container:'app1', name:'z-03', gcpAccountId:'proj-1' });
   */
  setIssuerGcpCreds({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuer-gcp-creds`, 'POST', { body, query: { branch } });
  }

  /**
   * Read Route53 IAM-user state for the AWS solver. Action-dispatched.
   * @param {object} params - container, name, branch, action (def 'describe'), and for
   *   describe: namespace? (def 'cert-manager'), secretName? (def 'aws-route53-secret').
   *   Actions: 'describe' | 'list-existing' | 'list-all-users' | 'policy-preview'.
   * @returns {Promise<object>} Shape varies by action (describe → user info + secret; list-* → { users }; policy-preview → { policyName, defaultUserName, policyDocument, tags }).
   * @example const info = await sdk.clusters.certs.issuerIam({ container:'app1', name:'z-01', action:'describe' });
   */
  issuerIam({ container, name, action, namespace, secretName, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuer-iam`, 'GET', { query: { action, namespace, secretName, branch } });
  }

  /**
   * Manage the Route53 IAM user. Action-dispatched.
   * @param {object} params - container, name, branch + body: action ('create-user' |
   *   'attach-existing' | 'generate-keys'), zoneAccountId?, hostedZoneIds?, userName?,
   *   writeSecret?, namespace?, secretName?.
   * @returns {Promise<{ success, ... }>} For generate-keys includes `{ accessKeyId, secretAccessKey, secret }`.
   * @example await sdk.clusters.certs.manageIssuerIam({ container:'app1', name:'z-01', action:'create-user', hostedZoneIds:['Z...'] });
   */
  manageIssuerIam({ container, name, branch, ...body }) {
    return this.sdk._fetch(`${this._base(container, name)}/cert-issuer-iam`, 'POST', { body, query: { branch } });
  }

  /**
   * List the cluster's installed addons vs. the Zeus catalog (EKS-only).
   * @returns {Promise<{ addons: Array<{ name, installed, version, status, health, healthIssues, inZeusCatalog, catalogEntry, availableVersions, defaultVersion, updateAvailable }> }>}
   * @example const { addons } = await sdk.clusters.certs.addonsLive({ container:'app1', name:'z-01' });
   */
  addonsLive({ container, name, branch }) {
    return this.sdk._fetch(`${this._base(container, name)}/addons-live`, 'GET', { query: { branch } });
  }
}
