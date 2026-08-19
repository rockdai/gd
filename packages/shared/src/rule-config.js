'use strict';

const fs = require('fs');

// DDNS 定时任务（@gd/scheduler）和 CLI 的规则配置：哪些域名要同步到哪些机器的白名单。
// 这是每个部署者自己的基础设施拓扑，不进仓库——从环境变量读：
//   RULE_CONFIG_JSON   内联 JSON（函数计算等托管环境用这个）
//   RULE_CONFIG_FILE   JSON 文件路径（本地用；仓库根目录的 rule-config.json 已 gitignore）
// 格式见仓库根目录 rule-config.example.json。
const PRODUCTS = new Set([ 'ecs', 'swas-open' ]);

function loadRuleConfig(env = process.env) {
  let raw = env.RULE_CONFIG_JSON;
  let source = 'RULE_CONFIG_JSON';
  if (!raw && env.RULE_CONFIG_FILE) {
    raw = fs.readFileSync(env.RULE_CONFIG_FILE, 'utf8');
    source = env.RULE_CONFIG_FILE;
  }
  if (!raw) {
    throw new Error('Rule config is required: set RULE_CONFIG_JSON or RULE_CONFIG_FILE (see rule-config.example.json)');
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Rule config (${source}) is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(config)) throw new Error(`Rule config (${source}) must be a JSON array`);

  config.forEach((conf, i) => {
    const at = `Rule config (${source}) [${i}]`;
    if (!PRODUCTS.has(conf?.product)) throw new Error(`${at}.product must be one of: ${[ ...PRODUCTS ].join(', ')}`);
    if (!conf.regionId) throw new Error(`${at}.regionId is required`);
    if (conf.product === 'ecs' && !conf.groupId) throw new Error(`${at}.groupId is required for ecs`);
    if (conf.product === 'swas-open' && !conf.instanceId) throw new Error(`${at}.instanceId is required for swas-open`);
    if (!Array.isArray(conf.ruleList) || conf.ruleList.length === 0) throw new Error(`${at}.ruleList must be a non-empty array`);
    conf.ruleList.forEach((rule, j) => {
      if (!rule?.name) throw new Error(`${at}.ruleList[${j}].name (domain) is required`);
    });
  });
  return config;
}

// 需要解析的域名 = 所有 ruleList[].name 去重（保持首次出现顺序）
function domainsOf(ruleConfig) {
  return [ ...new Set(ruleConfig.flatMap(conf => conf.ruleList.map(rule => rule.name))) ];
}

module.exports = { loadRuleConfig, domainsOf };
