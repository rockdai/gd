const { default: ECSClient, ModifySecurityGroupRuleRequest } = require('@alicloud/ecs20140526');
const { default: SWASClient, ModifyFirewallRuleRequest } = require('@alicloud/swas-open20200601');

const PORT_RANGE = '1/65535';
const { DOMAIN, RuleConfig } = require('./config');

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
    // 逐条处理
    for (const CONF of RuleConfig) {
      console.log('----------------------------------------');
      console.log('Start to handle', CONF);
      const current = getDate();

      if (CONF.product === 'ecs') {
        const client = new ECSClient({
          endpoint: `ecs.${CONF.regionId}.aliyuncs.com`,
          ...credential,
        });
        for (const RULE of CONF.ruleList) {
          const rule = new ModifySecurityGroupRuleRequest({
            regionId: CONF.regionId,
            securityGroupId: CONF.groupId,
            securityGroupRuleId: RULE.id,
            sourceCidrIp: ipMap[RULE.name],
            description: `${RULE.name}@${current}`,
            portRange: PORT_RANGE,
          });
          console.log('Rule to config', rule);
          try {
            const resp = await client.modifySecurityGroupRule(rule);
            console.log('Config response', resp.body);
          } catch (ex) {
            if (ex.message.includes('RuleDuplicate')) {
              console.log('Security group rule already exists, skip');
              continue;
            }
            throw ex;
          }
        }
      }
      if (CONF.product === 'swas-open') {
        const client = new SWASClient({
          endpoint: `swas.${CONF.regionId}.aliyuncs.com`,
          regionId: CONF.regionId,
          ...credential,
        });
        for (const RULE of CONF.ruleList) {
          const rule = new ModifyFirewallRuleRequest({
            instanceId: CONF.instanceId,
            ruleId: RULE.id,
            sourceCidrIp: ipMap[RULE.name],
            remark: `${RULE.name}@${current}`,
            ruleProtocol: 'TCP',
            port: PORT_RANGE,
          });
          console.log('Rule to config', rule);
          try {
            const resp = await client.modifyFirewallRule(rule);
            console.log('Config response', resp.body);
          } catch (ex) {
            if (ex.message.includes('FirewallRuleAlreadyExist')) {
              console.log('Firewall rule already exists, skip');
              continue;
            }
            throw ex;
          }
        }
      }
    }
    return cb(null, true);
  })().catch(ex => {
    console.log(ex);
    cb(ex);
  });
};

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

function getDate() {
  const now = new Date();

  const month = String(now.getMonth() + 1).padStart(2, '0'); // 月份从 0 开始
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}
