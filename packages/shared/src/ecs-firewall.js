'use strict';

const { DescribeSecurityGroupAttributeRequest } = require('@alicloud/ecs20140526');

async function listSecurityGroupRules({ client, securityGroupId, regionId, direction = 'ingress', maxResults = 1000 }) {
  const req = new DescribeSecurityGroupAttributeRequest({
    regionId,
    securityGroupId,
    direction,
    maxResults,
  });
  const resp = await client.describeSecurityGroupAttribute(req);
  return resp?.body?.permissions?.permission || [];
}

module.exports = {
  listSecurityGroupRules,
};
