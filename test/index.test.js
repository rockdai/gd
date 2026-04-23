'use strict';

const assert = require('assert');

const { PORT_RANGE } = require('../lib/firewall-rule');

function loadIndexWithMocks({ ecsRules = [], swasRules = [] } = {}) {
  const indexPath = require.resolve('../index');
  const ecsSdkPath = require.resolve('@alicloud/ecs20140526');
  const swasSdkPath = require.resolve('@alicloud/swas-open20200601');
  const swasFirewallPath = require.resolve('../lib/swas-firewall');

  const previousCache = new Map([
    [ indexPath, require.cache[indexPath] ],
    [ ecsSdkPath, require.cache[ecsSdkPath] ],
    [ swasSdkPath, require.cache[swasSdkPath] ],
    [ swasFirewallPath, require.cache[swasFirewallPath] ],
  ]);

  const ecsClients = [];
  const swasClients = [];

  class BaseRequest {
    constructor(fields) {
      Object.assign(this, fields);
    }
  }

  class FakeECSClient {
    constructor() {
      this.modifyCalls = [];
      this.authorizeCalls = [];
      ecsClients.push(this);
    }

    async describeSecurityGroupAttribute() {
      return {
        body: {
          permissions: {
            permission: ecsRules.map(rule => ({ ...rule })),
          },
        },
      };
    }

    async modifySecurityGroupRule(req) {
      this.modifyCalls.push(req);
      return { body: {} };
    }

    async authorizeSecurityGroup(req) {
      this.authorizeCalls.push(req);
      return { body: {} };
    }
  }

  class FakeSWASClient {
    constructor() {
      this.modifyCalls = [];
      this.createCalls = [];
      this.deleteCalls = [];
      swasClients.push(this);
    }

    async modifyFirewallRule(req) {
      this.modifyCalls.push(req);
      return { body: {} };
    }

    async createFirewallRules(req) {
      this.createCalls.push(req);
      return { body: { firewallRuleIds: [ `created-${this.createCalls.length}` ] } };
    }

    async deleteFirewallRules(req) {
      this.deleteCalls.push(req);
      return { body: {} };
    }
  }

  require.cache[ecsSdkPath] = {
    id: ecsSdkPath,
    filename: ecsSdkPath,
    loaded: true,
    exports: {
      default: FakeECSClient,
      ModifySecurityGroupRuleRequest: BaseRequest,
      DescribeSecurityGroupAttributeRequest: BaseRequest,
      AuthorizeSecurityGroupRequest: BaseRequest,
    },
  };

  require.cache[swasSdkPath] = {
    id: swasSdkPath,
    filename: swasSdkPath,
    loaded: true,
    exports: {
      default: FakeSWASClient,
      ModifyFirewallRuleRequest: BaseRequest,
      CreateFirewallRulesRequest: BaseRequest,
      DeleteFirewallRulesRequest: BaseRequest,
    },
  };

  require.cache[swasFirewallPath] = {
    id: swasFirewallPath,
    filename: swasFirewallPath,
    loaded: true,
    exports: {
      async listAllFirewallRules() {
        return swasRules.map(rule => ({ ...rule }));
      },
    },
  };

  delete require.cache[indexPath];
  const mod = require('../index');

  return {
    mod,
    ecsClients,
    swasClients,
    cleanup() {
      delete require.cache[indexPath];
      for (const [ path, cached ] of previousCache.entries()) {
        if (cached) {
          require.cache[path] = cached;
        } else {
          delete require.cache[path];
        }
      }
    },
  };
}

describe('scheduler rule ownership', () => {
  it('does not modify ECS rules that are manually maintained even when their id is configured', async () => {
    const loaded = loadIndexWithMocks({
      ecsRules: [ {
        SecurityGroupRuleId: 'manual-ecs-rule',
        IpProtocol: 'TCP',
        PortRange: PORT_RANGE,
        Description: '云谷园区',
        SourceCidrIp: '140.205.11.0/27',
      } ],
    });

    try {
      const errors = await loaded.mod.__private__.handleEcsRuleConfig({
        conf: {
          product: 'ecs',
          regionId: 'cn-hangzhou',
          groupId: 'sg-test',
          ruleList: [ { name: 'xfyj.keydiary.dev', id: 'manual-ecs-rule' } ],
        },
        ipMap: {
          'xfyj.keydiary.dev': '1.2.3.4',
        },
        current: '2026-04-17 12:00:00',
        credential: {},
      });

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(loaded.ecsClients.length, 1);
      assert.strictEqual(loaded.ecsClients[0].modifyCalls.length, 0);
      assert.strictEqual(loaded.ecsClients[0].authorizeCalls.length, 2);
      assert.deepStrictEqual(
        loaded.ecsClients[0].authorizeCalls.map(req => req.ipProtocol),
        [ 'TCP', 'UDP' ]
      );
      assert(loaded.ecsClients[0].authorizeCalls.every(req => req.description === 'gd-ddns:xfyj.keydiary.dev@2026-04-17 12:00:00'));
    } finally {
      loaded.cleanup();
    }
  });

  it('does not modify SWAS rules that are manually maintained even when their id is configured', async () => {
    const loaded = loadIndexWithMocks({
      swasRules: [ {
        ruleId: 'manual-swas-rule',
        ruleProtocol: 'TCP',
        port: PORT_RANGE,
        remark: '云谷园区',
        sourceCidrIp: '140.205.11.224/27',
      } ],
    });

    try {
      const errors = await loaded.mod.__private__.handleSwasRuleConfig({
        conf: {
          product: 'swas-open',
          regionId: 'cn-hangzhou',
          instanceId: 'i-test',
          ruleList: [ { name: 'xfyj.keydiary.dev', id: 'manual-swas-rule' } ],
        },
        ipMap: {
          'xfyj.keydiary.dev': '1.2.3.4',
        },
        current: '2026-04-17 12:00:00',
        credential: {},
      });

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(loaded.swasClients.length, 1);
      assert.strictEqual(loaded.swasClients[0].modifyCalls.length, 0);
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 2);
      assert.deepStrictEqual(
        loaded.swasClients[0].createCalls.map(req => req.firewallRules[0].ruleProtocol),
        [ 'TCP', 'UDP' ]
      );
      assert(loaded.swasClients[0].createCalls.every(req => req.firewallRules[0].remark === 'gd-ddns:xfyj.keydiary.dev@2026-04-17 12:00:00'));
    } finally {
      loaded.cleanup();
    }
  });

  it('continues to update legacy scheduler-managed rules and migrates their remark format', async () => {
    const loaded = loadIndexWithMocks({
      swasRules: [ {
        ruleId: 'legacy-managed-rule',
        ruleProtocol: 'TCP',
        port: PORT_RANGE,
        remark: 'xfyj.keydiary.dev@2026-04-16 09:00:00',
        sourceCidrIp: '2.2.2.2/32',
      } ],
    });

    try {
      const errors = await loaded.mod.__private__.handleSwasRuleConfig({
        conf: {
          product: 'swas-open',
          regionId: 'cn-hangzhou',
          instanceId: 'i-test',
          ruleList: [ { name: 'xfyj.keydiary.dev', id: 'legacy-managed-rule' } ],
        },
        ipMap: {
          'xfyj.keydiary.dev': '1.2.3.4',
        },
        current: '2026-04-17 12:00:00',
        credential: {},
      });

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(loaded.swasClients.length, 1);
      assert.strictEqual(loaded.swasClients[0].modifyCalls.length, 1);
      assert.strictEqual(loaded.swasClients[0].modifyCalls[0].ruleId, 'legacy-managed-rule');
      assert.strictEqual(loaded.swasClients[0].modifyCalls[0].remark, 'gd-ddns:xfyj.keydiary.dev@2026-04-17 12:00:00');
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 1);
      assert.strictEqual(loaded.swasClients[0].createCalls[0].firewallRules[0].ruleProtocol, 'UDP');
    } finally {
      loaded.cleanup();
    }
  });

  it('dedupes duplicate managed SWAS rules and keeps one managed rule per protocol', async () => {
    const loaded = loadIndexWithMocks({
      swasRules: [
        {
          ruleId: 'managed-tcp-1',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: 'gd-ddns:xfyj.keydiary.dev@2026-04-16 09:00:00',
          sourceCidrIp: '2.2.2.2/32',
        },
        {
          ruleId: 'managed-tcp-2',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: 'gd-ddns:xfyj.keydiary.dev@2026-04-16 10:00:00',
          sourceCidrIp: '3.3.3.3/32',
        },
        {
          ruleId: 'managed-udp-1',
          ruleProtocol: 'UDP',
          port: PORT_RANGE,
          remark: 'gd-ddns:xfyj.keydiary.dev@2026-04-16 11:00:00',
          sourceCidrIp: '4.4.4.4/32',
        },
      ],
    });

    try {
      const errors = await loaded.mod.__private__.handleSwasRuleConfig({
        conf: {
          product: 'swas-open',
          regionId: 'cn-hangzhou',
          instanceId: 'i-test',
          ruleList: [ { name: 'xfyj.keydiary.dev', id: 'managed-tcp-1' } ],
        },
        ipMap: {
          'xfyj.keydiary.dev': '1.2.3.4',
        },
        current: '2026-04-17 12:00:00',
        credential: {},
      });

      assert.deepStrictEqual(errors, []);
      assert.strictEqual(loaded.swasClients.length, 1);
      assert.strictEqual(loaded.swasClients[0].modifyCalls.length, 2);
      assert.deepStrictEqual(
        loaded.swasClients[0].modifyCalls.map(req => req.ruleId),
        [ 'managed-tcp-1', 'managed-udp-1' ]
      );
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 0);
      assert.strictEqual(loaded.swasClients[0].deleteCalls.length, 1);
      assert.deepStrictEqual(loaded.swasClients[0].deleteCalls[0].ruleIds, [ 'managed-tcp-2' ]);
    } finally {
      loaded.cleanup();
    }
  });
});
