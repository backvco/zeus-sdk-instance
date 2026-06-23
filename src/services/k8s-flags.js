// @ts-nocheck
/**
 * K8sFlagsService — event flags, accessed as `sdk.k8s.flags`.
 *
 * An "event flag" is an operator-authored marker on a Kubernetes event (an
 * incident note / triage record persisted by Zeus, not a K8s object). Lifecycle:
 * {@link create} a flag from an event, {@link list}/{@link get} it, then
 * {@link update} it (resolve / reopen) or {@link delete} it.
 */
export class K8sFlagsService {
  constructor(sdk) { this.sdk = sdk; }

  /**
   * List event flags, newest-first.
   *
   * @param {object} [params]
   * @param {string} [params.status='all'] - 'open' | 'resolved' | 'all'.
   * @param {string} [params.cluster]      - Filter by cluster.
   * @param {string} [params.container]    - Filter by container.
   * @returns {Promise<{ flags: Array<object> }>}
   * @example
   * const { flags } = await sdk.k8s.flags.list({ status: 'open', cluster: 'z-01' });
   */
  list({ status, cluster, container } = {}) {
    return this.sdk._fetch('/k8s/event-flags', 'GET', { query: { status, cluster, container } });
  }

  /**
   * Create an event flag.
   *
   * @param {object} params
   * @param {object} params.event       - The K8s event being flagged (required).
   * @param {string} params.cluster     - Cluster the event is on (required).
   * @param {string} [params.container] - Owning container.
   * @param {string} [params.note]      - Free-text note.
   * @returns {Promise<{ flag: object }>}
   * @example
   * await sdk.k8s.flags.create({ event, cluster: 'z-01', note: 'investigate OOMKills' });
   */
  create({ event, cluster, container, note } = {}) {
    return this.sdk._fetch('/k8s/event-flags', 'POST', { body: { event, cluster, container, note } });
  }

  /**
   * Fetch one event flag by id.
   *
   * @param {object} params
   * @param {string} params.id - Flag id.
   * @returns {Promise<{ flag: object }>}
   * @example
   * const { flag } = await sdk.k8s.flags.get({ id: 'flg_123' });
   */
  get({ id } = {}) {
    return this.sdk._fetch(`/k8s/event-flags/${encodeURIComponent(id)}`, 'GET');
  }

  /**
   * Update an event flag — resolve or reopen it.
   *
   * @param {object} params
   * @param {string} params.id                 - Flag id.
   * @param {string} [params.action='resolve'] - 'resolve' | 'reopen'.
   * @param {string} [params.resolutionNote]   - Note when resolving.
   * @returns {Promise<{ flag: object }>}
   * @example
   * await sdk.k8s.flags.update({ id: 'flg_123', action: 'resolve', resolutionNote: 'transient' });
   */
  update({ id, action, resolutionNote } = {}) {
    return this.sdk._fetch(`/k8s/event-flags/${encodeURIComponent(id)}`, 'PATCH', {
      body: { action, resolutionNote },
    });
  }

  /**
   * Delete an event flag.
   *
   * @param {object} params
   * @param {string} params.id - Flag id.
   * @returns {Promise<{ ok: true }>}
   * @example
   * await sdk.k8s.flags.delete({ id: 'flg_123' });
   */
  delete({ id } = {}) {
    return this.sdk._fetch(`/k8s/event-flags/${encodeURIComponent(id)}`, 'DELETE');
  }
}
