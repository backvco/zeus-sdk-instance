// @ts-nocheck
/**
 * ReplicationService — the MySQL InnoDB ClusterSet replication board.
 *
 * Accessed as `sdk.replication`.
 *
 * Utility route (not container-scoped in the path) — every method sends
 * `container` in the POST body per the v2configs utility-route convention.
 *
 * Typical lifecycle:
 *   1. {@link discover}   — cheap, config-only pass over every set in the container.
 *   2. {@link status}     — full live status for one set (probes every member).
 *   3. {@link setMetrics} — {@link status} plus a Prometheus snapshot per member;
 *      the bot/AI-assistant surface for "what's the replication lag / health of set X".
 */
export class ReplicationService {
	constructor(sdk) {
		this.sdk = sdk;
	}

	_base() {
		return '/v2configs/replication/mysql';
	}

	/**
	 * Cheap, config-only pass. Returns every replication set in the container
	 * grouped by name, with members (intent, not live). Fast enough for an
	 * index page; no cluster probing.
	 *
	 * @param {string} container - Container name.
	 * @returns {Promise<{ container: string, sets: Array<{ setName: string, memberCount: number, clusters: string[], intendedPrimary: string|null, members: object[] }> }>}
	 * @example
	 * const { sets } = await sdk.replication.discover('app1');
	 */
	discover(container) {
		return this.sdk._fetch(this._base(), 'POST', { body: { action: 'discover', container } });
	}

	/**
	 * Full live status for one set. Probes every member concurrently (partial
	 * failure is normal) and rolls them up to one health verdict.
	 *
	 * @param {string} container - Container name.
	 * @param {string} setName   - Replication set name.
	 * @returns {Promise<{ container: string, setName: string, members: object[], health: string, primaryName: string|null, intendedPrimaryName: string|null, autoFailover: object, domainName: string|null, writeEndpoint: object|null }>}
	 * @example
	 * const st = await sdk.replication.status('app1', 'orders');
	 */
	status(container, setName) {
		return this.sdk._fetch(this._base(), 'POST', { body: { action: 'status', container, setName } });
	}

	/**
	 * One call answers "what's the replication lag / health of set X" —
	 * resolves members itself, then pulls a Prometheus metrics snapshot per
	 * member concurrently (a member with Prometheus down just gets
	 * `metricsAvailable: false`, never a failed call). Returns a compact body
	 * (heavy per-member probe fields from {@link status} are stripped).
	 * Designed for AI-assistant tool use.
	 *
	 * @param {string} container - Container name.
	 * @param {string} setName   - Replication set name.
	 * @param {object} [opts]
	 * @param {string[]} [opts.keys] - Metric keys to pull per member (default: a fixed operator-relevant set — replicationLag, grApplyLag, grQueues, qps, activeConnections, slowQueries, bufferPoolHitRatio).
	 * @returns {Promise<{ setName: string, health: string, primaryName: string|null, intendedPrimaryName: string|null, members: Array<{ clusterName: string, role: string, intendedRole: string, reachability: string, onlineInstances: number|null, totalInstances: number|null, lagSeconds: number|null, engineId: string, metricsAvailable: boolean, metrics: Record<string, { current: number|null, series: Array<{ labels: object, current: number|null }> }> }> }>}
	 * @example
	 * const m = await sdk.replication.setMetrics('app1', 'orders');
	 * // → { setName: 'orders', health: 'healthy', members: [{ clusterName: 'z-01', metricsAvailable: true, metrics: { qps: { current: 42, series: [...] } }, ... }] }
	 */
	setMetrics(container, setName, { keys } = {}) {
		return this.sdk._fetch(this._base(), 'POST', { body: { action: 'set-metrics', container, setName, keys } });
	}
}
