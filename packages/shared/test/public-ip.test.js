'use strict';

const assert = require('assert');
const { getPublicIp, extractIpv4, IP_ENDPOINT, IP_FETCH_TIMEOUT_MS } = require('../src/public-ip');
const { isPublicIpv4, isValidIpv4 } = require('../src/ip');

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

describe('public-ip guards', () => {
  it('isPublicIpv4 rejects private, loopback, link-local, CGNAT, multicast, 0.0.0.0/8', () => {
    for (const ip of [ '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5', '127.0.0.1', '169.254.1.1', '100.64.0.1', '100.127.255.255', '224.0.0.1', '239.255.255.255', '255.255.255.255', '0.0.0.0', 'nope' ]) {
      assert.strictEqual(isPublicIpv4(ip), false, ip);
    }
    for (const ip of [ '1.2.3.4', '8.8.8.8', '140.205.11.246', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '223.255.255.255' ]) {
      assert.strictEqual(isPublicIpv4(ip), true, ip);
    }
    // web 端手填 IP 用的 isValidIpv4 不受影响：内网地址仍合法
    assert.strictEqual(isValidIpv4('192.168.1.5'), true);
  });

  it('refuses a non-public address from the endpoint instead of syncing it', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, async text() { return '192.168.1.5'; } });
    try {
      await assert.rejects(() => getPublicIp(), /non-public address: 192\.168\.1\.5/);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('bounds the request with a timeout so a hung endpoint cannot stall the caller', async () => {
    assert.strictEqual(IP_FETCH_TIMEOUT_MS, 10000);
    const originalFetch = global.fetch;
    let seenSignal;
    // 模拟一个永不返回、但尊重 AbortSignal 的端点
    global.fetch = (url, opts) => new Promise((resolve, reject) => {
      seenSignal = opts.signal;
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
    });
    try {
      await assert.rejects(() => getPublicIp({ timeoutMs: 20 }), err => err.name === 'TimeoutError' || /timeout/i.test(err.message));
      assert.ok(seenSignal instanceof AbortSignal);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
