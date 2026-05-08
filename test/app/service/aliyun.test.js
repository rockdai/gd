'use strict';

const assert = require('assert');

const AliyunService = require('../../../app/service/aliyun');
const { PORT_RANGE } = require('../../../lib/firewall-rule');

function loadAliyunServiceWithMocks({ ecsRules = [], swasRules = [], ecsListError = null, swasListError = null } = {}) {
  const servicePath = require.resolve('../../../app/service/aliyun');
  const ecsSdkPath = require.resolve('@alicloud/ecs20140526');
  const swasSdkPath = require.resolve('@alicloud/swas-open20200601');
  const swasFirewallPath = require.resolve('../../../lib/swas-firewall');

  const previousCache = new Map([
    [ servicePath, require.cache[servicePath] ],
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
      this.authorizeCalls = [];
      this.revokeCalls = [];
      this.listCalls = [];
      ecsClients.push(this);
    }

    async describeSecurityGroupAttribute(req) {
      this.listCalls.push(req);
      if (ecsListError) throw ecsListError;
      return {
        body: {
          permissions: {
            permission: ecsRules.map(rule => ({ ...rule })),
          },
        },
      };
    }

    async authorizeSecurityGroup(req) {
      this.authorizeCalls.push(req);
      return { body: {} };
    }

    async revokeSecurityGroup(req) {
      this.revokeCalls.push(req);
      return { body: {} };
    }
  }

  class FakeSWASClient {
    constructor() {
      this.createCalls = [];
      this.deleteCalls = [];
      swasClients.push(this);
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
      DescribeInstancesRequest: BaseRequest,
      DescribeSecurityGroupAttributeRequest: BaseRequest,
      AuthorizeSecurityGroupRequest: BaseRequest,
      RevokeSecurityGroupRequest: BaseRequest,
    },
  };

  require.cache[swasSdkPath] = {
    id: swasSdkPath,
    filename: swasSdkPath,
    loaded: true,
    exports: {
      default: FakeSWASClient,
      ListInstancesRequest: BaseRequest,
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
        if (swasListError) throw swasListError;
        return swasRules.map(rule => ({ ...rule }));
      },
    },
  };

  delete require.cache[servicePath];
  const ServiceClass = require('../../../app/service/aliyun');

  return {
    ServiceClass,
    ecsClients,
    swasClients,
    cleanup() {
      delete require.cache[servicePath];
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

function createServiceInstance(ServiceClass) {
  const warnings = [];
  const errors = [];
  const infos = [];
  const instance = Object.create(ServiceClass.prototype, {
    logger: {
      value: {
        warn(...args) { warnings.push(args); },
        error(...args) { errors.push(args); },
        info(...args) { infos.push(args); },
      },
      writable: true,
      configurable: true,
    },
  });
  return { instance, warnings, errors, infos };
}

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

  it('marks protocol results as partial when only some protocols succeed', () => {
    const result = AliyunService.prototype._buildProtocolOperationResult.call({}, [
      'TCP: added',
      'UDP: failed (boom)',
    ], {
      hasSuccess: true,
      hasFailure: true,
    });

    assert.deepStrictEqual(result, {
      status: 'partial',
      message: 'TCP: added, UDP: failed (boom)',
    });
  });

  it('marks protocol results as error when all protocols fail', () => {
    const result = AliyunService.prototype._buildProtocolOperationResult.call({}, [
      'TCP: failed (boom)',
      'UDP: failed (boom)',
    ], {
      hasSuccess: false,
      hasFailure: true,
    });

    assert.deepStrictEqual(result, {
      status: 'error',
      message: 'TCP: failed (boom), UDP: failed (boom)',
    });
  });
});

describe('AliyunService manual rule protection', () => {
  it('does not authorize ECS rules when a manual rule already covers the IP', async () => {
    const loaded = loadAliyunServiceWithMocks({
      ecsRules: [
        {
          SecurityGroupRuleId: 'manual-tcp',
          IpProtocol: 'TCP',
          PortRange: PORT_RANGE,
          Description: '云谷园区',
          SourceCidrIp: '1.2.3.4/32',
        },
        {
          SecurityGroupRuleId: 'manual-udp',
          IpProtocol: 'UDP',
          PortRange: PORT_RANGE,
          Description: '云谷园区',
          SourceCidrIp: '1.2.3.4/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._addIpToEcs(
        {},
        { regionId: 'cn-hangzhou', securityGroupId: 'sg-test', instanceId: 'i-test' },
        '1.2.3.4/32',
        'gd-web@2026-04-17 12:00:00'
      );

      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.strictEqual(loaded.ecsClients[0].authorizeCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('does not create SWAS rules when a manual rule already covers the IP', async () => {
    const loaded = loadAliyunServiceWithMocks({
      swasRules: [
        {
          ruleId: 'manual-tcp',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: '云谷园区',
          sourceCidrIp: '1.2.3.4/32',
        },
        {
          ruleId: 'manual-udp',
          ruleProtocol: 'UDP',
          port: PORT_RANGE,
          remark: '云谷园区',
          sourceCidrIp: '1.2.3.4/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._addIpToSwas(
        {},
        { regionId: 'cn-hangzhou', instanceId: 'i-test' },
        '1.2.3.4/32',
        'gd-web@2026-04-17 12:00:00'
      );

      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('does not re-create SWAS rules on repeated submissions of the same IP', async () => {
    const loaded = loadAliyunServiceWithMocks({
      swasRules: [
        {
          ruleId: 'gd-web-tcp',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: 'gd-web@2026-05-08 10:00:00',
          sourceCidrIp: '1.2.3.4/32',
        },
        {
          ruleId: 'gd-web-udp',
          ruleProtocol: 'UDP',
          port: PORT_RANGE,
          remark: 'gd-web@2026-05-08 10:00:00',
          sourceCidrIp: '1.2.3.4/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._addIpToSwas(
        {},
        { regionId: 'cn-hangzhou', instanceId: 'i-test' },
        '1.2.3.4/32',
        'gd-web@2026-05-08 11:00:00'
      );

      assert.strictEqual(result.status, 'success');
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('still creates SWAS rule when no existing rule covers the IP', async () => {
    const loaded = loadAliyunServiceWithMocks({
      swasRules: [
        {
          ruleId: 'manual-other',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: '云谷园区',
          sourceCidrIp: '5.5.5.5/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._addIpToSwas(
        {},
        { regionId: 'cn-hangzhou', instanceId: 'i-test' },
        '1.2.3.4/32',
        'gd-web@2026-05-08 11:00:00'
      );

      assert.strictEqual(result.status, 'success');
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 2);
      assert.deepStrictEqual(
        loaded.swasClients[0].createCalls.map(req => req.firewallRules[0].ruleProtocol),
        [ 'TCP', 'UDP' ]
      );
    } finally {
      loaded.cleanup();
    }
  });

  it('refuses to revoke ECS rules whose descriptions do not look like our managed format', async () => {
    const loaded = loadAliyunServiceWithMocks({
      ecsRules: [
        {
          SecurityGroupRuleId: 'sneaky-manual',
          IpProtocol: 'TCP',
          PortRange: PORT_RANGE,
          Description: '云谷园区',
          SourceCidrIp: '5.5.5.5/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._cleanupExpiredEcsRules({}, {
        regionId: 'cn-hangzhou',
        securityGroupId: 'sg-test',
        instanceId: 'i-test',
      });

      assert.deepStrictEqual(result, { deletedCount: 0 });
      assert.strictEqual(loaded.ecsClients[0].revokeCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('refuses to delete SWAS rules whose remarks do not look like our managed format', async () => {
    const loaded = loadAliyunServiceWithMocks({
      swasRules: [
        {
          ruleId: 'sneaky-manual',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: '云谷园区',
          sourceCidrIp: '5.5.5.5/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._cleanupExpiredSwasRules({}, {
        regionId: 'cn-hangzhou',
        instanceId: 'i-test',
      });

      assert.deepStrictEqual(result, { deletedCount: 0 });
      assert.strictEqual(loaded.swasClients[0].deleteCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('fails closed when ECS rule listing throws to avoid bypassing manual rule protection', async () => {
    const loaded = loadAliyunServiceWithMocks({
      ecsListError: new Error('boom'),
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._addIpToEcs(
        {},
        { regionId: 'cn-hangzhou', securityGroupId: 'sg-test', instanceId: 'i-test' },
        '1.2.3.4/32',
        'gd-web@2026-04-17 12:00:00'
      );

      assert.strictEqual(result.status, 'error');
      assert.match(result.message, /Failed to list ECS rules/);
      assert.strictEqual(loaded.ecsClients[0].authorizeCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('fails closed when SWAS rule listing throws to avoid bypassing manual rule protection', async () => {
    const loaded = loadAliyunServiceWithMocks({
      swasListError: new Error('boom'),
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._addIpToSwas(
        {},
        { regionId: 'cn-hangzhou', instanceId: 'i-test' },
        '1.2.3.4/32',
        'gd-web@2026-04-17 12:00:00'
      );

      assert.strictEqual(result.status, 'error');
      assert.match(result.message, /Failed to list SWAS rules/);
      assert.strictEqual(loaded.swasClients[0].createCalls.length, 0);
    } finally {
      loaded.cleanup();
    }
  });

  it('does delete SWAS rules whose remarks are expired gd-web', async () => {
    const loaded = loadAliyunServiceWithMocks({
      swasRules: [
        {
          ruleId: 'expired-tcp',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: 'gd-web@2020-01-01 12:00:00',
          sourceCidrIp: '5.5.5.5/32',
        },
        {
          ruleId: 'manual-tcp',
          ruleProtocol: 'TCP',
          port: PORT_RANGE,
          remark: '云谷园区',
          sourceCidrIp: '6.6.6.6/32',
        },
      ],
    });

    try {
      const { instance } = createServiceInstance(loaded.ServiceClass);
      const result = await instance._cleanupExpiredSwasRules({}, {
        regionId: 'cn-hangzhou',
        instanceId: 'i-test',
      });

      assert.strictEqual(result.deletedCount, 1);
      assert.strictEqual(loaded.swasClients[0].deleteCalls.length, 1);
      assert.deepStrictEqual(loaded.swasClients[0].deleteCalls[0].ruleIds, [ 'expired-tcp' ]);
    } finally {
      loaded.cleanup();
    }
  });
});
