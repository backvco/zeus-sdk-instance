// @ts-nocheck
/**
 * AlertsService — the active cluster-alert feed.
 *
 * Accessed as `sdk.alerts`.
 *
 * Alerts are raised server-side by detectors (connectivity poll, pod health,
 * reachability, agent-tunnel state). This namespace is read + manual-dismiss,
 * plus a reconcile hook the connectivity poll posts findings into.
 *
 * Typical lifecycle:
 *   1. `list()`                       — fetch currently-active alerts.
 *   2. `clear({ type, key })`         — manually dismiss one.
 *   3. `connectivity({ findings })`   — feed the connectivity detector (poll-driven).
 */
export class AlertsService {
	constructor(sdk) {
		this.sdk = sdk;
	}

	/**
	 * List currently-active alerts.
	 *
	 * @returns {Promise<{ alerts: Array<object> }>}
	 * @example
	 * const { alerts } = await sdk.alerts.list();
	 */
	list() {
		return this.sdk._fetch('/alerts', 'GET');
	}

	/**
	 * Manually dismiss one active alert (POST with action='clear').
	 *
	 * @param {object} params
	 * @param {string} params.type - Alert type id.
	 * @param {string} params.key  - Alert instance key (the target it was raised for).
	 * @returns {Promise<{ cleared: boolean }>} `cleared` is false if no matching alert existed.
	 * @example
	 * const { cleared } = await sdk.alerts.clear({ type: 'pod-crashloop', key: 'z-02/default/api' });
	 */
	clear({ type, key }) {
		return this.sdk._fetch('/alerts', 'POST', { body: { action: 'clear', type, key } });
	}

	/**
	 * Reconcile connectivity alerts from a poll's findings. The server raises /
	 * clears alerts (and emails) authoritatively from this flat findings list,
	 * and also re-reads agent-tunnel state on the same cadence. Each finding's
	 * `type` is both the reason code and the alert-type id.
	 *
	 * @param {object} params
	 * @param {Array<{ type: string, key: string, ctx?: object }>} params.findings - Reason-driven findings.
	 * @returns {Promise<{ ok: true }>}
	 * @example
	 * await sdk.alerts.connectivity({
	 *   findings: [{ type: 'edge-degraded', key: 'z-01↔z-02', ctx: { lossPct: 12 } }]
	 * });
	 */
	connectivity({ findings }) {
		return this.sdk._fetch('/alerts/connectivity', 'POST', { body: { findings } });
	}
}
