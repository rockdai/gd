const dns = require('node:dns').promises;
const ECSClient = require('@alicloud/ecs20140526').default;

const DDNS_DOMAIN = process.env.DDNS_DOMAIN;
const DNS_SERVER = process.env.DNS_SERVER || '223.5.5.5';
// [{ groupId, ruleId, regionId }]
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

    for (const CONF of SECURITY_GROUP_CONF) {
      const client = new ECSClient({
        accessKeyId: process.env.ACCESS_KEY_ID,
        accessKeySecret: process.env.ACCESS_KEY_SECRET,
        endpoint: `ecs.${CONF.regionId}.aliyuncs.com`,
      });
      const rule = {
        regionId: CONF.regionId,
        securityGroupId: CONF.groupId,
        securityGroupRuleId: CONF.ruleId,
        sourceCidrIp: addrs[0],
        description: `AutoUpdated@${Date().toString()}`,
      };
      console.log('rule', rule);
      const sg = await client.modifySecurityGroupRule(rule);
      console.log('response', sg.body);
    }
    return cb(null, true);
  })().catch(ex => {
    console.log(ex);
    cb(ex);
  });
};
