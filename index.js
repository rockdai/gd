const {
  default: ECSClient,
  ModifySecurityGroupRuleRequest,
  DescribeSecurityGroupAttributeRequest,
  AuthorizeSecurityGroupRequest,
} = require('@alicloud/ecs20140526');
const {
  default: SWASClient,
  ModifyFirewallRuleRequest,
  CreateFirewallRulesRequest,
} = require('@alicloud/swas-open20200601');

const { DOMAIN, RuleConfig } = require('./config');
const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeProtocol,
  formatDateTime,
  getRuleField,
  hasRemarkPrefix,
} = require('./lib/firewall-rule');
const { listAllFirewallRules } = require('./lib/swas-firewall');

exports.handler = (evt, ctx, cb) => {
  (async () => {

    // 首先将所有域名解析出 IP 地址以备后用
    const domainList = Object.values(DOMAIN);
    console.log('Domain config', domainList);

    const ipMap = {};
    for (const domain of domainList) {
      const addrs = await fetchDns(domain);
      console.log('::::Domain', domain, 'parsed result', addrs);
      ipMap[domain] = addrs;
    }
    console.log('Domain parsed result', ipMap);

    const credential = {
      accessKeyId: process.env.ACCESS_KEY_ID,
      accessKeySecret: process.env.ACCESS_KEY_SECRET,
    };
    const errors = [];
    // 逐条处理
    for (const CONF of RuleConfig) {
      console.log('----------------------------------------');
      console.log('Start to handle', CONF);
      const current = formatDateTime();

      try {
        if (CONF.product === 'ecs') {
          errors.push(...await handleEcsRuleConfig({ conf: CONF, ipMap, current, credential }));
        }
        if (CONF.product === 'swas-open') {
          errors.push(...await handleSwasRuleConfig({ conf: CONF, ipMap, current, credential }));
        }
      } catch (ex) {
        errors.push(buildRuleError({
          conf: CONF,
          ruleName: '*',
          protocol: '*',
          phase: 'config',
          message: ex.message,
        }));
      }
    }

    if (errors.length > 0) {
      throw new Error(`Failed to reconcile ${errors.length} rule operation(s):\n${errors.join('\n')}`);
    }
    return cb(null, true);
  })().catch(ex => {
    console.log(ex);
    cb(ex);
  });
};

async function handleEcsRuleConfig({ conf, ipMap, current, credential }) {
  const client = new ECSClient({
    endpoint: `ecs.${conf.regionId}.aliyuncs.com`,
    ...credential,
  });
  const rules = await listEcsRules(client, conf);
  const errors = [];

  for (const ruleConf of conf.ruleList) {
    const sourceCidrIp = toSourceCidrIp(ipMap[ruleConf.name]);
    const description = `${ruleConf.name}@${current}`;

    for (const protocol of RULE_PROTOCOLS) {
      const targetRule = findManagedRule({
        rules,
        ruleConf,
        protocol,
        idField: 'securityGroupRuleId',
        protocolField: 'ipProtocol',
        remarkField: 'description',
        portField: 'portRange',
      });

      if (targetRule) {
        const ruleId = getRuleField(targetRule, 'securityGroupRuleId');
        const rule = new ModifySecurityGroupRuleRequest({
          regionId: conf.regionId,
          securityGroupId: conf.groupId,
          securityGroupRuleId: ruleId,
          sourceCidrIp,
          description,
          ipProtocol: protocol,
          portRange: PORT_RANGE,
        });
        console.log('Rule to config', rule);
        try {
          const resp = await client.modifySecurityGroupRule(rule);
          console.log('Config response', resp.body);
          targetRule.sourceCidrIp = sourceCidrIp;
          targetRule.description = description;
        } catch (ex) {
          if (ex.message.includes('RuleDuplicate')) {
            console.log(`Security group ${protocol} rule already exists, skip`);
            continue;
          }
          errors.push(buildRuleError({
            conf,
            ruleName: ruleConf.name,
            protocol,
            phase: 'modify',
            message: ex.message,
          }));
          continue;
        }
        continue;
      }

      const createReq = new AuthorizeSecurityGroupRequest({
        regionId: conf.regionId,
        securityGroupId: conf.groupId,
        sourceCidrIp,
        description,
        ipProtocol: protocol,
        portRange: PORT_RANGE,
      });
      console.log('Rule to create', createReq);
      try {
        const resp = await client.authorizeSecurityGroup(createReq);
        console.log('Create response', resp.body);
        rules.push({
          securityGroupRuleId: undefined,
          sourceCidrIp,
          description,
          ipProtocol: protocol,
          portRange: PORT_RANGE,
        });
      } catch (ex) {
        if (ex.message.includes('AuthorizationAlreadyExist') || ex.message.includes('RuleDuplicate')) {
          console.log(`Security group ${protocol} rule already exists, skip create`);
          continue;
        }
        errors.push(buildRuleError({
          conf,
          ruleName: ruleConf.name,
          protocol,
          phase: 'create',
          message: ex.message,
        }));
      }
    }
  }

  return errors;
}

async function handleSwasRuleConfig({ conf, ipMap, current, credential }) {
  const client = new SWASClient({
    endpoint: `swas.${conf.regionId}.aliyuncs.com`,
    regionId: conf.regionId,
    ...credential,
  });
  const rules = await listSwasRules(client, conf);
  const errors = [];

  for (const ruleConf of conf.ruleList) {
    const sourceCidrIp = toSourceCidrIp(ipMap[ruleConf.name]);
    const remark = `${ruleConf.name}@${current}`;

    for (const protocol of RULE_PROTOCOLS) {
      const targetRule = findManagedRule({
        rules,
        ruleConf,
        protocol,
        idField: 'ruleId',
        protocolField: 'ruleProtocol',
        remarkField: 'remark',
        portField: 'port',
      });

      if (targetRule) {
        const rule = new ModifyFirewallRuleRequest({
          instanceId: conf.instanceId,
          ruleId: getRuleField(targetRule, 'ruleId'),
          sourceCidrIp,
          remark,
          ruleProtocol: protocol,
          port: PORT_RANGE,
        });
        console.log('Rule to config', rule);
        try {
          const resp = await client.modifyFirewallRule(rule);
          console.log('Config response', resp.body);
          targetRule.sourceCidrIp = sourceCidrIp;
          targetRule.remark = remark;
        } catch (ex) {
          if (ex.message.includes('FirewallRuleAlreadyExist')) {
            console.log(`Firewall ${protocol} rule already exists, skip`);
            continue;
          }
          errors.push(buildRuleError({
            conf,
            ruleName: ruleConf.name,
            protocol,
            phase: 'modify',
            message: ex.message,
          }));
          continue;
        }
        continue;
      }

      const createReq = new CreateFirewallRulesRequest({
        instanceId: conf.instanceId,
        regionId: conf.regionId,
        firewallRules: [{
          port: PORT_RANGE,
          ruleProtocol: protocol,
          sourceCidrIp,
          remark,
        }],
      });
      console.log('Rule to create', createReq);
      try {
        const resp = await client.createFirewallRules(createReq);
        console.log('Create response', resp.body);
        rules.push({
          ruleId: resp?.body?.firewallRuleIds?.[0] || resp?.body?.FirewallRuleIds?.[0],
          sourceCidrIp,
          remark,
          ruleProtocol: protocol,
          port: PORT_RANGE,
        });
      } catch (ex) {
        if (ex.message.includes('FirewallRuleAlreadyExist')) {
          console.log(`Firewall ${protocol} rule already exists, skip create`);
          continue;
        }
        errors.push(buildRuleError({
          conf,
          ruleName: ruleConf.name,
          protocol,
          phase: 'create',
          message: ex.message,
        }));
      }
    }
  }

  return errors;
}

async function listEcsRules(client, conf) {
  const req = new DescribeSecurityGroupAttributeRequest({
    regionId: conf.regionId,
    securityGroupId: conf.groupId,
    direction: 'ingress',
    maxResults: 1000,
  });
  const resp = await client.describeSecurityGroupAttribute(req);
  return resp?.body?.permissions?.permission || [];
}

async function listSwasRules(client, conf) {
  return await listAllFirewallRules({
    client,
    instanceId: conf.instanceId,
    regionId: conf.regionId,
  });
}

function findManagedRule({ rules, ruleConf, protocol, idField, protocolField, remarkField, portField }) {
  const configuredIds = getConfiguredRuleIds(ruleConf);
  const configuredId = configuredIds[protocol];
  if (configuredId) {
    const exactRule = rules.find(rule => getRuleField(rule, idField) === configuredId);
    if (exactRule) return exactRule;
  }

  const matchedByRemark = rules.find(rule => (
    normalizeProtocol(getRuleField(rule, protocolField)) === protocol &&
    getRuleField(rule, portField) === PORT_RANGE &&
    hasRemarkPrefix(getRuleField(rule, remarkField) || '', ruleConf.name)
  ));
  if (matchedByRemark) return matchedByRemark;

  if (!configuredIds.default) return null;
  const defaultRule = rules.find(rule => getRuleField(rule, idField) === configuredIds.default);
  if (!defaultRule) return null;
  return normalizeProtocol(getRuleField(defaultRule, protocolField)) === protocol ? defaultRule : null;
}

function getConfiguredRuleIds(ruleConf) {
  const configuredIds = {};
  if (ruleConf.ids && typeof ruleConf.ids === 'object') {
    for (const protocol of RULE_PROTOCOLS) {
      const configuredId = ruleConf.ids[protocol];
      if (configuredId) configuredIds[protocol] = configuredId;
    }
  }
  if (ruleConf.id) configuredIds.default = ruleConf.id;
  return configuredIds;
}

function buildRuleError({ conf, ruleName, protocol, phase, message }) {
  const identity = conf.groupId || conf.instanceId || '*';
  return `[${conf.product}/${conf.regionId}/${identity}] ${ruleName} ${protocol} ${phase} failed: ${message}`;
}

async function fetchDns(domain) {
  const url = `http://dns.alidns.com/resolve?name=${domain}&type=1`;
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`请求 DNS 解析服务失败，状态码：${response.status}`);
  }
  const json = await response.json();
  return json.Answer[0].data;
}
