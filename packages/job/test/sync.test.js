'use strict';

const assert = require('assert');
const { runOnce, buildStaleRulePredicate } = require('../src/sync');
const { PORT_RANGE } = require('@gd/shared/src/firewall-rule');

const SILENT = { info() {}, warn() {}, error() {} };

const CONFIG = {
  credential: { accessKeyId: 'ak', accessKeySecret: 'sk' },
  allow: [], deny: [],
  regions: [ 'cn-hangzhou' ],
  label: 'home',
  ipEndpoint: undefined,
};

const SWAS = { product: 'swas-open', instanceId: 'swas-1', instanceName: 'blog', regionId: 'cn-hangzhou' };

const ADDED_BOTH = { status: 'success', message: 'TCP: added, UDP: added', protocols: { TCP: 'added', UDP: 'added' } };
const EXISTS_BOTH = { status: 'success', message: 'TCP: already exists, UDP: already exists', protocols: { TCP: 'exists', UDP: 'exists' } };

const OWN_RULES = [
  { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'own-tcp' },
  { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'own-udp' },
];
const FOREIGN_RULES = [
  { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-web@2026-08-18 08:00:00', ruleId: 'web-tcp' },
  { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-web@2026-08-18 08:00:00', ruleId: 'web-udp' },
];

function makeDeps(overrides = {}) {
  return {
    async getPublicIp() { return '1.2.3.4'; },
    async listMachines() { return { machines: [ SWAS ], failures: [] }; },
    async listMachineRules() { return []; },
    async addIpRules() { return ADDED_BOTH; },
    async cleanupRules() { return { deletedCount: 0 }; },
    ...overrides,
  };
}

function captureLogger() {
  const lines = { info: [], warn: [], error: [] };
  return {
    lines,
    logger: {
      info: (...a) => lines.info.push(a.join(' ')),
      warn: (...a) => lines.warn.push(a.join(' ')),
      error: (...a) => lines.error.push(a.join(' ')),
    },
  };
}

describe('job sync buildStaleRulePredicate', () => {
  it('selects own-label rules whose source IP differs from the current one', () => {
    const predicate = buildStaleRulePredicate({ label: 'home', sourceCidrIp: '1.2.3.4/32', product: 'swas-open' });
    const rule = (remark, sourceCidrIp) => ({ ruleProtocol: 'TCP', port: PORT_RANGE, remark, sourceCidrIp });

    // 旧 IP 的自有规则 → 删
    assert.strictEqual(predicate(rule('gd-job:home@2026-08-17 09:00:00', '5.6.7.8/32')), true);
    // 当前 IP 的自有规则 → 留，哪怕时间戳很旧（DDNS 语义，不看时间）
    assert.strictEqual(predicate(rule('gd-job:home@2020-01-01 00:00:00', '1.2.3.4/32')), false);
    // 别的 label → 不碰
    assert.strictEqual(predicate(rule('gd-job:office@2026-08-17 09:00:00', '5.6.7.8/32')), false);
    // 别的模块 → 不碰
    assert.strictEqual(predicate(rule('gd-web@2026-08-17 09:00:00', '5.6.7.8/32')), false);
    assert.strictEqual(predicate(rule('gd-ddns:x.dev@2026-08-17 09:00:00', '5.6.7.8/32')), false);
    // 手工规则 → 不碰
    assert.strictEqual(predicate(rule('云谷园区', '5.6.7.8/32')), false);
  });

  it('ignores rules whose protocol or port is not the managed shape', () => {
    // 与 web 的 isExpiredWebRule 一致：只认 TCP/UDP + 1/65535 的规则
    const predicate = buildStaleRulePredicate({ label: 'home', sourceCidrIp: '1.2.3.4/32', product: 'swas-open' });
    assert.strictEqual(predicate({ ruleProtocol: 'TCP', port: '22/22', remark: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), false);
    assert.strictEqual(predicate({ ruleProtocol: 'ICMP', port: PORT_RANGE, remark: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), false);
    assert.strictEqual(predicate({ ruleProtocol: 'tcp', port: PORT_RANGE, remark: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), true);
  });

  it('reads the description field for ECS rules', () => {
    const predicate = buildStaleRulePredicate({ label: 'home', sourceCidrIp: '1.2.3.4/32', product: 'ecs' });
    assert.strictEqual(predicate({ ipProtocol: 'TCP', portRange: PORT_RANGE, description: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), true);
  });
});

describe('job sync runOnce', () => {
  it('adds then cleans', async () => {
    const order = [];
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async addIpRules() { order.push('add'); return ADDED_BOTH; },
        async cleanupRules() { order.push('cleanup'); return { deletedCount: 1 }; },
      }),
    });
    // 先加后清：先删会留出一段谁都连不上的窗口
    assert.deepStrictEqual(order, [ 'add', 'cleanup' ]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.added, 2);
    assert.strictEqual(result.deleted, 1);
  });

  it('passes one rule listing to both add and cleanup', async () => {
    let listCalls = 0;
    const seen = [];
    const rules = [ { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '5.6.7.8/32', remark: 'gd-job:home@2026-08-17 09:00:00', ruleId: 'old' } ];
    await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { listCalls += 1; return rules; },
        async addIpRules(args) { seen.push(args.rules); return ADDED_BOTH; },
        async cleanupRules(args) { seen.push(args.rules); return { deletedCount: 1 }; },
      }),
    });
    assert.strictEqual(listCalls, 1);
    assert.strictEqual(seen[0], rules);
    assert.strictEqual(seen[1], rules);
  });

  it('is idempotent: a repeated round with everything in place performs no writes', async () => {
    let created = 0;
    let deleted = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { return OWN_RULES; },
        async addIpRules() { created += 1; return EXISTS_BOTH; },
        async cleanupRules() { deleted += 1; return { deletedCount: 0 }; },
      }),
    });
    // addIpRules / cleanupRules 被调用（它们内部靠预检决定不写），但结果里没有任何写入
    assert.strictEqual(created, 1);
    assert.strictEqual(deleted, 1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.deleted, 0);
  });

  it('heals on the next round once a foreign rule covering the IP disappears', async () => {
    // 场景：用户此前在家用 Web 加过白名单，gd-web 规则覆盖了家里 IP。
    // 本轮预检"已存在"，不写；24h 后 web 把它清掉，下一轮 gd-job 自动补上自己的规则。
    // 不需要任何状态或特殊逻辑，每轮全量对账天然覆盖。
    const first = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { return FOREIGN_RULES; },
        async addIpRules() { return EXISTS_BOTH; },
      }),
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.added, 0);

    const second = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({ async listMachineRules() { return []; } }),
    });
    assert.strictEqual(second.added, 2);
  });

  it('keeps stale rules when only some protocols were added', async () => {
    let cleaned = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async addIpRules() { return { status: 'partial', message: 'TCP: added, UDP: failed (boom)', protocols: { TCP: 'added', UDP: 'failed' } }; },
        async cleanupRules() { cleaned += 1; return { deletedCount: 1 }; },
      }),
    });
    // 新访问没完全到位前不撤旧访问；下一轮补齐 UDP 后再清
    assert.strictEqual(cleaned, 0);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failures, 1);
  });

  it('counts instance-discovery failures so a blind round is not reported as ok', async () => {
    const { lines, logger } = captureLogger();
    const result = await runOnce({
      config: CONFIG, logger,
      deps: makeDeps({
        async listMachines() {
          return { machines: [], failures: [
            { product: 'ecs', regionId: 'cn-hangzhou', message: 'Forbidden.RAM: code: 403' },
            { product: 'swas-open', regionId: 'cn-hangzhou', message: 'NoPermission: code: 403' },
          ] };
        },
      }),
    });
    assert.strictEqual(result.targets, 0);
    assert.strictEqual(result.failures, 2);
    assert.strictEqual(result.ok, false);
    assert.ok(lines.info.some(line => line.includes('0 machine(s)') && line.includes('2 failure(s)')));
  });

  it('reports failure when any machine fails', async () => {
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({ async addIpRules() { return { status: 'error', message: 'boom' }; } }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failures, 1);
  });

  it('counts a cleanup throw as a failure and keeps going', async () => {
    const { lines, logger } = captureLogger();
    const result = await runOnce({
      config: CONFIG, logger,
      deps: makeDeps({ async cleanupRules() { throw new Error('boom'); } }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failures, 1);
    assert.strictEqual(result.added, 2);           // the add still counted
    assert.ok(lines.error.some(line => line.includes('cleanup failed') && line.includes('boom')));
  });

  it('fails closed for a machine whose rule listing throws', async () => {
    let added = 0;
    let cleaned = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { throw new Error('boom'); },
        async addIpRules() { added += 1; return ADDED_BOTH; },
        async cleanupRules() { cleaned += 1; return { deletedCount: 0 }; },
      }),
    });
    assert.strictEqual(added, 0);
    assert.strictEqual(cleaned, 0);
    assert.strictEqual(result.ok, false);
  });

  it('skips the round when fetching the public IP fails', async () => {
    let listed = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async getPublicIp() { throw new Error('offline'); },
        async listMachines() { listed += 1; return { machines: [ SWAS ], failures: [] }; },
      }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ip, null);
    assert.strictEqual(listed, 0);
  });

  it('logs missing allow entries without failing the round', async () => {
    const { lines, logger } = captureLogger();
    const result = await runOnce({
      config: { ...CONFIG, allow: [ 'blog', 'released-box' ] },
      logger,
      deps: makeDeps(),
    });
    assert.strictEqual(result.ok, true);
    assert.ok(lines.info.some(line => line.includes('released-box')));
  });

  it('adds only to the primary security group but cleans stale own rules from every attached group', async () => {
    // i-1 挂了三个组，排序后主组 sg-a；曾经 sg-b 是主组时留下的旧 IP 规则必须也被清掉
    const machines = [ { product: 'ecs', instanceId: 'i-1', instanceName: 'nas', regionId: 'cn-hangzhou', securityGroupIds: [ 'sg-c', 'sg-a', 'sg-b' ] } ];
    const addTargets = [];
    const cleanTargets = [];
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachines() { return { machines, failures: [] }; },
        async addIpRules(args) { addTargets.push(args.machine.securityGroupId); return ADDED_BOTH; },
        async cleanupRules(args) {
          cleanTargets.push(args.machine.securityGroupId);
          return { deletedCount: args.machine.securityGroupId === 'sg-b' ? 2 : 0 };
        },
      }),
    });
    assert.deepStrictEqual(addTargets, [ 'sg-a' ]);
    assert.deepStrictEqual(cleanTargets, [ 'sg-a', 'sg-b', 'sg-c' ]);
    assert.strictEqual(result.deleted, 2);
    assert.strictEqual(result.ok, true);
  });

  it('does not touch secondary security groups when the add did not fully succeed', async () => {
    const machines = [ { product: 'ecs', instanceId: 'i-1', instanceName: 'nas', regionId: 'cn-hangzhou', securityGroupIds: [ 'sg-b', 'sg-a' ] } ];
    let cleaned = 0;
    await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachines() { return { machines, failures: [] }; },
        async addIpRules() { return { status: 'partial', message: 'TCP: added, UDP: failed (boom)', protocols: { TCP: 'added', UDP: 'failed' } }; },
        async cleanupRules() { cleaned += 1; return { deletedCount: 0 }; },
      }),
    });
    assert.strictEqual(cleaned, 0);
  });

  it('uses the ECS security group chosen by sorting', async () => {
    const machines = [ { product: 'ecs', instanceId: 'i-1', instanceName: 'nas', regionId: 'cn-hangzhou', securityGroupIds: [ 'sg-b', 'sg-a' ] } ];
    let seenGroup;
    await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachines() { return { machines, failures: [] }; },
        async addIpRules(args) { seenGroup = args.machine.securityGroupId; return ADDED_BOTH; },
      }),
    });
    assert.strictEqual(seenGroup, 'sg-a');
  });

  it('prints only the round summary when nothing was written and nothing failed', async () => {
    const { lines, logger } = captureLogger();
    await runOnce({
      config: CONFIG, logger,
      deps: makeDeps({
        async listMachineRules() { return OWN_RULES; },
        async addIpRules() { return EXISTS_BOTH; },
      }),
    });
    // 一行摘要，不带机器级细节 —— 每 5 分钟一轮，安静的轮次不该刷屏
    assert.strictEqual(lines.info.length, 1);
    assert.ok(lines.info[0].includes('1.2.3.4'));
    assert.ok(lines.info[0].includes('0 rule(s) added'));
    assert.strictEqual(lines.warn.length, 0);
    assert.strictEqual(lines.error.length, 0);
  });

  it('verbose prints every machine even when nothing was written (first round after start)', async () => {
    const { lines, logger } = captureLogger();
    await runOnce({
      config: CONFIG, logger, verbose: true,
      deps: makeDeps({
        async listMachineRules() { return OWN_RULES; },
        async addIpRules() { return EXISTS_BOTH; },
      }),
    });
    assert.ok(lines.info.some(line => line.includes('swas-open/blog') && line.includes('TCP: already exists, UDP: already exists')));
    assert.ok(lines.info.some(line => line.includes('0 rule(s) added')));
  });

  it('prints machine detail when something was written', async () => {
    const { lines, logger } = captureLogger();
    await runOnce({
      config: CONFIG, logger,
      deps: makeDeps({ async cleanupRules() { return { deletedCount: 1 }; } }),
    });
    assert.ok(lines.info.some(line => line.includes('swas-open/blog') && line.includes('TCP: added')));
    assert.ok(lines.info.some(line => line.includes('swas-open/blog') && line.includes('cleaned 1')));
    assert.ok(lines.info.some(line => line.includes('2 rule(s) added') && line.includes('1 rule(s) removed')));
  });
});
