# `sdk.help` — in-app AI assistant

`HelpService` covers `/api/help/**`: the provider-agnostic help assistant
(Anthropic / OpenAI / Grok / Google) — a streaming chat turn, per-user saved
sessions, and provider settings. Non-streaming methods return the route's
literal JSON and throw on HTTP 4xx/5xx; `chat()` returns an SSE handle.

| Method | Route | Notes |
|--------|-------|-------|
| `chat({ messages, signal? })` | POST `/help/chat` **[SSE]** | Run one agent turn. Needs auth + a configured provider key. See events below |
| `listSessions()` | GET `/help/sessions` | → `{ sessions:[{ id, title, createdAt, updatedAt, messageCount }] }` (current user, newest first) |
| `saveSession({ id, title?, messages?, createdAt? })` | POST `/help/sessions` | → `{ id, title, createdAt, updatedAt, messageCount }`. Ownership from auth, never body |
| `getSession({ id })` | GET `/help/sessions/[id]` | → full session `{ id, userId, title, createdAt, updatedAt, messages }`. Foreign/missing → 404 |
| `renameSession({ id, title })` | PATCH `/help/sessions/[id]` | → updated metadata. Blank title resets to auto-derived |
| `deleteSession({ id })` | DELETE `/help/sessions/[id]` | → `{ ok: true }` (idempotent; foreign/missing is a no-op) |
| `settings()` | GET `/help/settings` | → `{ provider, providers:{ [id]:{ hasKey, keyPreview, model } } }` (keys masked) |
| `updateSettings({ provider?, providers? })` | PATCH `/help/settings` | → same shape as `settings()`. Empty-string `apiKey` clears the stored key |

## `chat()` — SSE

Streaming is required: a tool-calling turn can exceed nginx's sync window.
`messages` must be non-empty. Errors (no auth / no provider key) surface as a
`ZeusStreamError` with a 400/401 status.

### Event `data` shapes
| `type` | payload | meaning |
|--------|---------|---------|
| `step` | `{ phase:'thinking'|'tool'|'answering', name? }` | live progress |
| `done` | `{ text, turns }` | final answer + turn count |
| `error` | `{ message }` | fatal error |

```js
const s = sdk.help.chat({ messages: [{ role: 'user', content: 'How many clusters?' }] });
s.onMessage = (ev) => { if (ev.type === 'done') console.log(ev.data.text); };

// sessions + settings
await sdk.help.updateSettings({ provider: 'anthropic', providers: { anthropic: { apiKey: 'sk-...' } } });
const meta = await sdk.help.saveSession({ id: 'c1', messages });
const { sessions } = await sdk.help.listSessions();
```
