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
  GD_JOB_RULE_PREFIX,
  buildManagedJobRemark,
  isManagedJobRemark,
  isOurManagedRemark,
  isRuleExpired,
  isExpiredWebRule,
  parseRuleTimestamp,
  findManagedRule,
  findRuleByProtocolPortSource,
} = require('../src/firewall-rule');

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
    const ddnsRemark = buildManagedDdnsRemark('home.example.com', '2026-04-17 12:00:00');
    const cliRemark = buildManagedCliRemark('ecs-dsec-handler', '2026-04-17 12:00:00');

    assert.strictEqual(isManagedDdnsRemark(ddnsRemark, 'home.example.com'), true);
    assert.strictEqual(isLegacyManagedDdnsRemark('home.example.com@2026-04-17 12:00:00', 'home.example.com'), true);
    assert.strictEqual(isManagedDdnsRemark('home.example.com@2026-04-17 12:00:00', 'home.example.com'), false);
    assert.strictEqual(isManagedDdnsRemark('gd-web@2026-04-17 12:00:00', 'home.example.com'), false);
    assert.strictEqual(isManagedDdnsRemark('云谷园区', 'home.example.com'), false);
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

  it('treats only timestamped gd-web/gd-ddns/gd-cli remarks as our managed rules', () => {
    assert.strictEqual(isOurManagedRemark('gd-web@2026-04-17 12:00:00'), true);
    assert.strictEqual(isOurManagedRemark('gd-ddns:home.example.com@2026-04-17 12:00:00'), true);
    assert.strictEqual(isOurManagedRemark('gd-cli:ecs-dsec-handler@2026-04-17 12:00:00'), true);

    assert.strictEqual(isOurManagedRemark('云谷园区'), false);
    assert.strictEqual(isOurManagedRemark('云谷园区@2020-01-01 12:00:00'), false);
    assert.strictEqual(isOurManagedRemark('home.example.com@2026-04-17 12:00:00'), false);
    assert.strictEqual(isOurManagedRemark('ecs-dsec-handler@2026-04-17 12:00:00'), false);
    assert.strictEqual(isOurManagedRemark('gd-web'), false);
    assert.strictEqual(isOurManagedRemark('gd-web@invalid'), false);
    assert.strictEqual(isOurManagedRemark('gd-webx@2026-04-17 12:00:00'), false);
    assert.strictEqual(isOurManagedRemark(''), false);
    assert.strictEqual(isOurManagedRemark(null), false);
    assert.strictEqual(isOurManagedRemark(undefined), false);
  });

  it('matches rules by protocol+port+normalized source via findRuleByProtocolPortSource', () => {
    const rules = [
      { ipProtocol: 'tcp', portRange: PORT_RANGE, sourceCidrIp: '1.2.3.4/32' },
      { ipProtocol: 'TCP', portRange: '22/22', sourceCidrIp: '1.2.3.4/32' },
      { ipProtocol: 'UDP', portRange: PORT_RANGE, sourceCidrIp: '1.2.3.4/32' },
    ];

    assert.strictEqual(findRuleByProtocolPortSource({
      rules,
      protocol: 'TCP',
      sourceCidrIp: '1.2.3.4',
      protocolField: 'ipProtocol',
      portField: 'portRange',
    }), rules[0]);

    assert.strictEqual(findRuleByProtocolPortSource({
      rules,
      protocol: 'TCP',
      sourceCidrIp: '1.2.3.4/32',
      protocolField: 'ipProtocol',
      portField: 'portRange',
    }), rules[0]);

    assert.strictEqual(findRuleByProtocolPortSource({
      rules,
      protocol: 'TCP',
      sourceCidrIp: '5.5.5.5/32',
      protocolField: 'ipProtocol',
      portField: 'portRange',
    }), undefined);
  });

  it('ignores configured ids that point to non-managed rules', () => {
    const ruleConf = {
      name: 'home.example.com',
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

  it('builds and matches gd-job remarks scoped by label', () => {
    assert.strictEqual(GD_JOB_RULE_PREFIX, 'gd-job');
    assert.strictEqual(
      buildManagedJobRemark('home', '2026-08-18 09:00:00'),
      'gd-job:home@2026-08-18 09:00:00'
    );

    // 认自己的 label
    assert.strictEqual(isManagedJobRemark('gd-job:home@2026-08-18 09:00:00', 'home'), true);

    // 不认别的 label —— 多站点隔离的关键
    assert.strictEqual(isManagedJobRemark('gd-job:office@2026-08-18 09:00:00', 'home'), false);

    // 前缀相同但 label 更长，不能误判
    assert.strictEqual(isManagedJobRemark('gd-job:home2@2026-08-18 09:00:00', 'home'), false);

    // 只认精确形态 gd-job:<label>@<时间戳>：多一个 @ 或缺时间戳都不是我们生成的
    assert.strictEqual(isManagedJobRemark('gd-job:home@note@2026-08-18 09:00:00', 'home'), false);
    assert.strictEqual(isManagedJobRemark('gd-job:home', 'home'), false);
    assert.strictEqual(isManagedJobRemark('gd-job:home@invalid', 'home'), false);

    // 不认其他模块的规则
    assert.strictEqual(isManagedJobRemark('gd-web@2026-08-18 09:00:00', 'home'), false);
    assert.strictEqual(isManagedJobRemark('gd-cli:home@2026-08-18 09:00:00', 'home'), false);
    assert.strictEqual(isManagedJobRemark('云谷园区', 'home'), false);
  });

  it('treats gd-job remarks as ours in the fail-closed guard', () => {
    assert.strictEqual(isOurManagedRemark('gd-job:home@2026-08-18 09:00:00'), true);

    // 时间戳非法 → 不认，避免误删手工规则
    assert.strictEqual(isOurManagedRemark('gd-job:home@invalid'), false);
    assert.strictEqual(isOurManagedRemark('gd-job:home'), false);

    // 前缀相近但不是我们的
    assert.strictEqual(isOurManagedRemark('gd-jobx:home@2026-08-18 09:00:00'), false);
  });

  it('keeps gd-job rules out of the web expiry sweep', () => {
    // gd-job 规则即使很旧，也不该被 web 的 24h TTL 判定命中
    assert.strictEqual(isExpiredWebRule({
      protocol: 'TCP',
      port: PORT_RANGE,
      remark: 'gd-job:home@2020-01-01 00:00:00',
    }), false);
  });
});
