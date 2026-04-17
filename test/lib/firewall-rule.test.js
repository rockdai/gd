'use strict';

const assert = require('assert');

const {
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeIpForCompare,
  hasRemarkPrefix,
  isRuleExpired,
  parseRuleTimestamp,
} = require('../../lib/firewall-rule');

describe('firewall-rule helpers', () => {
  it('normalizes IP to /32', () => {
    assert.deepStrictEqual(RULE_PROTOCOLS, [ 'TCP', 'UDP' ]);
    assert.strictEqual(toSourceCidrIp('1.2.3.4'), '1.2.3.4/32');
    assert.strictEqual(normalizeIpForCompare('1.2.3.4'), '1.2.3.4/32');
    assert.strictEqual(toSourceCidrIp('1.2.3.4/24'), '1.2.3.4/24');
  });

  it('matches remark prefixes with or without timestamp', () => {
    assert.strictEqual(hasRemarkPrefix('gd-web', 'gd-web'), true);
    assert.strictEqual(hasRemarkPrefix('gd-web@2026-04-17 12:00:00', 'gd-web'), true);
    assert.strictEqual(hasRemarkPrefix('other@2026-04-17 12:00:00', 'gd-web'), false);
  });

  it('parses timestamps and judges expiry', () => {
    const timestamp = parseRuleTimestamp('gd-web@2026-04-17 12:00:00');
    assert.notStrictEqual(timestamp, null);
    assert.strictEqual(isRuleExpired('gd-web@2026-04-17 12:00:00', 1000, timestamp + 1001), true);
    assert.strictEqual(isRuleExpired('gd-web@2026-04-17 12:00:00', 1000, timestamp + 999), false);
    assert.strictEqual(isRuleExpired('gd-web-without-time'), false);
  });
});
