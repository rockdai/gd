'use strict';

const assert = require('assert');
const { DEFAULT_REGIONS, resolveRegions } = require('../src/regions');

describe('regions', () => {
  it('exposes the ten default regions', () => {
    assert.deepStrictEqual(DEFAULT_REGIONS, [
      'cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen', 'cn-hongkong',
      'ap-northeast-1', 'ap-southeast-1', 'us-west-1', 'us-east-1', 'eu-central-1',
    ]);
  });

  it('falls back to defaults when unset or blank', () => {
    assert.deepStrictEqual(resolveRegions(undefined), DEFAULT_REGIONS);
    assert.deepStrictEqual(resolveRegions(''), DEFAULT_REGIONS);
    assert.deepStrictEqual(resolveRegions('   '), DEFAULT_REGIONS);
  });

  it('splits on comma and trims blanks', () => {
    assert.deepStrictEqual(resolveRegions('cn-hangzhou,cn-hongkong'), [ 'cn-hangzhou', 'cn-hongkong' ]);
    assert.deepStrictEqual(resolveRegions(' cn-hangzhou , , cn-hongkong '), [ 'cn-hangzhou', 'cn-hongkong' ]);
  });

  it('reads process.env.REGIONS when no argument is given', () => {
    const previous = process.env.REGIONS;
    try {
      process.env.REGIONS = 'us-west-1';
      assert.deepStrictEqual(resolveRegions(), [ 'us-west-1' ]);
      delete process.env.REGIONS;
      assert.deepStrictEqual(resolveRegions(), DEFAULT_REGIONS);
    } finally {
      if (previous === undefined) delete process.env.REGIONS;
      else process.env.REGIONS = previous;
    }
  });
});
