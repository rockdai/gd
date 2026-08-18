'use strict';

const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeIpForCompare,
  normalizeProtocol,
  getRuleField,
  buildManagedJobRemark,
  isManagedJobRemark,
} = require('@gd/shared/src/firewall-rule');
const machineFirewall = require('@gd/shared/src/machine-firewall');
const { getPublicIp } = require('@gd/shared/src/public-ip');
const { selectMachines, findMissingEntries, withSecurityGroup, otherSecurityGroupIds } = require('./machines');

const DEFAULT_DEPS = {
  getPublicIp,
  listMachines: machineFirewall.listMachines,
  listMachineRules: machineFirewall.listMachineRules,
  addIpRules: machineFirewall.addIpRules,
  cleanupRules: machineFirewall.cleanupRules,
};

/**
 * 「过期规则」= 自己 label 名下、但源 IP 不是当前公网 IP 的规则。
 * 与时间无关：IP 没变时规则就该一直留着，按 TTL 删会制造无意义的抖动。
 */
function buildStaleRulePredicate({ label, sourceCidrIp, product }) {
  const fields = machineFirewall.FIELDS[product];
  const currentIp = normalizeIpForCompare(sourceCidrIp);
  return rule => {
    // 与 web 的 isExpiredWebRule 同构：协议、端口、备注前缀三者都要命中，再看 IP
    if (!RULE_PROTOCOLS.includes(normalizeProtocol(getRuleField(rule, fields.protocol)))) return false;
    if (getRuleField(rule, fields.port) !== PORT_RANGE) return false;
    const remark = getRuleField(rule, fields.remark) || '';
    if (!isManagedJobRemark(remark, label)) return false;
    return normalizeIpForCompare(getRuleField(rule, 'sourceCidrIp')) !== currentIp;
  };
}

function countAdded(added) {
  return Object.values(added.protocols || {}).filter(outcome => outcome === 'added').length;
}

/**
 * 一轮完整对账。无状态：不记上一轮的任何东西，看到什么修什么（spec §5.0）。
 */
async function runOnce({ config, deps = DEFAULT_DEPS, logger = console }) {
  const summary = { ip: null, ok: false, targets: 0, added: 0, deleted: 0, failures: 0 };

  let ip;
  try {
    ip = await deps.getPublicIp({ endpoint: config.ipEndpoint });
  } catch (err) {
    logger.warn(`[gd-job] failed to fetch public ip, skipping this round: ${err.message || err}`);
    return summary;
  }
  summary.ip = ip;

  const sourceCidrIp = toSourceCidrIp(ip);
  const remark = buildManagedJobRemark(config.label);
  const { credential } = config;

  const { machines, failures: discoveryFailures } = await deps.listMachines({ credential, regions: config.regions, logger });
  // 某个地域/产品列不出来（权限被收、区域故障）→ 那部分机器这一轮根本没对账，必须算失败，
  // 不然权限全没了的时候会打出 "0 machine(s), 0 failed" 这种假绿
  summary.failures += discoveryFailures.length;
  for (const missing of findMissingEntries(machines, [ ...config.allow, ...config.deny ])) {
    logger.info(`[gd-job] configured machine not found, skipping: ${missing}`);
  }

  const targets = selectMachines(machines, config).map(withSecurityGroup);
  summary.targets = targets.length;

  for (const machine of targets) {
    const name = `${machine.product}/${machine.instanceName || machine.instanceId}`;

    let rules;
    try {
      // 一次列举供新增与清理共用，同时也是 fail-closed 的判定点
      rules = await deps.listMachineRules({ credential, machine });
    } catch (err) {
      logger.error(`[gd-job] ${name}: failed to list rules, skipping to keep manual rules safe: ${err.message || err}`);
      summary.failures += 1;
      continue;
    }

    // 先加后清：先删会留出一段新旧 IP 都不通的窗口
    const added = await deps.addIpRules({ credential, machine, sourceCidrIp, remark, rules, logger });
    if (added.status === 'error') {
      logger.error(`[gd-job] ${name}: ${added.message}`);
      summary.failures += 1;
      continue;
    }
    if (added.status === 'partial') {
      // 新 IP 只有一个协议放通了，旧规则先留着：新访问没完全到位前不撤旧访问。下一轮补齐后再清。
      logger.warn(`[gd-job] ${name}: ${added.message}; keeping stale rules until all protocols succeed`);
      summary.failures += 1;
      summary.added += countAdded(added);
      continue;
    }
    const addedCount = countAdded(added);
    summary.added += addedCount;
    // 安静的轮次不刷屏：只有真的写了才打机器级细节
    if (addedCount > 0) logger.info(`[gd-job] ${name}: ${added.message}`);

    const shouldDelete = buildStaleRulePredicate({ label: config.label, sourceCidrIp, product: machine.product });
    try {
      const cleaned = await deps.cleanupRules({ credential, machine, rules, logger, shouldDelete });
      summary.deleted += cleaned.deletedCount;
      if (cleaned.deletedCount > 0) {
        logger.info(`[gd-job] ${name}: cleaned ${cleaned.deletedCount} stale rule(s)`);
      }
    } catch (err) {
      logger.error(`[gd-job] ${name}: cleanup failed: ${err.message || err}`);
      summary.failures += 1;
    }

    // ECS 挂多个安全组：规则只加在主组（排序后第一个），但其余组里自己留下的旧 IP 规则也要清——
    // 主组是按 ID 排序选的，某天多挂一个排序更靠前的组，主组就换了，原主组里的旧 IP 规则不能变成没人管的常开口子。
    // 只删 gd-job:<label> 且源 IP 已过期的规则，不在这些组里加任何东西。
    for (const securityGroupId of otherSecurityGroupIds(machine)) {
      try {
        const cleaned = await deps.cleanupRules({ credential, machine: { ...machine, securityGroupId }, logger, shouldDelete });
        summary.deleted += cleaned.deletedCount;
        if (cleaned.deletedCount > 0) {
          logger.info(`[gd-job] ${name}: cleaned ${cleaned.deletedCount} stale rule(s) in secondary security group ${securityGroupId}`);
        }
      } catch (err) {
        logger.error(`[gd-job] ${name}: cleanup in secondary security group ${securityGroupId} failed: ${err.message || err}`);
        summary.failures += 1;
      }
    }
  }

  summary.ok = summary.failures === 0;
  logger.info(`[gd-job] ${ip} → ${summary.targets} machine(s): ${summary.added} added, ${summary.deleted} removed, ${summary.failures} failed`);
  return summary;
}

module.exports = { runOnce, buildStaleRulePredicate, DEFAULT_DEPS };
