// @ts-nocheck
/**
 * AgentService — zeus-agent enrollment, credential rotation, and dialer verify.
 *
 * Accessed as `sdk.agent`.
 *
 * The zeus-agent is a small process that runs on a Proxmox/bare-metal host and
 * dials out to Zeus over the zeus-dialer tunnel. These endpoints are the
 * host-side enrollment handshake and the internal authorization callback:
 *
 *   - `enroll` (claim → complete) — a host installer beacons with a SITE token
 *     (the token IS the auth; reusable across every host in the site, NOT
 *     consumed), then completes by submitting facts and receives a durable
 *     `{ agentId, agentSecret }` credential.
 *   - `rekey` — an enrolled agent rotates its own secret, authenticating with
 *     its current one (works over plain HTTP, independent of the WS channel).
 *   - `verifyDialer` — INTERNAL: the zeus-dialer sidecar authorizes a connecting
 *     agent. Guarded by the shared `ZEUS_DIALER_SECRET` (`x-dialer-secret`
 *     header), not session auth.
 *
 * Note: these routes are anonymous to the session layer — the token/secret is
 * the auth — but going through the SDK still attaches any configured token/devKey.
 */
export class AgentService {
	constructor(sdk) {
		this.sdk = sdk;
	}

	/**
	 * Enrollment step 1 — "I'm running" beacon. Validates the site token (or a
	 * 48-hex builder spot-instance token) without consuming it.
	 *
	 * @param {object} params
	 * @param {string} params.token - Proxmox site enroll token (or builder token).
	 * @returns {Promise<{ ok: true }>}
	 * @example
	 * await sdk.agent.claim({ token: 'site-enroll-token' });
	 */
	claim({ token }) {
		return this.sdk._fetch('/agent/enroll/claim', 'POST', { body: { token } });
	}

	/**
	 * Enrollment step 2 — submit host facts; Zeus adds the host to the token's
	 * site and mints a durable agent credential. Builder tokens (48 hex) return a
	 * `siteId` of `'__builder__'`.
	 *
	 * @param {object} params
	 * @param {string} params.token      - Site (or builder) enroll token.
	 * @param {string} [params.hostname] - Host's reported hostname.
	 * @param {object} [params.facts]    - Gathered host facts (cpu/mem/net/etc.).
	 * @returns {Promise<{ agentId: string, agentSecret: string, siteId: string }>}
	 * @example
	 * const cred = await sdk.agent.complete({ token, hostname: 'pve-01', facts });
	 * // → { agentId: 'h-abc', agentSecret: '...', siteId: 'site-1' }
	 */
	complete({ token, hostname, facts }) {
		return this.sdk._fetch('/agent/enroll/complete', 'POST', {
			body: { token, hostname, facts }
		});
	}

	/**
	 * Rotate an enrolled agent's secret. Authenticates with the CURRENT secret;
	 * on success Zeus mints, persists (encrypted), and returns a new one.
	 *
	 * @param {object} params
	 * @param {string} params.siteId        - The agent's site id.
	 * @param {string} params.agentId        - The agent (host) id.
	 * @param {string} params.currentSecret  - The agent's current secret (auth).
	 * @returns {Promise<{ agentSecret: string, agentId: string, siteId: string }>}
	 * @example
	 * const { agentSecret } = await sdk.agent.rekey({ siteId, agentId, currentSecret });
	 */
	rekey({ siteId, agentId, currentSecret }) {
		return this.sdk._fetch('/agent/rekey', 'POST', {
			body: { siteId, agentId, currentSecret }
		});
	}

	/**
	 * INTERNAL — authorize a connecting agent (called by the zeus-dialer sidecar).
	 * Requires the shared dialer secret via the `x-dialer-secret` header; pass it
	 * as `dialerSecret` (set on the header for you) or via `headers`. Returns
	 * `{ ok:false }` with a 401/503 (which the SDK raises as a ZeusApiError) when
	 * unauthorized or when the server has no `ZEUS_DIALER_SECRET` configured.
	 *
	 * @param {object} params
	 * @param {string} params.siteId        - Agent's site id (`'__builder__'` for builder agents).
	 * @param {string} params.agentId        - Agent (host) id.
	 * @param {string} params.secret         - Agent secret to verify.
	 * @param {string} [params.dialerSecret]  - Shared dialer secret → `x-dialer-secret` header.
	 * @param {object} [params.headers]       - Extra headers (use to set `x-dialer-secret` directly).
	 * @returns {Promise<{ ok: boolean, error?: string }>}
	 * @example
	 * const { ok } = await sdk.agent.verifyDialer({
	 *   siteId, agentId, secret, dialerSecret: process.env.ZEUS_DIALER_SECRET
	 * });
	 */
	verifyDialer({ siteId, agentId, secret, dialerSecret, headers = {} }) {
		const h = { ...headers };
		if (dialerSecret && !h['x-dialer-secret']) h['x-dialer-secret'] = dialerSecret;
		return this.sdk._fetch('/internal/agent/verify', 'POST', {
			body: { siteId, agentId, secret },
			headers: h
		});
	}
}
