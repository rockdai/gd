const dns = require('node:dns').promises;
const ECSClient = require('@alicloud/ecs20140526').default;

const DDNS_DOMAIN = process.env.DDNS_DOMAIN;
const DNS_SERVER = process.env.DNS_SERVER || '223.5.5.5';
const SECURITY_GROUP_ID = process.env.SECURITY_GROUP_ID;
const SECURITY_GROUP_RULE_ID = process.env.SECURITY_GROUP_RULE_ID;
const SECURITY_GROUP_REGION_ID = process.env.SECURITY_GROUP_REGION_ID || 'cn-hangzhou';

exports.handler = (evt, ctx, cb) => {

  // 自定义 DNS 服务器为阿里公共 DNS 服务器
  const resolver = new dns.Resolver();
  resolver.setServers([ DNS_SERVER ]);

  (async () => {
    console.log('domain', DDNS_DOMAIN);
    // 获取 DNS
    const addrs = await resolver.resolve4(DDNS_DOMAIN);
    console.log('dns', addrs);

    const client = new ECSClient({
      accessKeyId: process.env.ACCESS_KEY_ID,
      accessKeySecret: process.env.ACCESS_KEY_SECRET,
      endpoint: `ecs.${SECURITY_GROUP_REGION_ID}.aliyuncs.com`,
    });
    const rule = {
      regionId: SECURITY_GROUP_REGION_ID,
      securityGroupId: SECURITY_GROUP_ID,
      securityGroupRuleId: SECURITY_GROUP_RULE_ID,
      sourceCidrIp: addrs[0],
      description: `AutoUpdated@${Date().toString()}`,
    };
    console.log('rule', rule);
    const sg = await client.modifySecurityGroupRule(rule);
    console.log('response', sg.body);

    return cb(null, { dns: addrs, rule, resp: sg });
  })().catch(ex => {
    console.log(ex);
    cb(ex);
  });
};
