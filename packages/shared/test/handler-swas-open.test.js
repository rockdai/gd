'use strict';

const assert = require('assert');

const { PORT_RANGE } = require('../src/firewall-rule');
const { __private__: { ensureSwasRuleForProtocol } } = require('../src/handler-swas-open');

function createClient() {
  return {
    modifyCalls: [],
    createCalls: [],
    async modifyFirewallRule(req) {
      this.modifyCalls.push(req);
      return { body: {} };
    },
    async createFirewallRules(req) {
      this.createCalls.push(req);
      return { body: { firewallRuleIds: [ 'created-rule-id' ] } };
    },
  };
}

describe('swas CLI rule ownership', () => {
  it('does not modify manual rules that only share the plain CLI remark', async () => {
    const client = createClient();

    const result = await ensureSwasRuleForProtocol({
      client,
      conf: {
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      rules: [ {
        ruleId: 'manual-rule',
        ruleProtocol: 'TCP',
        port: PORT_RANGE,
        remark: 'ecs-dsec-handler',
        sourceCidrIp: '140.205.11.0/27',
      } ],
      ip: '1.2.3.4',
      remark: 'ecs-dsec-handler',
      dryRun: false,
      protocol: 'TCP',
    });

    assert.strictEqual(result.action, 'created');
    assert.strictEqual(client.modifyCalls.length, 0);
    assert.strictEqual(client.createCalls.length, 1);
    assert.match(client.createCalls[0].firewallRules[0].remark, /^gd-cli:ecs-dsec-handler@/);
  });

  it('updates rules that are already managed by the CLI prefix', async () => {
    const client = createClient();

    const result = await ensureSwasRuleForProtocol({
      client,
      conf: {
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      rules: [ {
        ruleId: 'managed-rule',
        ruleProtocol: 'TCP',
        port: PORT_RANGE,
        remark: 'gd-cli:ecs-dsec-handler@2026-04-17 10:00:00',
        sourceCidrIp: '2.2.2.2/32',
      } ],
      ip: '1.2.3.4',
      remark: 'ecs-dsec-handler',
      dryRun: false,
      protocol: 'TCP',
    });

    assert.strictEqual(result.action, 'modified');
    assert.strictEqual(client.createCalls.length, 0);
    assert.strictEqual(client.modifyCalls.length, 1);
    assert.match(client.modifyCalls[0].remark, /^gd-cli:ecs-dsec-handler@/);
    assert.strictEqual(client.modifyCalls[0].sourceCidrIp, '1.2.3.4/32');
  });

  it('updates legacy CLI-managed rules and migrates them to the new prefix', async () => {
    const client = createClient();

    const result = await ensureSwasRuleForProtocol({
      client,
      conf: {
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      rules: [ {
        ruleId: 'legacy-managed-rule',
        ruleProtocol: 'TCP',
        port: PORT_RANGE,
        remark: 'ecs-dsec-handler@2026-04-17 10:00:00',
        sourceCidrIp: '2.2.2.2/32',
      } ],
      ip: '1.2.3.4',
      remark: 'ecs-dsec-handler',
      dryRun: false,
      protocol: 'TCP',
    });

    assert.strictEqual(result.action, 'modified');
    assert.strictEqual(client.createCalls.length, 0);
    assert.strictEqual(client.modifyCalls.length, 1);
    assert.match(client.modifyCalls[0].remark, /^gd-cli:ecs-dsec-handler@/);
    assert.strictEqual(client.modifyCalls[0].sourceCidrIp, '1.2.3.4/32');
  });

  it('avoids duplicate creation when a manual rule already allows the target ip', async () => {
    const client = createClient();

    const result = await ensureSwasRuleForProtocol({
      client,
      conf: {
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      rules: [ {
        ruleId: 'manual-rule',
        ruleProtocol: 'TCP',
        port: PORT_RANGE,
        remark: '云谷园区',
        sourceCidrIp: '1.2.3.4/32',
      } ],
      ip: '1.2.3.4',
      remark: 'ecs-dsec-handler',
      dryRun: false,
      protocol: 'TCP',
    });

    assert.strictEqual(result.action, 'noop-duplicate-no-handler');
    assert.strictEqual(client.modifyCalls.length, 0);
    assert.strictEqual(client.createCalls.length, 0);
  });
});
