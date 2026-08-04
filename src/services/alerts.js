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
	 * List currently-active alerts, plus their collaboration metadata
	 * (assignment/discussion, keyed by alert id).
	 *
	 * @returns {Promise<{ alerts: Array<object>, meta: object }>}
	 * @example
	 * const { alerts, meta } = await sdk.alerts.list();
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
	 * @param {string} [params.reason] - Optional free-text reason (max 500 chars), recorded to history + posted as a system comment.
	 * @returns {Promise<{ cleared: boolean }>} `cleared` is false if no matching alert existed.
	 * @example
	 * const { cleared } = await sdk.alerts.clear({ type: 'pod-crashloop', key: 'z-02/default/api' });
	 */
	clear({ type, key, reason }) {
		return this.sdk._fetch('/alerts', 'POST', { body: { action: 'clear', type, key, reason } });
	}

	/**
	 * Manually dismiss several active alerts at once (POST with action='clearMany').
	 *
	 * @param {object} params
	 * @param {Array<{ type: string, key: string }>} params.alerts - Alerts to clear (max 200).
	 * @param {string} [params.reason] - Optional free-text reason (max 500 chars), applied to every cleared alert.
	 * @returns {Promise<{ cleared: number }>} Count of alerts actually cleared.
	 * @example
	 * const { cleared } = await sdk.alerts.clearMany({ alerts: [{ type: 'pod-crashloop', key: 'z-02/default/api' }] });
	 */
	clearMany({ alerts, reason }) {
		return this.sdk._fetch('/alerts', 'POST', { body: { action: 'clearMany', alerts, reason } });
	}

	/**
	 * Assign (or unassign, with a null/omitted assigneeId) an alert to a user.
	 *
	 * @param {object} params
	 * @param {string} params.id - Alert id (`${type}::${key}`).
	 * @param {string|null} [params.assigneeId] - User id to assign, or null to clear.
	 * @returns {Promise<{ meta: object }>} The updated per-alert metadata entry.
	 * @example
	 * const { meta } = await sdk.alerts.assign({ id: 'pod-crashloop::z-02/default/api', assigneeId: 'u_123' });
	 */
	assign({ id, assigneeId }) {
		return this.sdk._fetch('/alerts/meta', 'POST', { body: { action: 'assign', id, assigneeId } });
	}

	/**
	 * Add a discussion comment to an alert.
	 *
	 * @param {object} params
	 * @param {string} params.id - Alert id (`${type}::${key}`).
	 * @param {string} params.text - Comment text (1-4000 chars).
	 * @returns {Promise<{ comment: object }>} The created comment.
	 * @example
	 * const { comment } = await sdk.alerts.comment({ id: 'pod-crashloop::z-02/default/api', text: 'investigating' });
	 */
	comment({ id, text }) {
		return this.sdk._fetch('/alerts/meta', 'POST', { body: { action: 'comment', id, text } });
	}

	/**
	 * Edit a discussion comment's text. Author-only — the server rejects
	 * (403) an edit from anyone but the comment's original author.
	 *
	 * @param {object} params
	 * @param {string} params.id - Alert id (`${type}::${key}`).
	 * @param {string} params.commentId - Comment id to edit.
	 * @param {string} params.text - New comment text (1-4000 chars).
	 * @returns {Promise<{ comment: object }>} The updated comment.
	 * @example
	 * const { comment } = await sdk.alerts.editComment({ id: 'pod-crashloop::z-02/default/api', commentId: 'c_1', text: 'update' });
	 */
	editComment({ id, commentId, text }) {
		return this.sdk._fetch('/alerts/meta', 'POST', { body: { action: 'editComment', id, commentId, text } });
	}

	/**
	 * Delete a discussion comment. Allowed for the comment's author or an admin.
	 *
	 * @param {object} params
	 * @param {string} params.id - Alert id (`${type}::${key}`).
	 * @param {string} params.commentId - Comment id to delete.
	 * @returns {Promise<{ deleted: true }>}
	 * @example
	 * await sdk.alerts.deleteComment({ id: 'pod-crashloop::z-02/default/api', commentId: 'c_1' });
	 */
	deleteComment({ id, commentId }) {
		return this.sdk._fetch('/alerts/meta', 'POST', { body: { action: 'deleteComment', id, commentId } });
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

	/**
	 * Durable alert history (raised/cleared events), newest first.
	 *
	 * @param {object} [params]
	 * @param {string} [params.q] - Search title/type/key.
	 * @param {string} [params.severity] - Filter by severity.
	 * @param {string} [params.assignee] - Filter by assignee user id, or `'unassigned'` for events with no assignee.
	 * @param {number} [params.limit] - Max rows (default 200, max 1000).
	 * @returns {Promise<{ history: Array<object> }>}
	 * @example
	 * const { history } = await sdk.alerts.history({ severity: 'critical', limit: 50 });
	 */
	history({ q, severity, assignee, limit } = {}) {
		return this.sdk._fetch('/alerts/history', 'GET', { query: { q, severity, assignee, limit } });
	}
}
