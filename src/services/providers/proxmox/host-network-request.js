// @ts-nocheck
/**
 * Body builder for POST .../host-networks.
 *
 * The route scopes a plan or apply by the fields in this body. Dropping
 * `nodes`, or ignoring an option the caller meant as a scope, applies the
 * change to every member. Unknown keys and an empty or invalid `nodes`
 * list throw before any request is sent.
 */

export class HostNetworkOptionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostNetworkOptionError';
  }
}

/**
 * Fields the host-networks POST route reads, per action. `id` is the
 * account path, not a body field. A field that belongs to a different
 * action (for example `node` on `apply`, which is the remap field) is
 * unknown: the route would ignore it and the call would hit every host.
 * Stream callbacks (`onMessage`, `onDone`, …) are not body fields —
 * assign them on the handle returned by `hostNetworksStream`.
 */
export const HOST_NETWORK_FIELDS_BY_ACTION = Object.freeze({
  save: Object.freeze(['action', 'network']),
  'remap-candidates': Object.freeze(['action', 'name']),
  remap: Object.freeze(['action', 'name', 'node', 'ifname', 'commit']),
  plan: Object.freeze(['action', 'name', 'scope', 'rollbackSeconds', 'nodes', 'planId']),
  confirm: Object.freeze(['action', 'name']),
  apply: Object.freeze(['action', 'name', 'planId', 'scope', 'rollbackSeconds', 'nodes']),
  teardown: Object.freeze(['action', 'name']),
  delete: Object.freeze(['action', 'name'])
});

export const HOST_NETWORK_BODY_FIELDS = Object.freeze(
  [...new Set(Object.values(HOST_NETWORK_FIELDS_BY_ACTION).flat())]
);

const REFUSAL = 'Refusing the call so it cannot apply to every host.';

/**
 * @param {unknown} nodes
 * @returns {string[]}
 */
export function hostNetworkNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new HostNetworkOptionError(`nodes must be an array of non-empty strings. ${REFUSAL}`);
  }
  const out = [];
  const seen = new Set();
  for (const node of nodes) {
    if (typeof node !== 'string') {
      throw new HostNetworkOptionError(`nodes must be an array of non-empty strings. ${REFUSAL}`);
    }
    const name = node.trim();
    if (!name) {
      throw new HostNetworkOptionError(`nodes must be an array of non-empty strings. ${REFUSAL}`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Copy the allow-listed body fields. `nodes`, when present, is validated.
 * Omitted `nodes` is left omitted (the route's explicit every-member path).
 *
 * @param {object} options
 * @returns {object}
 */
export function buildHostNetworkBody(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new HostNetworkOptionError(`host-network options must be an object. ${REFUSAL}`);
  }
  const allowedList = HOST_NETWORK_FIELDS_BY_ACTION[options.action];
  if (!allowedList) {
    throw new HostNetworkOptionError(
      `Unknown host-network action "${options.action ?? ''}". ${REFUSAL}`
    );
  }
  const allowed = new Set(allowedList);
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length) {
    const listed = unknown.map((key) => `"${key}"`).join(', ');
    const noun = unknown.length === 1 ? 'option' : 'options';
    throw new HostNetworkOptionError(`Unknown host-network ${noun} ${listed}. ${REFUSAL}`);
  }
  const body = {};
  for (const key of allowedList) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    if (key === 'nodes') {
      body.nodes = hostNetworkNodes(options.nodes);
      continue;
    }
    if (options[key] !== undefined) body[key] = options[key];
  }
  return body;
}
