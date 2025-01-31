const dns = require('node:dns').promises;
const ECSClient = require('@alicloud/ecs20140526').default;
const SWASClient = require('@alicloud/swas-open20200601').default;

const DDNS_DOMAIN = process.env.DDNS_DOMAIN;
const DNS_SERVER = process.env.DNS_SERVER || '223.5.5.5';
// SECURITY_GROUP_CONF 格式:
// [
//   { product, groupId, ruleId, regionId }, // ECS 安全组规则
//   { product, instanceId, ruleId, regionId } // 轻量应用服务器规则
// ]
console.log(process.env.SECURITY_GROUP_CONF);
const SECURITY_GROUP_CONF = JSON.parse(process.env.SECURITY_GROUP_CONF);

exports.handler = (evt, ctx, cb) => {

  // 自定义 DNS 服务器为阿里公共 DNS 服务器
  const resolver = new dns.Resolver();
  resolver.setServers([ DNS_SERVER ]);

  (async () => {
    console.log('domain', DDNS_DOMAIN);
    // 获取 DNS
    const addrs = await resolver.resolve4(DDNS_DOMAIN);
    console.log('dns', addrs);

    const sourceCidrIp = addrs[0];
    const credential = {
      accessKeyId: process.env.ACCESS_KEY_ID,
      accessKeySecret: process.env.ACCESS_KEY_SECRET,
    };
    const desc = `AutoUpdated@${Date().toString()}`;

    for (const CONF of SECURITY_GROUP_CONF) {
      console.log('start', CONF);

      if (CONF.product === 'ecs') {
        const client = new ECSClient({
          endpoint: `ecs.${CONF.regionId}.aliyuncs.com`,
          ...credential,
        });
        const rule = {
          regionId: CONF.regionId,
          securityGroupId: CONF.groupId,
          securityGroupRuleId: CONF.ruleId,
          sourceCidrIp,
          description: desc,
        };
        console.log('rule', rule);
        const resp = await client.modifySecurityGroupRule(rule);
        console.log('response', resp.body);
      }
      if (CONF.product === 'swas-open') {
        const client = new SWASClient({
          endpoint: `swas.${CONF.regionId}.aliyuncs.com`,
          ...credential,
        });
        const rule = {
          ...CONF,
          sourceCidrIp,
          remark: desc,
          ruleProtocol: 'TCP',
          port: '1/65535',
        };
        console.log('rule', rule);
        const resp = await client.modifyFirewallRule(rule);
        console.log('response', resp.body);
      }
    }
    return cb(null, true);
  })().catch(ex => {
    console.log(ex);
    cb(ex);
  });
};
