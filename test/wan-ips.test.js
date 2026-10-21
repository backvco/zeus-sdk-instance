// @ts-nocheck
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ZeusInstanceSDK } from '../src/index.js';
import { ProxmoxAccountsService } from '../src/services/providers/proxmox/accounts.js';

/**
 * @param {(url: string, init: RequestInit) => any} handler
 */
function mockFetch(handler) {
  /** @type {Array<{ url: string, init: RequestInit }>} */
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetchImpl, calls };
}

describe('proxmox accounts WAN IP pool', () => {
  it('exposes wanIps and allocateWanIps on the accounts service', () => {
    const sdk = new ZeusInstanceSDK({ baseURL: 'https://example.test/api', fetch: async () => { throw new Error('unused'); } });
    assert.equal(typeof sdk.providers.proxmox.accounts.wanIps, 'function');
    assert.equal(typeof sdk.providers.proxmox.accounts.allocateWanIps, 'function');
    assert.equal(sdk.providers.proxmox.accounts.wanIps, ProxmoxAccountsService.prototype.wanIps);
    assert.equal(sdk.providers.proxmox.accounts.allocateWanIps, ProxmoxAccountsService.prototype.allocateWanIps);
  });

  it('GETs /providers/proxmox/accounts/:id/wan-ips and returns the pool', async () => {
    const payload = {
      capacity: { free: 2, allocated: 1, excluded: 0, totalAliases: 3 },
      free: [{ wanId: 'wan-doc', ip: '203.0.113.11', manual: false }],
      allocations: [],
      pools: [],
    };
    const { fetchImpl, calls } = mockFetch(() => payload);
    const sdk = new ZeusInstanceSDK({ baseURL: 'https://example.test/api', fetch: fetchImpl });

    const result = await sdk.providers.proxmox.accounts.wanIps({ id: 'acct/1' });

    assert.deepEqual(result, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.test/api/providers/proxmox/accounts/acct%2F1/wan-ips');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
  });

  it('POSTs allocateWanIps with the service pool body', async () => {
    const payload = {
      allocations: [{ ip: '203.0.113.11', serviceName: 'sip' }],
      capacity: { free: 1, allocated: 2, excluded: 0, totalAliases: 3 },
    };
    const { fetchImpl, calls } = mockFetch(() => payload);
    const sdk = new ZeusInstanceSDK({ baseURL: 'https://example.test/api', token: 'zeus_test', fetch: fetchImpl });

    const result = await sdk.providers.proxmox.accounts.allocateWanIps({
      id: 'acct-1',
      container: 'app1',
      cluster: 'z-02',
      envName: 'dev-d00',
      serviceName: 'sip',
      count: 1,
    });

    assert.deepEqual(result, payload);
    assert.equal(calls[0].url, 'https://example.test/api/providers/proxmox/accounts/acct-1/wan-ips');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer zeus_test');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      container: 'app1',
      cluster: 'z-02',
      envName: 'dev-d00',
      serviceName: 'sip',
      count: 1,
    });
  });

  it('forwards ips and branch and leaves count in the body when both are set', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ allocations: [], capacity: {} }));
    const sdk = new ZeusInstanceSDK({ baseURL: 'https://example.test/api', fetch: fetchImpl });

    await sdk.providers.proxmox.accounts.allocateWanIps({
      id: 'acct-1',
      container: 'app1',
      cluster: 'z-02',
      envName: 'dev-d00',
      serviceName: 'sip',
      count: 2,
      ips: ['203.0.113.11', '203.0.113.12'],
      branch: 'main',
    });

    assert.deepEqual(JSON.parse(calls[0].init.body), {
      container: 'app1',
      cluster: 'z-02',
      envName: 'dev-d00',
      serviceName: 'sip',
      count: 2,
      ips: ['203.0.113.11', '203.0.113.12'],
      branch: 'main',
    });
  });
});
