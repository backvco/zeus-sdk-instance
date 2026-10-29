// @ts-nocheck
/**
 * ReplicationService — replication board reads, a read-only ClickHouse
 * rebuild plan (`planClickhouseRebuild`), and planned MySQL primary moves
 * (`previewMysqlSetPrimary` / `setMysqlPrimaryInstance`,
 * `previewMysqlSwitchover` / `switchoverMysql`). discover/status/setMetrics
 * stay on the mysql route; the ClickHouse plan posts to
 * `/v2configs/replication/clickhouse`.
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

	/**
	 * Read-only ClickHouse rebuild plan for one shard replica. Posts to the
	 * clickhouse replication route (not the mysql base). Never mutates the
	 * replica, Keeper, or any volume — applying a rebuild is a separate
	 * operator action.
	 *
	 * @param {string} container
	 * @param {string} setName
	 * @param {string} targetCluster - Member cluster to plan a rebuild for (e.g. "z-02").
	 * @returns {Promise<object>} plan body: blocked, steps, warnings, guidance, autoRebuild:false
	 * @example
	 * const plan = await sdk.replication.planClickhouseRebuild('app1', 'ch-01', 'z-02');
	 */
	planClickhouseRebuild(container, setName, targetCluster) {
		return this.sdk._fetch('/v2configs/replication/clickhouse', 'POST', {
			body: { action: 'rebuild-plan', container, setName, params: { targetCluster } }
		});
	}

	/**
	 * Per-pod roster for one MySQL set: Group Replication role and state,
	 * ClusterSet role, lag, Kubernetes node, and Proxmox host.
	 *
	 * @param {string} container
	 * @param {string} setName
	 * @param {string} [branch='main']
	 * @returns {Promise<{ container: string, setName: string, clusters: object[] }>}
	 * @example
	 * const roster = await sdk.replication.instanceRoster('app1', 'mysql-01');
	 */
	instanceRoster(container, setName, branch = 'main') {
		return this.sdk._fetch(this._base(), 'POST', { body: { action: 'instance-roster', container, setName, branch } });
	}

	/**
	 * Read-only preview of a within-cluster primary promotion. `safeToConfirm`
	 * is true only when the target is ONLINE, caught up, and on a different
	 * host than the current primary.
	 *
	 * @param {object} params
	 * @param {string} params.container
	 * @param {string} params.clusterName
	 * @param {string} params.namespace
	 * @param {string} params.name InnoDBCluster / release name
	 * @param {number} params.idx member ordinal (`${name}-${idx}`)
	 * @returns {Promise<{ action: string, preview: { safeToConfirm: boolean, refusal: string|null, checks: object[], pod: string } }>}
	 * @example
	 * const { preview } = await sdk.replication.previewMysqlSetPrimary({ container: 'app1', clusterName: 'z-02', namespace: 'db', name: 'mysql', idx: 1 });
	 */
	previewMysqlSetPrimary({ container, clusterName, namespace, name, idx }) {
		return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/infrastructure/mysql-recovery`, 'POST', {
			body: { action: 'set-primary-instance-preview', clusterName, namespace, name, idx }
		});
	}

	/**
	 * Promote one Group Replication member to primary. SSE. The server refuses
	 * unless a fresh preview is safe and `confirmMember` equals `${name}-${idx}`.
	 *
	 * @param {object} params
	 * @param {string} params.container
	 * @param {string} params.clusterName
	 * @param {string} params.namespace
	 * @param {string} params.name
	 * @param {number} params.idx
	 * @param {string} params.confirmMember pod name, must equal `${name}-${idx}`
	 * @returns {ReturnType<import('../stream.js').openStream>}
	 * @example
	 * const s = sdk.replication.setMysqlPrimaryInstance({ container: 'app1', clusterName: 'z-02', namespace: 'db', name: 'mysql', idx: 1, confirmMember: 'mysql-1' });
	 */
	/**
	 * Read-only preview of a lost-node member release. `plan.safeToApply` is
	 * true only when the other members hold quorum and the node is confirmed
	 * down. The default is preview; this call does not delete anything.
	 *
	 * @param {object} params
	 * @param {string} params.container
	 * @param {string} params.clusterName
	 * @param {string} params.namespace
	 * @param {string} params.name InnoDBCluster / release name
	 * @returns {Promise<{ action: string, dryRun: true, applied: false, plan: object }>}
	 * @example
	 * const { plan } = await sdk.replication.previewLostNodeRelease({ container: 'app1', clusterName: 'z-02', namespace: 'db', name: 'mysql' });
	 */
	previewLostNodeRelease({ container, clusterName, namespace, name }) {
		return this.sdk._fetch(`/v2configs/${encodeURIComponent(container)}/infrastructure/mysql-recovery`, 'POST', {
			body: { action: 'release-lost-node', clusterName, namespace, name }
		});
	}

	/**
	 * Apply a lost-node release. SSE. Refuses unless `confirm` equals `name`
	 * and `planHash` is the token from `previewLostNodeRelease`.
	 *
	 * @param {object} params
	 * @param {string} params.container
	 * @param {string} params.clusterName
	 * @param {string} params.namespace
	 * @param {string} params.name
	 * @param {string} params.confirm InnoDBCluster name
	 * @param {string} params.planHash preview token
	 * @returns {ReturnType<import('../stream.js').openStream>}
	 * @example
	 * const s = sdk.replication.releaseLostNodePods({ container: 'app1', clusterName: 'z-02', namespace: 'db', name: 'mysql', confirm: 'mysql', planHash });
	 */
	releaseLostNodePods({ container, clusterName, namespace, name, confirm, planHash }) {
		if (confirm !== name) {
			return Promise.reject(new Error(`confirm must equal the InnoDB Cluster name ('${name}')`));
		}
		return this.sdk._stream(`/v2configs/${encodeURIComponent(container)}/infrastructure/mysql-recovery`, 'POST', {
			body: { action: 'release-lost-node', clusterName, namespace, name, dryRun: false, confirm, planHash }
		});
	}

	setMysqlPrimaryInstance({ container, clusterName, namespace, name, idx, confirmMember }) {
		return this.sdk._stream(`/v2configs/${encodeURIComponent(container)}/infrastructure/mysql-recovery`, 'POST', {
			body: { action: 'set-primary-instance', clusterName, namespace, name, idx, confirmMember }
		});
	}

	/**
	 * Read-only ClusterSet switchover preflight.
	 *
	 * @param {string} container
	 * @param {string} setName
	 * @param {string} targetCluster replica cluster to promote
	 * @returns {Promise<object>} preflight body `{ ok, checks }`
	 * @example
	 * const pre = await sdk.replication.previewMysqlSwitchover('app1', 'mysql-01', 'z-02');
	 */
	previewMysqlSwitchover(container, setName, targetCluster) {
		return this.sdk._fetch(this._base(), 'POST', {
			body: { action: 'preflight', container, setName, opAction: 'switchover', params: { targetCluster } }
		});
	}

	/**
	 * ClusterSet switchover as an SSE stream. Dry-run unless `execute` is true.
	 * The server re-runs preflight and refuses when it fails.
	 *
	 * @param {object} params
	 * @param {string} params.container
	 * @param {string} params.setName
	 * @param {string} params.targetCluster
	 * @param {boolean} [params.execute=false]
	 * @param {string} [params.confirmSetName] required when `execute` is true; must equal `setName`
	 * @param {string} [params.branch='main']
	 * @returns {ReturnType<import('../stream.js').openStream>}
	 * @example
	 * const s = sdk.replication.switchoverMysql({ container: 'app1', setName: 'mysql-01', targetCluster: 'z-02', execute: true, confirmSetName: 'mysql-01' });
	 */
	switchoverMysql({ container, setName, targetCluster, execute = false, confirmSetName, branch } = {}) {
		if (execute === true && confirmSetName !== setName) {
			return Promise.reject(new Error(`confirmSetName must equal the replication set name ('${setName}')`));
		}
		return this.sdk._stream('/v2configs/replication/mysql/action', 'POST', {
			body: { container, setName, action: 'switchover', params: { targetCluster }, execute, confirmSetName, branch }
		});
	}
}
