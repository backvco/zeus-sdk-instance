// @ts-nocheck
/**
 * PricingService — cloud instance-price cache configuration (`sdk.settings.pricing`).
 *
 * Controls how Zeus fetches and caches AWS/GCP on-demand prices: which regions
 * to fetch, the cache directory, a daily refresh cron, and a manual refresh job.
 *
 * Routes: /api/settings/pricing, /api/settings/pricing/cron, /api/settings/pricing/refresh
 */
export class PricingService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * Get the pricing config plus the resolved cache dir and per-file freshness.
   *
   * @returns {Promise<{
   *   config: object,
   *   resolvedCacheDir: string,
   *   status: Array<{ provider: string, region: string, count: number, updatedAt: string }>,
   * }>}
   * @route GET /api/settings/pricing
   * @example
   * const { config, status } = await sdk.settings.pricing.get();
   */
  get() { return this.sdk._fetch('/settings/pricing', 'GET'); }

  /**
   * Save (validate + patch) the pricing config. Returns the same shape as get().
   *
   * @param {object} params
   * @param {string|null} [params.cacheDir] - Cache directory (null to clear/reset).
   * @param {{ enabled?: boolean, regions?: string[] }} [params.aws] - AWS settings (regions required if provided & non-empty validated).
   * @param {{ enabled?: boolean, projectId?: string|null, regions?: string[] }} [params.gcp]
   * @returns {Promise<{ config: object, resolvedCacheDir: string, status: Array<object> }>}
   * @route PUT /api/settings/pricing
   * @example
   * await sdk.settings.pricing.save({ aws: { enabled: true, regions: ['us-east-2'] } });
   */
  save({ cacheDir, aws, gcp } = {}) {
    return this.sdk._fetch('/settings/pricing', 'PUT', { body: { cacheDir, aws, gcp } });
  }

  /**
   * Get the daily-refresh cron registration status.
   *
   * @returns {Promise<{ registered: boolean, schedule: string, line: string }>}
   * @route GET /api/settings/pricing/cron
   * @example
   * const { registered } = await sdk.settings.pricing.cronStatus();
   */
  cronStatus() { return this.sdk._fetch('/settings/pricing/cron', 'GET'); }

  /**
   * Register the daily pricing-refresh cron entry (idempotent).
   *
   * @returns {Promise<{ registered: boolean, schedule: string, line: string }>}
   * @route POST /api/settings/pricing/cron
   * @example
   * await sdk.settings.pricing.registerCron();
   */
  registerCron() { return this.sdk._fetch('/settings/pricing/cron', 'POST'); }

  /**
   * Poll the current status of the manual pricing-refresh job.
   *
   * @returns {Promise<object>} Refresh status (running/completed/error + progress).
   * @route GET /api/settings/pricing/refresh
   * @example
   * const status = await sdk.settings.pricing.refreshStatus();
   */
  refreshStatus() { return this.sdk._fetch('/settings/pricing/refresh', 'GET'); }

  /**
   * Start a background pricing-cache refresh job. Returns initial running status.
   *
   * @returns {Promise<object>} Initial refresh status.
   * @route POST /api/settings/pricing/refresh
   * @example
   * await sdk.settings.pricing.startRefresh();
   */
  startRefresh() { return this.sdk._fetch('/settings/pricing/refresh', 'POST'); }
}
