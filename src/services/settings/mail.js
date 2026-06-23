// @ts-nocheck
/**
 * MailService — outbound email configuration (`sdk.settings.mail`). Admin only.
 *
 * Configures how Zeus sends mail (SMTP or AWS SES). The SMTP password is never
 * returned by `get()`. `test()` sends a one-off test message to a recipient.
 *
 * Routes: /api/settings/mail/config
 */
export class MailService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Get the sanitized mail configuration (SMTP password omitted). Admin only.
   *
   * @returns {Promise<{ config: object }>}
   * @route GET /api/settings/mail/config
   * @example
   * const { config } = await sdk.settings.mail.get();
   */
  get() { return this.sdk._fetch('/settings/mail/config', 'GET'); }

  /**
   * Save the mail configuration. Admin only.
   *
   * @param {object} params
   * @param {string} params.provider - 'smtp' | 'ses'.
   * @param {string} params.fromName
   * @param {string} params.fromAddress
   * @param {object} [params.smtp] - SMTP settings ({ host, port, user, password, ... }).
   * @param {object} [params.ses] - SES settings ({ region, ... }).
   * @returns {Promise<{ config: object }>}
   * @route PUT /api/settings/mail/config
   * @example
   * await sdk.settings.mail.save({ provider: 'ses', fromName: 'Zeus', fromAddress: 'no-reply@x.com', ses: { region: 'us-east-2' } });
   */
  save({ provider, fromName, fromAddress, smtp, ses }) {
    return this.sdk._fetch('/settings/mail/config', 'PUT', { body: { provider, fromName, fromAddress, smtp, ses } });
  }

  /**
   * Send a test email to a recipient using the saved config. Admin only.
   *
   * @param {object} params
   * @param {string} params.to - Recipient address.
   * @returns {Promise<{ ok: true }>}
   * @route POST /api/settings/mail/config  (action: 'test')
   * @example
   * await sdk.settings.mail.test({ to: 'me@example.com' });
   */
  test({ to }) {
    return this.sdk._fetch('/settings/mail/config', 'POST', { body: { action: 'test', to } });
  }
}
