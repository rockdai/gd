'use strict';

const {
  default: SWASClient,
  ListFirewallRulesRequest,
  CreateFirewallRulesRequest,
  ModifyFirewallRuleRequest,
} = require('@alicloud/swas-open20200601');

const PORT_RANGE = '1/65535';
const RULE_PROTOCOL = 'TCP';

/** Normalize IP to CIDR format for API; single IP becomes x.x.x.x/32 */
function toSourceCidrIp(ip) {
  if (!ip || ip.includes('/')) return ip;
  return `${ip}/32`;
}

/** Normalize for comparison; "115.205.26.96" and "115.205.26.96/32" are equivalent */
function normalizeIpForCompare(ip) {
  if (!ip) return ip;
  return ip.includes('/') ? ip : `${ip}/32`;
}

/** Format current date/time for remark, e.g. "2025-01-15 10:30:45" */
function formatDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

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

  const remarkWithDate = `${remark}@${formatDateTime()}`;

  // 1) list existing rules
  const listReq = new ListFirewallRulesRequest({
    instanceId: conf.instanceId,
    pageNumber: 1,
    pageSize: 100,
  });

  const listResp = await client.listFirewallRules(listReq);
  const rules = pickFirewallRules(listResp.body);

  const ipNorm = normalizeIpForCompare(ip);
  const sameIpRules = rules.filter(r => normalizeIpForCompare(getRuleField(r, 'sourceCidrIp')) === ipNorm);
  const handlerRules = rules.filter(r => {
    const rRemark = getRuleField(r, 'remark') || '';
    return rRemark === remark || rRemark.startsWith(remark + '@');
  });

  // If handler rule exists, we "move" it to current IP (idempotent for repeated runs).
  if (handlerRules.length > 0) {
    const r = handlerRules[0];
    const ruleId = getRuleField(r, 'ruleId');
    const currentIp = getRuleField(r, 'sourceCidrIp');
    if (!ruleId) throw new Error('Existing handler rule found but missing ruleId in API response');

    if (normalizeIpForCompare(currentIp) === ipNorm) {
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
      sourceCidrIp: toSourceCidrIp(ip),
      remark: remarkWithDate,
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

  console.log(`[ecs-dsec-handler] create handler rule for ip=${ip} remark=${remarkWithDate}`);
  if (dryRun) return { action: 'dry-run-create' };

  // CreateFirewallRule (singular) does NOT support sourceCidrIp - it defaults to 0.0.0.0/0!
  // Use CreateFirewallRules (plural) which supports sourceCidrIp in each rule.
  const createReq = new CreateFirewallRulesRequest({
    instanceId: conf.instanceId,
    regionId: conf.regionId,
    firewallRules: [{
      port: PORT_RANGE,
      ruleProtocol: RULE_PROTOCOL,
      sourceCidrIp: toSourceCidrIp(ip),
      remark: remarkWithDate,
    }],
  });

  const createResp = await client.createFirewallRules(createReq);
  const createdRuleId = createResp?.body?.firewallRuleIds?.[0] || createResp?.body?.FirewallRuleIds?.[0];
  console.log('[ecs-dsec-handler] created ruleId =', createdRuleId || '(unknown)');
  return { action: 'created', ruleId: createdRuleId };
}

module.exports = { handleSwasOpen };
