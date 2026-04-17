'use strict';

const {
  default: SWASClient,
  CreateFirewallRulesRequest,
  ModifyFirewallRuleRequest,
} = require('@alicloud/swas-open20200601');

const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeIpForCompare,
  normalizeProtocol,
  buildManagedCliRemark,
  isManagedCliRemark,
  getRuleField,
} = require('./firewall-rule');
const { listAllFirewallRules } = require('./swas-firewall');

async function ensureSwasRuleForProtocol({ client, conf, rules, ip, remark, dryRun, protocol }) {
  const remarkWithDate = buildManagedCliRemark(remark);
  const ipNorm = normalizeIpForCompare(ip);
  const sameIpRule = rules.find(r => (
    normalizeProtocol(getRuleField(r, 'ruleProtocol')) === protocol &&
    normalizeIpForCompare(getRuleField(r, 'sourceCidrIp')) === ipNorm
  ));
  const handlerRule = rules.find(r => (
    normalizeProtocol(getRuleField(r, 'ruleProtocol')) === protocol &&
    isManagedCliRemark(getRuleField(r, 'remark') || '', remark)
  ));

  if (handlerRule) {
    const ruleId = getRuleField(handlerRule, 'ruleId');
    const currentIp = getRuleField(handlerRule, 'sourceCidrIp');
    if (!ruleId) throw new Error(`Existing handler rule found but missing ruleId for protocol=${protocol}`);

    if (normalizeIpForCompare(currentIp) === ipNorm) {
      console.log(`[ecs-dsec-handler] ${protocol} handler rule already points to ip=${ip} (ruleId=${ruleId}), skip`);
      return { action: 'noop', protocol, ruleId };
    }

    if (sameIpRule && getRuleField(sameIpRule, 'ruleId') !== ruleId) {
      console.log(`[ecs-dsec-handler] ${protocol} ip=${ip} already allowed by another rule, skip updating handler rule (avoid duplicate)`);
      return { action: 'noop-duplicate', protocol, ruleId };
    }

    console.log(`[ecs-dsec-handler] update ${protocol} handler rule ${ruleId}: ${currentIp} -> ${ip}`);
    if (dryRun) return { action: 'dry-run-modify', protocol, ruleId };

    const modReq = new ModifyFirewallRuleRequest({
      instanceId: conf.instanceId,
      ruleId,
      sourceCidrIp: toSourceCidrIp(ip),
      remark: remarkWithDate,
      ruleProtocol: protocol,
      port: PORT_RANGE,
    });

    await client.modifyFirewallRule(modReq);
    return { action: 'modified', protocol, ruleId };
  }

  if (sameIpRule) {
    console.log(`[ecs-dsec-handler] ${protocol} ip=${ip} already allowed by existing rule(s); no handler rule created (aliyun forbids duplicates)`);
    return { action: 'noop-duplicate-no-handler', protocol };
  }

  console.log(`[ecs-dsec-handler] create ${protocol} handler rule for ip=${ip} remark=${remarkWithDate}`);
  if (dryRun) return { action: 'dry-run-create', protocol };

  const createReq = new CreateFirewallRulesRequest({
    instanceId: conf.instanceId,
    regionId: conf.regionId,
    firewallRules: [{
      port: PORT_RANGE,
      ruleProtocol: protocol,
      sourceCidrIp: toSourceCidrIp(ip),
      remark: remarkWithDate,
    }],
  });

  const createResp = await client.createFirewallRules(createReq);
  const createdRuleId = createResp?.body?.firewallRuleIds?.[0] || createResp?.body?.FirewallRuleIds?.[0];
  console.log(`[ecs-dsec-handler] created ${protocol} ruleId =`, createdRuleId || '(unknown)');
  return { action: 'created', protocol, ruleId: createdRuleId };
}

async function handleSwasOpen({ conf, ip, remark, dryRun, credential }) {
  const client = new SWASClient({
    endpoint: `swas.${conf.regionId}.aliyuncs.com`,
    regionId: conf.regionId,
    ...credential,
  });

  console.log(`[ecs-dsec-handler] swas-open instance=${conf.instanceId} region=${conf.regionId}`);

  const rules = await listAllFirewallRules({
    client,
    instanceId: conf.instanceId,
    regionId: conf.regionId,
  });
  const results = [];

  for (const protocol of RULE_PROTOCOLS) {
    results.push(await ensureSwasRuleForProtocol({
      client,
      conf,
      rules,
      ip,
      remark,
      dryRun,
      protocol,
    }));
  }

  return { action: 'multi', results };
}

module.exports = {
  handleSwasOpen,
  __private__: {
    ensureSwasRuleForProtocol,
  },
};
