'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRuleConfig, domainsOf } = require('../src/rule-config');

const VALID = [
  { product: 'swas-open', instanceId: 'swas-1', regionId: 'cn-hangzhou', ruleList: [{ name: 'home.example.com', id: 'r1' }] },
  { product: 'ecs', groupId: 'sg-1', regionId: 'cn-hangzhou', ruleList: [{ name: 'home.example.com' }, { name: 'office.example.com' }] },
];

describe('rule-config', () => {
  it('loads from RULE_CONFIG_JSON', () => {
    assert.deepStrictEqual(loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify(VALID) }), VALID);
  });

  it('loads from RULE_CONFIG_FILE when RULE_CONFIG_JSON is unset', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-rc-')), 'rule-config.json');
    fs.writeFileSync(file, JSON.stringify(VALID));
    assert.deepStrictEqual(loadRuleConfig({ RULE_CONFIG_FILE: file }), VALID);
  });

  it('throws a helpful error when nothing is configured', () => {
    assert.throws(() => loadRuleConfig({}), /RULE_CONFIG_JSON or RULE_CONFIG_FILE/);
  });

  it('rejects malformed input', () => {
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: '{not json' }), /not valid JSON/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: '{}' }), /must be a non-empty JSON array/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: '[]' }), /must be a non-empty JSON array/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify([{ product: 'rds', regionId: 'x', ruleList: [{ name: 'a' }] }]) }), /\[0\]\.product/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify([{ product: 'ecs', regionId: 'x', ruleList: [{ name: 'a' }] }]) }), /\[0\]\.groupId/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify([{ product: 'swas-open', regionId: 'x', ruleList: [{ name: 'a' }] }]) }), /\[0\]\.instanceId/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify([{ product: 'ecs', groupId: 'sg', ruleList: [{ name: 'a' }] }]) }), /\[0\]\.regionId/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify([{ product: 'ecs', groupId: 'sg', regionId: 'x', ruleList: [] }]) }), /\[0\]\.ruleList/);
    assert.throws(() => loadRuleConfig({ RULE_CONFIG_JSON: JSON.stringify([{ product: 'ecs', groupId: 'sg', regionId: 'x', ruleList: [{ id: 'no-name' }] }]) }), /\[0\]\.ruleList\[0\]\.name/);
  });

  it('domainsOf returns unique domain names in first-seen order', () => {
    assert.deepStrictEqual(domainsOf(VALID), [ 'home.example.com', 'office.example.com' ]);
  });
});
