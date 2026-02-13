'use strict';

const {
  default: SWASClient,
  ListFirewallRulesRequest,
  CreateFirewallRuleRequest,
  ModifyFirewallRuleRequest,
} = require('@alicloud/swas-open20200601');

const PORT_RANGE = '1/65535';
const RULE_PROTOCOL = 'TCP';

function pickFirewallRules(respBody) {
  // The SDK usually returns `resp.body.firewallRules` as an array.
  if (!respBody) return [];
  if (Array.isArray(respBody.firewallRules)) return respBody.firewallRules;
  if (Array.isArray(respBody.FirewallRules)) return respBody.FirewallRules;
  return [];
}

function getRuleField(rule, field) {
  if (!rule) return undefined;
  // tolerate different casings
  return rule[field] ?? rule[field[0].toUpperCase() + field.slice(1)];
}

async function handleSwasOpen({ conf, ip, remark, dryRun, credential }) {
  const client = new SWASClient({
    endpoint: `swas.${conf.regionId}.aliyuncs.com`,
    regionId: conf.regionId,
    ...credential,
  });

  console.log(`[ecs-dsec-handler] swas-open instance=${conf.instanceId} region=${conf.regionId}`);

  // 1) list existing rules
  const listReq = new ListFirewallRulesRequest({
    instanceId: conf.instanceId,
    pageNumber: 1,
    pageSize: 100,
  });

  const listResp = await client.listFirewallRules(listReq);
  const rules = pickFirewallRules(listResp.body);

  const sameIpRules = rules.filter(r => getRuleField(r, 'sourceCidrIp') === ip);
  const handlerRules = rules.filter(r => getRuleField(r, 'remark') === remark);

  // If handler rule exists, we "move" it to current IP (idempotent for repeated runs).
  if (handlerRules.length > 0) {
    const r = handlerRules[0];
    const ruleId = getRuleField(r, 'ruleId');
    const currentIp = getRuleField(r, 'sourceCidrIp');
    if (!ruleId) throw new Error('Existing handler rule found but missing ruleId in API response');

    if (currentIp === ip) {
      console.log(`[ecs-dsec-handler] handler rule already points to ip=${ip} (ruleId=${ruleId}), skip`);
      return { action: 'noop', ruleId };
    }

    // If another rule already uses the same IP, Aliyun may reject duplicates. In that case we just report success.
    if (sameIpRules.length > 0) {
      console.log(`[ecs-dsec-handler] ip=${ip} already allowed by another rule, skip updating handler rule (avoid duplicate)`);
      return { action: 'noop-duplicate', ruleId };
    }

    console.log(`[ecs-dsec-handler] update handler rule ${ruleId}: ${currentIp} -> ${ip}`);
    if (dryRun) return { action: 'dry-run-modify', ruleId };

    const modReq = new ModifyFirewallRuleRequest({
      instanceId: conf.instanceId,
      ruleId,
      sourceCidrIp: ip,
      remark,
      ruleProtocol: RULE_PROTOCOL,
      port: PORT_RANGE,
    });

    await client.modifyFirewallRule(modReq);
    return { action: 'modified', ruleId };
  }

  // No handler rule yet: if ip is already present in some other rule, we can't create a duplicate.
  if (sameIpRules.length > 0) {
    console.log(`[ecs-dsec-handler] ip=${ip} already allowed by existing rule(s); no handler rule created (aliyun forbids duplicates)`);
    return { action: 'noop-duplicate-no-handler' };
  }

  console.log(`[ecs-dsec-handler] create handler rule for ip=${ip} remark=${remark}`);
  if (dryRun) return { action: 'dry-run-create' };

  const createReq = new CreateFirewallRuleRequest({
    instanceId: conf.instanceId,
    ruleProtocol: RULE_PROTOCOL,
    port: PORT_RANGE,
    sourceCidrIp: ip,
    remark,
  });

  const createResp = await client.createFirewallRule(createReq);
  const createdRuleId = createResp?.body?.ruleId || createResp?.body?.RuleId;
  console.log('[ecs-dsec-handler] created ruleId =', createdRuleId || '(unknown)');
  return { action: 'created', ruleId: createdRuleId };
}

module.exports = { handleSwasOpen };
