'use strict';

const {
  default: ECSClient,
  DescribeInstancesRequest,
  AuthorizeSecurityGroupRequest,
  RevokeSecurityGroupRequest,
} = require('@alicloud/ecs20140526');
const {
  default: SWASClient,
  ListInstancesRequest,
  CreateFirewallRulesRequest,
  DeleteFirewallRulesRequest,
} = require('@alicloud/swas-open20200601');
const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  getRuleField,
  isOurManagedRemark,
  findRuleByProtocolPortSource,
} = require('./firewall-rule');
const { listAllFirewallRules } = require('./swas-firewall');
const { listSecurityGroupRules } = require('./ecs-firewall');

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };

// 每个 product 的字段名差异集中在这里，其余逻辑共用
const FIELDS = {
  ecs: { protocol: 'ipProtocol', port: 'portRange', remark: 'description', ruleId: 'securityGroupRuleId' },
  'swas-open': { protocol: 'ruleProtocol', port: 'port', remark: 'remark', ruleId: 'ruleId' },
};

function ecsClient(credential, regionId) {
  return new ECSClient({ endpoint: `ecs.${regionId}.aliyuncs.com`, ...credential });
}

function swasClient(credential, regionId) {
  return new SWASClient({ endpoint: `swas.${regionId}.aliyuncs.com`, regionId, ...credential });
}

async function listEcsInstances({ credential, regionId }) {
  const resp = await ecsClient(credential, regionId)
    .describeInstances(new DescribeInstancesRequest({ regionId, pageSize: 100 }));
  const instances = resp?.body?.instances?.instance || [];
  return instances.map(inst => ({
    product: 'ecs',
    instanceId: inst.instanceId,
    instanceName: inst.instanceName || inst.hostName || inst.instanceId,
    regionId,
    publicIpAddress: inst.publicIpAddress?.ipAddress || [],
    status: inst.status,
    securityGroupIds: inst.securityGroupIds?.securityGroupId || [],
    tags: (inst.tags?.tag || []).map(t => ({ key: t.tagKey, value: t.tagValue })),
  }));
}

async function listSwasInstances({ credential, regionId }) {
  const resp = await swasClient(credential, regionId)
    .listInstances(new ListInstancesRequest({ regionId, pageSize: 100 }));
  const instances = resp?.body?.instances || [];
  return instances.map(inst => ({
    product: 'swas-open',
    instanceId: inst.instanceId,
    instanceName: inst.instanceName || inst.instanceId,
    regionId,
    publicIpAddress: inst.publicIpAddress ? [ inst.publicIpAddress ] : [],
    status: inst.status,
    tags: (inst.tags || []).map(t => ({ key: t.key, value: t.value })),
  }));
}

async function listMachines({ credential, regions, logger = NOOP_LOGGER }) {
  const tasks = [];
  for (const regionId of regions) {
    for (const [ product, list ] of [ [ 'ecs', listEcsInstances ], [ 'swas-open', listSwasInstances ] ]) {
      // 单个地域/产品失败只记 warn，其余继续；warn 里带上是谁失败了，不然十个地域的 403 长得一模一样
      tasks.push(list({ credential, regionId }).catch(err => {
        logger.warn(`[machine-firewall] Failed to list ${product} instances in ${regionId}:`, err?.message || err);
        return [];
      }));
    }
  }
  return (await Promise.all(tasks)).flat();
}

function clientFor(credential, machine) {
  return machine.product === 'ecs'
    ? ecsClient(credential, machine.regionId)
    : swasClient(credential, machine.regionId);
}

// client 可选：addIpRules / cleanupRules 会把自己的 client 传进来，一次操作只建一个 client
async function listMachineRules({ credential, machine, client = clientFor(credential, machine) }) {
  if (machine.product === 'ecs') {
    return listSecurityGroupRules({
      client,
      securityGroupId: machine.securityGroupId,
      regionId: machine.regionId,
    });
  }
  return listAllFirewallRules({
    client,
    instanceId: machine.instanceId,
    regionId: machine.regionId,
  });
}

function buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure }) {
  let status = 'success';
  if (hasFailure && hasSuccess) status = 'partial';
  else if (hasFailure) status = 'error';
  return { status, message: protocolResults.join(', ') };
}

async function addIpRules({ credential, machine, sourceCidrIp, remark, rules = null, logger = NOOP_LOGGER }) {
  const { product, regionId, instanceId, securityGroupId } = machine;
  if (product === 'ecs' && !securityGroupId) {
    return { status: 'error', message: 'securityGroupId is required for ECS' };
  }
  if (!FIELDS[product]) {
    return { status: 'error', message: `Unsupported product: ${product}` };
  }

  const label = product === 'ecs' ? 'ECS' : 'SWAS';
  const client = clientFor(credential, machine);
  let existingRules = rules;
  if (!existingRules) {
    try {
      existingRules = await listMachineRules({ credential, machine, client });
    } catch (err) {
      logger.error(`[machine-firewall] Failed to list ${label} rules for pre-check on ${instanceId}:`, err.message || err);
      return {
        status: 'error',
        message: `Failed to list ${label} rules: ${err.message || err}; refusing to add to keep manual rules safe`,
      };
    }
  }

  const fields = FIELDS[product];
  const protocolResults = [];
  // 按协议记录结果：'added' | 'exists' | 'failed'。job 用它区分"已存在的是不是自己的规则"
  const protocols = {};
  let hasSuccess = false;
  let hasFailure = false;

  for (const protocol of RULE_PROTOCOLS) {
    const existing = findRuleByProtocolPortSource({
      rules: existingRules,
      protocol,
      sourceCidrIp,
      protocolField: fields.protocol,
      portField: fields.port,
    });

    if (existing) {
      protocolResults.push(`${protocol}: already exists`);
      protocols[protocol] = 'exists';
      hasSuccess = true;
      continue;
    }

    try {
      if (product === 'ecs') {
        await client.authorizeSecurityGroup(new AuthorizeSecurityGroupRequest({
          regionId, securityGroupId,
          ipProtocol: protocol, portRange: PORT_RANGE, sourceCidrIp,
          description: remark,
        }));
      } else {
        await client.createFirewallRules(new CreateFirewallRulesRequest({
          instanceId, regionId,
          firewallRules: [{ port: PORT_RANGE, ruleProtocol: protocol, sourceCidrIp, remark }],
        }));
      }
      protocolResults.push(`${protocol}: added`);
      protocols[protocol] = 'added';
      hasSuccess = true;
    } catch (err) {
      const message = err.message || '';
      if (message.includes('AuthorizationAlreadyExist') ||
          message.includes('RuleDuplicate') ||
          message.includes('FirewallRuleAlreadyExist')) {
        protocolResults.push(`${protocol}: already exists`);
        protocols[protocol] = 'exists';
        hasSuccess = true;
        continue;
      }
      protocolResults.push(`${protocol}: failed (${message})`);
      protocols[protocol] = 'failed';
      hasFailure = true;
    }
  }

  return { ...buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure }), protocols };
}

async function cleanupRules({ credential, machine, shouldDelete, rules = null, logger = NOOP_LOGGER }) {
  const { product, regionId, instanceId, securityGroupId } = machine;
  if (product === 'ecs' && !securityGroupId) return { deletedCount: 0 };
  if (!FIELDS[product]) return { deletedCount: 0 };

  const fields = FIELDS[product];
  const client = clientFor(credential, machine);
  const existingRules = rules || await listMachineRules({ credential, machine, client });

  // isOurManagedRemark 是 fail-closed 外层守卫：谓词再宽也不会碰到手工规则
  const staleRules = existingRules.filter(rule => {
    const remark = getRuleField(rule, fields.remark);
    if (!isOurManagedRemark(remark)) return false;
    return shouldDelete(rule);
  });
  const staleRuleIds = staleRules.map(rule => getRuleField(rule, fields.ruleId)).filter(Boolean);
  if (staleRuleIds.length === 0) return { deletedCount: 0 };

  logger.info(`[machine-firewall] Cleaning up ${staleRuleIds.length} rule(s) on ${instanceId || securityGroupId}: ${staleRules.map(r => getRuleField(r, fields.remark)).join(', ')}`);

  if (product === 'ecs') {
    await client.revokeSecurityGroup(new RevokeSecurityGroupRequest({
      regionId, securityGroupId, securityGroupRuleId: staleRuleIds,
    }));
  } else {
    await client.deleteFirewallRules(new DeleteFirewallRulesRequest({
      instanceId, regionId, ruleIds: staleRuleIds,
    }));
  }
  return { deletedCount: staleRuleIds.length };
}

module.exports = {
  FIELDS,
  listMachines,
  listEcsInstances,
  listSwasInstances,
  listMachineRules,
  addIpRules,
  cleanupRules,
  buildProtocolOperationResult,
};
