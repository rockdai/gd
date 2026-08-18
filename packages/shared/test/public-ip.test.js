'use strict';

const assert = require('assert');
const { getPublicIp, extractIpv4, IP_ENDPOINT } = require('../src/public-ip');

describe('public-ip', () => {
  it('parses ipv4 out of a noisy response', () => {
    assert.strictEqual(extractIpv4('1.2.3.4%'), '1.2.3.4');
    assert.strictEqual(extractIpv4('\n 140.205.11.246 \n'), '140.205.11.246');
    assert.strictEqual(extractIpv4('999.1.1.1'), null);
    assert.strictEqual(extractIpv4('nope'), null);
  });

  it('requests the built-in endpoint by default', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async url => {
      calls.push(url);
      return { ok: true, async text() { return '1.2.3.4'; } };
    };
    try {
      assert.strictEqual(await getPublicIp(), '1.2.3.4');
      assert.deepStrictEqual(calls, [ IP_ENDPOINT ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('prefers the explicit endpoint, then IP_ENDPOINT env, then the constant', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const previous = process.env.IP_ENDPOINT;
    global.fetch = async url => {
      calls.push(url);
      return { ok: true, async text() { return '1.2.3.4'; } };
    };
    try {
      process.env.IP_ENDPOINT = 'https://env.example.com';

      await getPublicIp({ endpoint: 'https://arg.example.com' });
      assert.strictEqual(calls[0], 'https://arg.example.com');

      await getPublicIp();
      assert.strictEqual(calls[1], 'https://env.example.com');

      delete process.env.IP_ENDPOINT;
      await getPublicIp();
      assert.strictEqual(calls[2], IP_ENDPOINT);
    } finally {
      global.fetch = originalFetch;
      if (previous === undefined) delete process.env.IP_ENDPOINT;
      else process.env.IP_ENDPOINT = previous;
    }
  });
});
