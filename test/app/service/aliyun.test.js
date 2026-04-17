'use strict';

const assert = require('assert');

const AliyunService = require('../../../app/service/aliyun');

describe('AliyunService cleanup handling', () => {
  it('treats cleanup errors as best-effort failures', async () => {
    const warnings = [];
    const cleanup = await AliyunService.prototype._tryCleanupExpiredWebRules.call({
      logger: {
        warn(...args) {
          warnings.push(args);
        },
      },
      async _cleanupExpiredWebRules() {
        throw new Error('boom');
      },
    }, {}, {
      product: 'swas-open',
      instanceId: 'i-test',
    });

    assert.deepStrictEqual(cleanup, {
      deletedCount: 0,
      failed: true,
    });
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0][0], /Failed to cleanup expired web rules/);
    assert.strictEqual(warnings[0][1].message, 'boom');
  });

  it('appends cleanup outcome to the result message', () => {
    const message = AliyunService.prototype._appendCleanupMessage.call({}, 'TCP: added, UDP: added', {
      deletedCount: 2,
      failed: true,
    });

    assert.strictEqual(message, 'TCP: added, UDP: added; cleaned 2 expired gd-web rule(s); cleanup failed');
  });
});
