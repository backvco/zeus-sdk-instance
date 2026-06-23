// @ts-nocheck
import { AuthService } from './settings/auth.js';
import { BuildersService } from './settings/builders.js';
import { GithubService } from './settings/github.js';
import { MailService } from './settings/mail.js';
import { NpmTokensService } from './settings/npm-tokens.js';
import { ServiceTokensService } from './settings/service-tokens.js';
import { PricingService } from './settings/pricing.js';
import { SystemSettingsService } from './settings/system.js';

/**
 * SettingsService — the `sdk.settings` namespace.
 *
 * Instance administration, grouped into sub-namespaces (each maps to a subtree
 * of `/api/settings/...`):
 *
 *   - `sdk.settings.auth`          — auth config, sessions, users (admin only)
 *   - `sdk.settings.builders`      — image-build infrastructure + templates + cache
 *   - `sdk.settings.github`        — stored GitHub token connections
 *   - `sdk.settings.mail`          — outbound email config (admin only)
 *   - `sdk.settings.npmTokens`     — npm/registry tokens
 *   - `sdk.settings.serviceTokens` — Zeus API service tokens (`zeus_...`)
 *   - `sdk.settings.pricing`       — cloud price-cache config + refresh/cron
 *   - `sdk.settings.system`        — instance-wide system settings doc
 *
 * @example
 * const { builders } = await sdk.settings.builders.list();
 * const { users } = await sdk.settings.auth.listUsers();
 */
export class SettingsService {
  constructor(sdk) {
    this.sdk = sdk;
    this.auth = new AuthService(sdk);
    this.builders = new BuildersService(sdk);
    this.github = new GithubService(sdk);
    this.mail = new MailService(sdk);
    this.npmTokens = new NpmTokensService(sdk);
    this.serviceTokens = new ServiceTokensService(sdk);
    this.pricing = new PricingService(sdk);
    this.system = new SystemSettingsService(sdk);
  }
}
