'use strict';

const assert = require('assert');
const { PORT_RANGE } = require('../src/firewall-rule');

function loadMachineFirewallWithMocks({ ecsRules = [], swasRules = [], ecsListError = null, swasListError = null, swasCreateErrors = {}, instances = {} } = {}) {
  // instances: { [regionId]: { ecs: [...] | Error, swas: [...] | Error } } — 给 listMachines 用
  const modulePath = require.resolve('../src/machine-firewall');
  const ecsSdkPath = require.resolve('@alicloud/ecs20140526');
  const swasSdkPath = require.resolve('@alicloud/swas-open20200601');
  const swasFirewallPath = require.resolve('../src/swas-firewall');
  const ecsFirewallPath = require.resolve('../src/ecs-firewall');

  const previousCache = new Map([
    [ modulePath, require.cache[modulePath] ],
    [ ecsSdkPath, require.cache[ecsSdkPath] ],
    [ swasSdkPath, require.cache[swasSdkPath] ],
    [ swasFirewallPath, require.cache[swasFirewallPath] ],
    [ ecsFirewallPath, require.cache[ecsFirewallPath] ],
  ]);

  const ecsClients = [];
  const swasClients = [];

  class BaseRequest {
    constructor(fields) { Object.assign(this, fields); }
  }

  class FakeECSClient {
    constructor() {
      this.authorizeCalls = [];
      this.revokeCalls = [];
      this.listCalls = [];
      ecsClients.push(this);
    }
    async describeInstances(req) {
      const fixture = (instances[req.regionId] || {}).ecs || [];
      if (fixture instanceof Error) throw fixture;
      return { body: { instances: { instance: fixture.map(i => ({ ...i })) } } };
    }
    async describeSecurityGroupAttribute(req) {
      this.listCalls.push(req);
      if (ecsListError) throw ecsListError;
      return { body: { permissions: { permission: ecsRules.map(rule => ({ ...rule })) } } };
    }
    async authorizeSecurityGroup(req) { this.authorizeCalls.push(req); return { body: {} }; }
    async revokeSecurityGroup(req) { this.revokeCalls.push(req); return { body: {} }; }
  }

  class FakeSWASClient {
    constructor() {
      this.createCalls = [];
      this.deleteCalls = [];
      swasClients.push(this);
    }
    async listInstances(req) {
      const fixture = (instances[req.regionId] || {}).swas || [];
      if (fixture instanceof Error) throw fixture;
      return { body: { instances: fixture.map(i => ({ ...i })) } };
    }
    async createFirewallRules(req) {
      this.createCalls.push(req);
      const proto = req.firewallRules[0].ruleProtocol;
      if (swasCreateErrors[proto]) throw swasCreateErrors[proto];
      return { body: {} };
    }
    async deleteFirewallRules(req) { this.deleteCalls.push(req); return { body: {} }; }
  }

  require.cache[ecsSdkPath] = {
    id: ecsSdkPath, filename: ecsSdkPath, loaded: true,
    exports: {
      default: FakeECSClient,
      DescribeInstancesRequest: BaseRequest,
      // ecs-firewall.js 在模块加载时解构这个类；漏掉它会让 ECS 列举抛 TypeError，
      // 被 fail-closed 吞成 error 状态，用例会以错误的原因失败
      DescribeSecurityGroupAttributeRequest: BaseRequest,
      AuthorizeSecurityGroupRequest: BaseRequest,
      RevokeSecurityGroupRequest: BaseRequest,
    },
  };
  require.cache[swasSdkPath] = {
    id: swasSdkPath, filename: swasSdkPath, loaded: true,
    exports: {
      default: FakeSWASClient,
      ListInstancesRequest: BaseRequest,
      CreateFirewallRulesRequest: BaseRequest,
      DeleteFirewallRulesRequest: BaseRequest,
    },
  };
  require.cache[swasFirewallPath] = {
    id: swasFirewallPath, filename: swasFirewallPath, loaded: true,
    exports: {
      async listAllFirewallRules() {
        if (swasListError) throw swasListError;
        return swasRules.map(rule => ({ ...rule }));
      },
    },
  };

  // 强制 ecs-firewall 与被测模块一起重新加载，确保它们绑定到上面的假 SDK，
  // 不受同一 mocha 进程里其他测试文件加载顺序的影响
  delete require.cache[ecsFirewallPath];
  delete require.cache[modulePath];
  const machineFirewall = require('../src/machine-firewall');

  function restore() {
    for (const [ path, cached ] of previousCache) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  }

  return { machineFirewall, ecsClients, swasClients, restore };
}

const CREDENTIAL = { accessKeyId: 'ak', accessKeySecret: 'sk' };
const ECS_MACHINE = { product: 'ecs', instanceId: 'i-1', regionId: 'cn-hangzhou', securityGroupId: 'sg-1' };
const SWAS_MACHINE = { product: 'swas-open', instanceId: 'swas-1', regionId: 'cn-hangzhou' };

describe('machine-firewall addIpRules', () => {
  it('does not authorize ECS rules when a manual rule already covers the IP', async () => {
    const { machineFirewall, ecsClients, restore } = loadMachineFirewallWithMocks({
      ecsRules: [
        { ipProtocol: 'TCP', portRange: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', description: '云谷园区' },
        { ipProtocol: 'UDP', portRange: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', description: '云谷园区' },
      ],
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: ECS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.deepStrictEqual(result.protocols, { TCP: 'exists', UDP: 'exists' });
      assert.strictEqual(ecsClients[0].authorizeCalls.length, 0);
    } finally { restore(); }
  });

  it('does not create SWAS rules when a manual rule already covers the IP', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: '云谷园区', ruleId: 'm-1' },
        { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: '云谷园区', ruleId: 'm-2' },
      ],
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.strictEqual(swasClients[0].createCalls.length, 0);
    } finally { restore(); }
  });

  it('creates the rule when nothing covers the IP', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: added, UDP: added');
      assert.deepStrictEqual(result.protocols, { TCP: 'added', UDP: 'added' });
      assert.strictEqual(swasClients[0].createCalls.length, 2);
      assert.strictEqual(swasClients[0].createCalls[0].firewallRules[0].remark, 'gd-job:home@2026-08-18 09:00:00');
    } finally { restore(); }
  });

  it('treats FirewallRuleAlreadyExist from the API as already exists', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({
      swasRules: [], swasCreateErrors: { TCP: new Error('FirewallRuleAlreadyExist: dup') },
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.deepStrictEqual(result.protocols, { TCP: 'exists', UDP: 'added' });
    } finally { restore(); }
  });

  it('reports partial when one protocol create fails', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({
      swasRules: [], swasCreateErrors: { UDP: new Error('boom') },
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'partial');
      assert.strictEqual(result.message, 'TCP: added, UDP: failed (boom)');
      assert.deepStrictEqual(result.protocols, { TCP: 'added', UDP: 'failed' });
    } finally { restore(); }
  });

  it('fails closed when ECS rule listing throws', async () => {
    const { machineFirewall, ecsClients, restore } = loadMachineFirewallWithMocks({
      ecsListError: new Error('boom'),
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: ECS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'error');
      assert.ok(result.message.includes('refusing to add to keep manual rules safe'));
      assert.strictEqual(ecsClients[0].authorizeCalls.length, 0);
    } finally { restore(); }
  });

  it('fails closed when SWAS rule listing throws', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasListError: new Error('boom'),
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'error');
      assert.ok(result.message.includes('refusing to add to keep manual rules safe'));
      assert.strictEqual(swasClients[0].createCalls.length, 0);
    } finally { restore(); }
  });

  it('reuses caller-supplied rules instead of listing again', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
        rules: [
          { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'r1' },
          { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'r2' },
        ],
      });
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.strictEqual(swasClients[0].createCalls.length, 0);
    } finally { restore(); }
  });

  it('marks partial when one protocol fails', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = machineFirewall.buildProtocolOperationResult(
        [ 'TCP: added', 'UDP: failed (boom)' ],
        { hasSuccess: true, hasFailure: true }
      );
      assert.strictEqual(result.status, 'partial');
      assert.strictEqual(result.message, 'TCP: added, UDP: failed (boom)');
    } finally { restore(); }
  });

  it('marks error when all protocols fail', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = machineFirewall.buildProtocolOperationResult(
        [ 'TCP: failed (boom)', 'UDP: failed (boom)' ],
        { hasSuccess: false, hasFailure: true }
      );
      assert.strictEqual(result.status, 'error');
    } finally { restore(); }
  });
});

describe('machine-firewall cleanupRules', () => {
  it('refuses to revoke ECS rules whose descriptions are not managed', async () => {
    const { machineFirewall, ecsClients, restore } = loadMachineFirewallWithMocks({
      ecsRules: [
        { ipProtocol: 'TCP', portRange: PORT_RANGE, sourceCidrIp: '9.9.9.9/32', description: '云谷园区', securityGroupRuleId: 'sgr-1' },
      ],
    });
    try {
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: ECS_MACHINE,
        shouldDelete: () => true, // 谓词说删，外层 isOurManagedRemark 守卫仍必须拦住
      });
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(ecsClients[0].revokeCalls.length, 0);
    } finally { restore(); }
  });

  it('refuses to delete SWAS rules whose remarks are not managed', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '9.9.9.9/32', remark: '云谷园区', ruleId: 'r-1' },
      ],
    });
    try {
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE, shouldDelete: () => true,
      });
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(swasClients[0].deleteCalls.length, 0);
    } finally { restore(); }
  });

  it('deletes managed rules that the predicate selects', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '5.6.7.8/32', remark: 'gd-job:home@2026-08-17 09:00:00', ruleId: 'old-1' },
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00', ruleId: 'keep-1' },
      ],
    });
    try {
      const { getRuleField } = require('../src/firewall-rule');
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        shouldDelete: rule => getRuleField(rule, 'sourceCidrIp') !== '1.2.3.4/32',
      });
      assert.strictEqual(result.deletedCount, 1);
      assert.deepStrictEqual(swasClients[0].deleteCalls[0].ruleIds, [ 'old-1' ]);
    } finally { restore(); }
  });

  it('does delete expired gd-web rules (web TTL predicate still works)', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '9.9.9.9/32', remark: 'gd-web@2020-01-01 00:00:00', ruleId: 'stale-1' },
      ],
    });
    try {
      const { isExpiredWebRule, getRuleField } = require('../src/firewall-rule');
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        shouldDelete: rule => isExpiredWebRule({
          protocol: getRuleField(rule, 'ruleProtocol'),
          port: getRuleField(rule, 'port'),
          remark: getRuleField(rule, 'remark'),
        }),
      });
      assert.strictEqual(result.deletedCount, 1);
      assert.deepStrictEqual(swasClients[0].deleteCalls[0].ruleIds, [ 'stale-1' ]);
    } finally { restore(); }
  });

  it('does not delete gd-job rules with a different label', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '5.6.7.8/32', remark: 'gd-job:office@2026-08-17 09:00:00', ruleId: 'other-1' },
      ],
    });
    try {
      const { isManagedJobRemark, getRuleField } = require('../src/firewall-rule');
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        shouldDelete: rule => isManagedJobRemark(getRuleField(rule, 'remark') || '', 'home'),
      });
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(swasClients[0].deleteCalls.length, 0);
    } finally { restore(); }
  });
});

describe('machine-firewall listMachines', () => {
  it('merges ECS and SWAS across regions and keeps going when one listing fails, naming the culprit', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({
      instances: {
        'cn-hangzhou': {
          ecs: [ { instanceId: 'i-1', instanceName: 'nas', securityGroupIds: { securityGroupId: [ 'sg-1' ] } } ],
          swas: new Error('NoPermission: code: 403'),
        },
        'cn-hongkong': {
          ecs: [],
          swas: [ { instanceId: 'swas-1', instanceName: 'blog' } ],
        },
      },
    });
    const warnings = [];
    try {
      const machines = await machineFirewall.listMachines({
        credential: CREDENTIAL,
        regions: [ 'cn-hangzhou', 'cn-hongkong' ],
        logger: { info() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
      });
      assert.deepStrictEqual(
        machines.map(m => `${m.product}/${m.regionId}/${m.instanceId}`),
        [ 'ecs/cn-hangzhou/i-1', 'swas-open/cn-hongkong/swas-1' ]
      );
      assert.deepStrictEqual(machines[0].securityGroupIds, [ 'sg-1' ]);
      // 一条 warn，且说清了是哪个产品、哪个地域
      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes('swas-open') && warnings[0].includes('cn-hangzhou') && warnings[0].includes('NoPermission'));
    } finally { restore(); }
  });
});
