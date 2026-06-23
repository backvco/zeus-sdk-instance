// @ts-nocheck
/**
 * HelpService — the in-app AI assistant: streaming chat, saved sessions, settings.
 *
 * Accessed as `sdk.help`.
 *
 * Zeus ships a provider-agnostic help assistant (Anthropic / OpenAI / Grok /
 * Google) that can call read-only Zeus tools to answer questions about the
 * instance. This namespace covers:
 *   - `chat()`     — run one turn as an SSE stream (multi-step tool-calling).
 *   - sessions     — list / save / fetch / rename / delete per-user chat history.
 *   - settings     — read UI-safe settings and patch the active provider / keys.
 *
 * Typical lifecycle:
 *   1. `settings()` / `updateSettings(...)` — pick provider + store API key.
 *   2. `chat({ messages })`                 — stream a turn; collect the `done` text.
 *   3. `saveSession(...)` / `listSessions()` — persist and re-list the conversation.
 */
export class HelpService {
	constructor(sdk) {
		this.sdk = sdk;
	}

	/**
	 * Run one assistant turn as an SSE stream. The server resolves the active
	 * provider + decrypted key and runs the agent loop, forwarding progress.
	 *
	 * Event `data` payload shapes (see {@link openStream}):
	 *   - `{ type:'step',  phase:'thinking'|'tool'|'answering', name? }` — progress
	 *   - `{ type:'done',  text, turns }`                                — final answer
	 *   - `{ type:'error', message }`                                    — fatal error
	 *
	 * Streaming is required: a tool-calling turn can exceed nginx's sync window.
	 * Requires an authenticated user and a configured provider key (else the
	 * stream errors with a 400/401 ZeusStreamError).
	 *
	 * @param {object} params
	 * @param {Array<{ role: string, content: string, toolCalls?: any, toolName?: string, toolUseId?: string }>} params.messages - Conversation so far (non-empty).
	 * @param {AbortSignal} [params.signal] - Abort signal to close the stream.
	 * @returns {ReturnType<import('../stream.js').openStream>} Stream handle (async-iterable + onMessage/onDone/onError + close()).
	 * @example
	 * const s = sdk.help.chat({ messages: [{ role: 'user', content: 'How many clusters?' }] });
	 * s.onMessage = (ev) => { if (ev.type === 'done') console.log(ev.data.text); };
	 */
	chat({ messages, signal }) {
		return this.sdk._stream('/help/chat', 'POST', { body: { messages }, signal });
	}

	/**
	 * List the current user's saved chat sessions (metadata only, newest first).
	 *
	 * @returns {Promise<{ sessions: Array<{
	 *   id: string, title: string, createdAt: number|null, updatedAt: number|null, messageCount: number
	 * }> }>}
	 * @example
	 * const { sessions } = await sdk.help.listSessions();
	 */
	listSessions() {
		return this.sdk._fetch('/help/sessions', 'GET');
	}

	/**
	 * Create or update one of the current user's sessions. Ownership comes from
	 * the auth session, never the body; `createdAt` is preserved across saves.
	 *
	 * @param {object} params
	 * @param {string}  params.id           - Session id (required).
	 * @param {string}  [params.title]      - Title (auto-derived from first message if omitted/blank).
	 * @param {any[]}   [params.messages]   - Full message list.
	 * @param {number}  [params.createdAt]  - Original creation epoch ms (preserved if the session exists).
	 * @returns {Promise<{ id: string, title: string, createdAt: number, updatedAt: number, messageCount: number }>}
	 * @example
	 * const meta = await sdk.help.saveSession({ id: 'c1', messages });
	 */
	saveSession({ id, title, messages, createdAt }) {
		return this.sdk._fetch('/help/sessions', 'POST', {
			body: { id, title, messages, createdAt }
		});
	}

	/**
	 * Get one full session including messages (owner only; a session owned by
	 * another user reads as 404 → ZeusApiError).
	 *
	 * @param {object} params
	 * @param {string} params.id - Session id.
	 * @returns {Promise<{ id: string, userId: string, title: string, createdAt: number, updatedAt: number, messages: any[] }>}
	 * @example
	 * const session = await sdk.help.getSession({ id: 'c1' });
	 */
	getSession({ id }) {
		return this.sdk._fetch(`/help/sessions/${encodeURIComponent(id)}`, 'GET');
	}

	/**
	 * Rename a session (owner only). An empty/whitespace title resets to the
	 * auto-derived one.
	 *
	 * @param {object} params
	 * @param {string} params.id    - Session id.
	 * @param {string} params.title - New title.
	 * @returns {Promise<{ id: string, title: string, createdAt: number, updatedAt: number, messageCount: number }>}
	 * @example
	 * await sdk.help.renameSession({ id: 'c1', title: 'Cluster sizing chat' });
	 */
	renameSession({ id, title }) {
		return this.sdk._fetch(`/help/sessions/${encodeURIComponent(id)}`, 'PATCH', {
			body: { title }
		});
	}

	/**
	 * Delete a session (owner only; idempotent — a missing/foreign session is a
	 * no-op).
	 *
	 * @param {object} params
	 * @param {string} params.id - Session id.
	 * @returns {Promise<{ ok: true }>}
	 * @example
	 * await sdk.help.deleteSession({ id: 'c1' });
	 */
	deleteSession({ id }) {
		return this.sdk._fetch(`/help/sessions/${encodeURIComponent(id)}`, 'DELETE');
	}

	/**
	 * Get UI-safe assistant settings — API keys reduced to `{ hasKey, keyPreview }`.
	 *
	 * @returns {Promise<{
	 *   provider: string,
	 *   providers: Record<string, { hasKey: boolean, keyPreview: string, model: string }>
	 * }>}
	 * @example
	 * const { provider, providers } = await sdk.help.settings();
	 */
	settings() {
		return this.sdk._fetch('/help/settings', 'GET');
	}

	/**
	 * Patch assistant settings — switch the active provider and/or update each
	 * provider's apiKey/model. An empty-string apiKey clears the stored key.
	 * Returns the same UI-safe shape as {@link settings}.
	 *
	 * @param {object} params
	 * @param {string} [params.provider]  - Active provider id (e.g. 'anthropic').
	 * @param {Record<string, { apiKey?: string, model?: string }>} [params.providers] - Per-provider patches.
	 * @returns {Promise<{ provider: string, providers: Record<string, { hasKey: boolean, keyPreview: string, model: string }> }>}
	 * @example
	 * await sdk.help.updateSettings({
	 *   provider: 'anthropic',
	 *   providers: { anthropic: { apiKey: 'sk-...', model: 'claude-...' } }
	 * });
	 */
	updateSettings({ provider, providers }) {
		return this.sdk._fetch('/help/settings', 'PATCH', { body: { provider, providers } });
	}
}
