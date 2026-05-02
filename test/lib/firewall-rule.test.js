'use strict';

const assert = require('assert');

const {
  RULE_PROTOCOLS,
  PORT_RANGE,
  toSourceCidrIp,
  normalizeIpForCompare,
  hasRemarkPrefix,
  buildManagedDdnsRemark,
  isLegacyManagedDdnsRemark,
  isManagedDdnsRemark,
  buildManagedCliRemark,
  isLegacyManagedCliRemark,
  isManagedCliRemark,
  isRuleExpired,
  isExpiredWebRule,
  parseRuleTimestamp,
  findManagedRule,
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

  it('distinguishes managed scheduler and cli remarks from manual remarks', () => {
    const ddnsRemark = buildManagedDdnsRemark('xfyj.keydiary.dev', '2026-04-17 12:00:00');
    const cliRemark = buildManagedCliRemark('ecs-dsec-handler', '2026-04-17 12:00:00');

    assert.strictEqual(isManagedDdnsRemark(ddnsRemark, 'xfyj.keydiary.dev'), true);
    assert.strictEqual(isLegacyManagedDdnsRemark('xfyj.keydiary.dev@2026-04-17 12:00:00', 'xfyj.keydiary.dev'), true);
    assert.strictEqual(isManagedDdnsRemark('xfyj.keydiary.dev@2026-04-17 12:00:00', 'xfyj.keydiary.dev'), false);
    assert.strictEqual(isManagedDdnsRemark('gd-web@2026-04-17 12:00:00', 'xfyj.keydiary.dev'), false);
    assert.strictEqual(isManagedDdnsRemark('云谷园区', 'xfyj.keydiary.dev'), false);
    assert.strictEqual(isLegacyManagedCliRemark('ecs-dsec-handler@2026-04-17 12:00:00', 'ecs-dsec-handler'), true);
    assert.strictEqual(isManagedCliRemark(cliRemark, 'ecs-dsec-handler'), true);
    assert.strictEqual(isManagedCliRemark('ecs-dsec-handler@2026-04-17 12:00:00', 'ecs-dsec-handler'), true);
    assert.strictEqual(isManagedCliRemark('ecs-dsec-handler', 'ecs-dsec-handler'), false);
  });

  it('parses timestamps and judges expiry', () => {
    const timestamp = parseRuleTimestamp('gd-web@2026-04-17 12:00:00');
    assert.notStrictEqual(timestamp, null);
    assert.strictEqual(isRuleExpired('gd-web@2026-04-17 12:00:00', 1000, timestamp + 1001), true);
    assert.strictEqual(isRuleExpired('gd-web@2026-04-17 12:00:00', 1000, timestamp + 999), false);
    assert.strictEqual(isRuleExpired('gd-web-without-time'), false);
  });

  it('rejects malformed timestamps instead of auto-normalizing them', () => {
    assert.strictEqual(parseRuleTimestamp('gd-web@2026-99-17 12:00:00'), null);
    assert.strictEqual(parseRuleTimestamp('gd-web@2026-02-31 12:00:00'), null);
    assert.strictEqual(parseRuleTimestamp('gd-web@2026-04-17 25:00:00'), null);
  });

  it('only treats stale gd-web TCP/UDP full-port rules as expired web rules', () => {
    const rules = [
      { id: 'stale-tcp', protocol: 'TCP', port: PORT_RANGE, remark: 'gd-web@2026-04-15 12:00:00' },
      { id: 'stale-udp', protocol: 'UDP', port: PORT_RANGE, remark: 'gd-web@2026-04-15 12:00:00' },
      { id: 'fresh', protocol: 'TCP', port: PORT_RANGE, remark: 'gd-web@2026-04-17 11:59:59' },
      { id: 'wrong-prefix', protocol: 'TCP', port: PORT_RANGE, remark: 'other@2026-04-15 12:00:00' },
      { id: 'wrong-port', protocol: 'TCP', port: '22/22', remark: 'gd-web@2026-04-15 12:00:00' },
      { id: 'wrong-protocol', protocol: 'ICMP', port: PORT_RANGE, remark: 'gd-web@2026-04-15 12:00:00' },
      { id: 'invalid-time', protocol: 'TCP', port: PORT_RANGE, remark: 'gd-web@2026-99-15 12:00:00' },
    ];

    const expiredIds = rules
      .filter(rule => isExpiredWebRule({
        protocol: rule.protocol,
        port: rule.port,
        remark: rule.remark,
        now: Date.parse('2026-04-17T12:00:01'),
      }))
      .map(rule => rule.id);

    assert.deepStrictEqual(expiredIds, [ 'stale-tcp', 'stale-udp' ]);
  });

  it('ignores configured ids that point to non-managed rules', () => {
    const ruleConf = {
      name: 'xfyj.keydiary.dev',
      id: 'manual-rule-id',
    };
    const rules = [ {
      ruleId: 'manual-rule-id',
      ruleProtocol: 'TCP',
      port: PORT_RANGE,
      remark: '云谷园区',
    } ];

    const matchedRule = findManagedRule({
      rules,
      ruleConf,
      protocol: 'TCP',
      idField: 'ruleId',
      protocolField: 'ruleProtocol',
      remarkField: 'remark',
      portField: 'port',
      remarkMatcher: value => isManagedDdnsRemark(value, ruleConf.name),
    });

    assert.strictEqual(matchedRule, null);
  });
});
