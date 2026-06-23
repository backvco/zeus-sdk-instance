# `sdk.alerts` — active cluster alerts

`AlertsService` covers `/api/alerts/**`: the active-alert feed raised
server-side by detectors (connectivity poll, pod health, reachability, agent
tunnel). Read + manual-dismiss, plus the connectivity reconcile hook. Each
method returns the route's literal JSON and throws on HTTP 4xx/5xx.

| Method | Route | Notes |
|--------|-------|-------|
| `list()` | GET `/alerts` | → `{ alerts: [...] }` currently-active alerts |
| `clear({ type, key })` | POST `/alerts` `action:'clear'` | → `{ cleared: boolean }`; `cleared:false` if no match. 400 if type/key missing |
| `connectivity({ findings })` | POST `/alerts/connectivity` | → `{ ok: true }`. Reconciles connectivity alerts from a poll's flat findings list (`[{ type, key, ctx }]`); also re-reads agent-tunnel state. Each finding's `type` is both the reason code and the alert-type id |

```js
const { alerts } = await sdk.alerts.list();
await sdk.alerts.clear({ type: 'pod-crashloop', key: 'z-02/default/api' });
await sdk.alerts.connectivity({
  findings: [{ type: 'edge-degraded', key: 'z-01↔z-02', ctx: { lossPct: 12 } }]
});
```
