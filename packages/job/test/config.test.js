'use strict';

const assert = require('assert');
const { loadConfig, parseInterval, parseList } = require('../src/config');
const { DEFAULT_REGIONS } = require('@gd/shared/src/regions');

const BASE_ENV = { ACCESS_KEY_ID: 'ak', ACCESS_KEY_SECRET: 'sk' };

describe('job config parseInterval', () => {
  it('accepts bare seconds, s, m and h suffixes', () => {
    assert.strictEqual(parseInterval('300'), 300);
    assert.strictEqual(parseInterval('30s'), 30);
    assert.strictEqual(parseInterval('5m'), 300);
    assert.strictEqual(parseInterval('2h'), 7200);
    assert.strictEqual(parseInterval('5M'), 300);
  });

  it('defaults to five minutes when unset', () => {
    assert.strictEqual(parseInterval(undefined), 300);
    assert.strictEqual(parseInterval(''), 300);
    assert.strictEqual(parseInterval('  '), 300);
  });

  it('rejects values that are not a positive duration', () => {
    assert.throws(() => parseInterval('0'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('-5m'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('abc'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('5d'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('5 m'), /Invalid SYNC_INTERVAL/);
  });
});

describe('job config parseList', () => {
  it('splits on comma and drops blanks', () => {
    assert.deepStrictEqual(parseList('a,b'), [ 'a', 'b' ]);
    assert.deepStrictEqual(parseList(' a , , b '), [ 'a', 'b' ]);
    assert.deepStrictEqual(parseList(undefined), []);
    assert.deepStrictEqual(parseList(''), []);
  });
});

describe('job config loadConfig', () => {
  it('requires credentials', () => {
    assert.throws(() => loadConfig({}), /ACCESS_KEY_ID/);
    assert.throws(() => loadConfig({ ACCESS_KEY_ID: 'ak' }), /ACCESS_KEY_SECRET/);
  });

  it('applies documented defaults', () => {
    const config = loadConfig(BASE_ENV);
    assert.deepStrictEqual(config.credential, { accessKeyId: 'ak', accessKeySecret: 'sk' });
    assert.deepStrictEqual(config.allow, []);
    assert.deepStrictEqual(config.deny, []);
    assert.strictEqual(config.intervalSeconds, 300);
    assert.deepStrictEqual(config.regions, DEFAULT_REGIONS);
    assert.strictEqual(config.label, 'default');
    assert.strictEqual(config.ipEndpoint, undefined);
  });

  it('reads every documented variable', () => {
    const config = loadConfig({
      ...BASE_ENV,
      MACHINE_ALLOW: 'nas-hk, i-abc',
      MACHINE_DENY: 'prod-1',
      SYNC_INTERVAL: '30s',
      REGIONS: 'cn-hangzhou,cn-hongkong',
      RULE_LABEL: 'home',
      IP_ENDPOINT: 'https://ip.example.com',
    });
    assert.deepStrictEqual(config.allow, [ 'nas-hk', 'i-abc' ]);
    assert.deepStrictEqual(config.deny, [ 'prod-1' ]);
    assert.strictEqual(config.intervalSeconds, 30);
    assert.deepStrictEqual(config.regions, [ 'cn-hangzhou', 'cn-hongkong' ]);
    assert.strictEqual(config.label, 'home');
    assert.strictEqual(config.ipEndpoint, 'https://ip.example.com');
  });

  it('rejects a label containing the remark separators', () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, RULE_LABEL: 'a@b' }), /RULE_LABEL/);
    assert.throws(() => loadConfig({ ...BASE_ENV, RULE_LABEL: 'a:b' }), /RULE_LABEL/);
    assert.throws(() => loadConfig({ ...BASE_ENV, RULE_LABEL: '' }), /RULE_LABEL/);
  });
});
