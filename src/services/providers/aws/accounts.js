// @ts-nocheck
/**
 * AwsAccountsService — the linked-AWS-account store + verification.
 *
 * Accessed as `sdk.providers.aws.accounts`.
 *
 * An account is a set of IAM credentials Zeus uses to call AWS. CRUD + a default
 * pointer + STS-based verification. Secrets are never returned by reads. The
 * CLI-driven account-link flow lives on `sdk.providers.aws.linkSetup`.
 */
export class AwsAccountsService {
  constructor(sdk) { this.sdk = sdk; }

  _a(id) { return encodeURIComponent(id); }
  _base(id) { return `/providers/aws/accounts/${this._a(id)}`; }

  /**
   * List linked AWS accounts (sanitized — secrets are never returned).
   *
   * @returns {Promise<{ accounts: Array<object>, defaultAccountId: string|null }>}
   * @example
   * const { accounts, defaultAccountId } = await sdk.providers.aws.accounts.list();
   */
  list() { return this.sdk._fetch('/providers/aws/accounts', 'GET'); }

  /**
   * Create / update a linked AWS account.
   *
   * @param {object} params
   * @param {string} params.accountId        - 12-digit AWS account id.
   * @param {string} [params.alias]           - Short alias.
   * @param {string} [params.displayName]     - Friendly name.
   * @param {string} [params.credentialType]  - e.g. 'iam-user'.
   * @param {string} [params.accessKeyId]     - IAM access key id.
   * @param {string} [params.secretAccessKey] - IAM secret access key.
   * @param {string} [params.defaultRegion]   - Default region.
   * @returns {Promise<{ account: object }>}
   * @example
   * await sdk.providers.aws.accounts.create({ accountId: '111122223333', alias: 'prod', accessKeyId, secretAccessKey });
   */
  create(params) { return this.sdk._fetch('/providers/aws/accounts', 'POST', { body: params }); }

  /**
   * Get one linked account (sanitized).
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @returns {Promise<{ account: object }>}
   * @example
   * const { account } = await sdk.providers.aws.accounts.get({ accountId: '111122223333' });
   */
  get({ accountId }) { return this.sdk._fetch(this._base(accountId), 'GET'); }

  /**
   * Update a linked account's fields. Empty `accessKeyId`/`secretAccessKey` are
   * dropped server-side (leave the stored values as-is).
   *
   * @param {object} params
   * @param {string} params.accountId - Account id (path; wins over body).
   * @param {object} [params.fields]  - Fields to update (alias, displayName, accessKeyId, secretAccessKey, defaultRegion, …).
   * @returns {Promise<{ account: object }>}
   * @example
   * await sdk.providers.aws.accounts.update({ accountId: '111122223333', fields: { alias: 'prod-east' } });
   */
  update({ accountId, fields = {} }) { return this.sdk._fetch(this._base(accountId), 'PUT', { body: fields }); }

  /**
   * Make a linked account the default (PUT action=set-default).
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @returns {Promise<{ account: object|null, defaulted: true }>}
   * @example
   * await sdk.providers.aws.accounts.setDefault({ accountId: '111122223333' });
   */
  setDefault({ accountId }) {
    return this.sdk._fetch(this._base(accountId), 'PUT', { body: { action: 'set-default' } });
  }

  /**
   * Delete a linked account.
   *
   * @param {object} params
   * @param {string} params.accountId - Account id.
   * @param {boolean} [params.force]  - Pass true to force (?force=1).
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.aws.accounts.delete({ accountId: '111122223333', force: true });
   */
  delete({ accountId, force }) {
    return this.sdk._fetch(this._base(accountId), 'DELETE', { query: { force: force ? '1' : undefined } });
  }

  /**
   * Verify an account's credentials via STS GetCallerIdentity. Pass
   * accessKeyId/secretAccessKey to verify ad-hoc creds pre-save; omit to verify
   * the saved account. Never throws on a bad credential — returns `{ ok:false }`.
   *
   * @param {object} params
   * @param {string} params.accountId        - Account id (path).
   * @param {string} [params.accessKeyId]     - Ad-hoc key to verify (pre-save).
   * @param {string} [params.secretAccessKey] - Ad-hoc secret to verify (pre-save).
   * @param {string} [params.region]          - Region for the STS call.
   * @returns {Promise<{ ok: boolean, callerArn?: string, account?: string, matchesAccountId?: boolean|null, error?: string }>}
   * @example
   * const r = await sdk.providers.aws.accounts.verify({ accountId: '111122223333' });
   */
  verify({ accountId, accessKeyId, secretAccessKey, region }) {
    return this.sdk._fetch(`${this._base(accountId)}/verify`, 'POST', { body: { accessKeyId, secretAccessKey, region } });
  }
}
