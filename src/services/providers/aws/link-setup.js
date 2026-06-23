// @ts-nocheck
/**
 * AwsLinkSetupService — CLI-driven account linking + permission "fix" flows.
 *
 * Accessed as `sdk.providers.aws.linkSetup`.
 *
 * Both flows hand the operator a one-line `curl … | bash` command bound to a
 * single-use token. A locally-run bootstrap script creates an IAM machine user
 * (link) or attaches missing tier policies (fix) in the target AWS account, then
 * beacons back to Zeus. The browser polls `*status` until the token completes.
 *
 *   - **link** — `init` → operator runs the command → `claim` (CLI beacon) →
 *     `complete` (CLI posts keys) → `init`'s caller polls `status`.
 *   - **fix**  — `setup/fix/init` (admin, pick tiers) → `claim` → `complete` →
 *     poll `status`. `claim`/`complete` are anonymous (token IS the auth).
 */
export class AwsLinkSetupService {
  constructor(sdk) { this.sdk = sdk; }

  // ── Account link ────────────────────────────────────────────

  /**
   * Start a CLI account-link flow. Issues a single-use pairing token bound to
   * the authenticated user and returns the exact `curl … | bash` command.
   *
   * @returns {Promise<{ token: string, expiresAt: string, command: string, zeusUrl: string }>}
   * @example
   * const { command, token } = await sdk.providers.aws.linkSetup.linkInit();
   * // print `command` for the operator to run, then poll linkStatus({ token })
   */
  linkInit() { return this.sdk._fetch('/providers/aws/accounts/link/init', 'POST'); }

  /**
   * CLI "I'm running" beacon — flips a pending token to claimed. Anonymous
   * (the token is the auth); normally called by the bootstrap script, not the UI.
   *
   * @param {object} params
   * @param {string} params.token - The pairing token.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.aws.linkSetup.linkClaim({ token });
   */
  linkClaim({ token }) {
    return this.sdk._fetch('/providers/aws/accounts/link/claim', 'POST', { body: { token } });
  }

  /**
   * CLI completion beacon — posts the freshly-created IAM keys to register the
   * account. Anonymous (token is the auth). Persists before consuming the token.
   *
   * @param {object} params
   * @param {string} params.token         - The pairing token.
   * @param {string} params.accountId     - 12-digit AWS account id.
   * @param {string} [params.alias]        - Account alias (defaults to `cli-<accountId>`).
   * @param {string} params.accessKeyId    - IAM access key id.
   * @param {string} params.secretAccessKey - IAM secret access key.
   * @param {string} [params.defaultRegion='us-east-1'] - Default region.
   * @param {string} [params.callerArn]    - STS caller ARN (records lastVerified).
   * @returns {Promise<{ ok: true, account: object }>}
   * @example
   * await sdk.providers.aws.linkSetup.linkComplete({ token, accountId: '111122223333', accessKeyId, secretAccessKey });
   */
  linkComplete({ token, accountId, alias, accessKeyId, secretAccessKey, defaultRegion, callerArn }) {
    return this.sdk._fetch('/providers/aws/accounts/link/complete', 'POST', {
      body: { token, accountId, alias, accessKeyId, secretAccessKey, defaultRegion, callerArn },
    });
  }

  /**
   * Poll an in-flight link flow's status. The UI hits this ~every 2s while the
   * operator runs the CLI command.
   *
   * @param {object} params
   * @param {string} params.token - The pairing token.
   * @returns {Promise<{ status: string, expiresAt?: string, claimedAt?: string, result?: object, error?: string }>}
   * @example
   * const { status } = await sdk.providers.aws.linkSetup.linkStatus({ token }); // 'pending'|'claimed'|'completed'|'failed'
   */
  linkStatus({ token }) {
    return this.sdk._fetch('/providers/aws/accounts/link/status', 'GET', { query: { token } });
  }

  // ── Permission fix flow ─────────────────────────────────────

  /**
   * Start an AWS "fix permissions" session (admin). Returns the one-time token +
   * the copy-paste `curl … | bash` command that attaches the selected tier policies.
   *
   * @param {object} params
   * @param {string[]} params.tiers      - Tier ids to fix (from {@link AwsService.setupTiers}).
   * @param {string} [params.accountId]  - Linked account id to target.
   * @param {string} [params.userName]   - IAM machine-user name (default 'zeus-machine-user').
   * @returns {Promise<{ token: string, expiresAt: string, command: string }>}
   * @example
   * const { command } = await sdk.providers.aws.linkSetup.fixInit({ tiers: ['node-groups'], accountId: '111122223333' });
   */
  fixInit({ tiers, accountId, userName }) {
    return this.sdk._fetch('/providers/aws/setup/fix/init', 'POST', { body: { tiers, accountId, userName } });
  }

  /**
   * CLI claim for the fix flow (anonymous; token is the auth). Returns the
   * selected tiers + expected account so the script knows what to apply.
   *
   * @param {object} params
   * @param {string} params.token - The fix-session token.
   * @returns {Promise<{ tiers: string[], accountId: string|null, userName: string }>}
   * @example
   * const { tiers } = await sdk.providers.aws.linkSetup.fixClaim({ token });
   */
  fixClaim({ token }) {
    return this.sdk._fetch('/providers/aws/setup/fix/claim', 'POST', { body: { token } });
  }

  /**
   * CLI completion beacon for the fix flow (anonymous; token is the auth).
   *
   * @param {object} params
   * @param {string} params.token   - The fix-session token.
   * @param {string} [params.error] - Error string if the apply failed.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.providers.aws.linkSetup.fixComplete({ token });
   */
  fixComplete({ token, error }) {
    return this.sdk._fetch('/providers/aws/setup/fix/complete', 'POST', { body: { token, error } });
  }

  /**
   * Poll a fix session's status (admin). The UI watches for done/error.
   *
   * @param {object} params
   * @param {string} params.token - The fix-session token.
   * @returns {Promise<{ status: string, error?: string }>}
   * @example
   * const s = await sdk.providers.aws.linkSetup.fixStatus({ token });
   */
  fixStatus({ token }) {
    return this.sdk._fetch('/providers/aws/setup/fix/status', 'GET', { query: { token } });
  }
}
