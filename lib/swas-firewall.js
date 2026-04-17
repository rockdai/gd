'use strict';

const { ListFirewallRulesRequest } = require('@alicloud/swas-open20200601');
const { pickFirewallRules } = require('./firewall-rule');

async function listAllFirewallRules({ client, instanceId, regionId, pageSize = 100 }) {
  const rules = [];
  let pageNumber = 1;

  while (true) {
    const req = new ListFirewallRulesRequest({
      instanceId,
      regionId,
      pageNumber,
      pageSize,
    });
    const resp = await client.listFirewallRules(req);
    const pageRules = pickFirewallRules(resp.body);
    const totalCount = resp?.body?.totalCount ?? resp?.body?.TotalCount;
    const currentPageSize = resp?.body?.pageSize ?? resp?.body?.PageSize ?? pageSize;

    rules.push(...pageRules);

    if (!pageRules.length) break;
    if (typeof totalCount === 'number' && rules.length >= totalCount) break;
    if (pageRules.length < currentPageSize) break;

    pageNumber += 1;
  }

  return rules;
}

module.exports = {
  listAllFirewallRules,
};
