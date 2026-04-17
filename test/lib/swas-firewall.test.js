'use strict';

const assert = require('assert');

const { listAllFirewallRules } = require('../../lib/swas-firewall');

describe('swas-firewall helpers', () => {
  it('keeps paging when totalCount indicates more rules despite a short page', async () => {
    const requestedPages = [];
    const client = {
      async listFirewallRules(req) {
        requestedPages.push(req.pageNumber);
        if (req.pageNumber === 1) {
          return {
            body: {
              firewallRules: [ { id: 'rule-1' } ],
              totalCount: 3,
              pageSize: 2,
            },
          };
        }

        return {
          body: {
            firewallRules: [ { id: 'rule-2' }, { id: 'rule-3' } ],
            totalCount: 3,
            pageSize: 2,
          },
        };
      },
    };

    const rules = await listAllFirewallRules({
      client,
      instanceId: 'i-test',
      regionId: 'cn-hangzhou',
      pageSize: 2,
    });

    assert.deepStrictEqual(requestedPages, [ 1, 2 ]);
    assert.deepStrictEqual(rules.map(rule => rule.id), [ 'rule-1', 'rule-2', 'rule-3' ]);
  });

  it('falls back to short-page termination when totalCount is unavailable', async () => {
    const requestedPages = [];
    const client = {
      async listFirewallRules(req) {
        requestedPages.push(req.pageNumber);
        return {
          body: {
            firewallRules: [ { id: 'rule-1' } ],
            pageSize: 2,
          },
        };
      },
    };

    const rules = await listAllFirewallRules({
      client,
      instanceId: 'i-test',
      regionId: 'cn-hangzhou',
      pageSize: 2,
    });

    assert.deepStrictEqual(requestedPages, [ 1 ]);
    assert.deepStrictEqual(rules.map(rule => rule.id), [ 'rule-1' ]);
  });
});
