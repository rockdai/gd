'use strict';

const PORT_RANGE = '1/65535';
const RULE_PROTOCOLS = [ 'TCP', 'UDP' ];
const GD_WEB_RULE_PREFIX = 'gd-web';
const GD_WEB_RULE_TTL_MS = 24 * 60 * 60 * 1000;
const GD_DDNS_RULE_PREFIX = 'gd-ddns';
const GD_CLI_RULE_PREFIX = 'gd-cli';

function toSourceCidrIp(ip) {
  if (!ip || ip.includes('/')) return ip;
  return `${ip}/32`;
}

function normalizeIpForCompare(ip) {
  if (!ip) return ip;
  return ip.includes('/') ? ip : `${ip}/32`;
}

function normalizeProtocol(protocol) {
  if (!protocol) return '';
  return String(protocol).toUpperCase();
}

function formatDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function pickFirewallRules(respBody) {
  if (!respBody) return [];
  if (Array.isArray(respBody.firewallRules)) return respBody.firewallRules;
  if (Array.isArray(respBody.FirewallRules)) return respBody.FirewallRules;
  return [];
}

function getRuleField(rule, field) {
  if (!rule) return undefined;
  return rule[field] ?? rule[field[0].toUpperCase() + field.slice(1)];
}

function hasRemarkPrefix(value, prefix) {
  if (!value || !prefix) return false;
  return value === prefix || value.startsWith(`${prefix}@`);
}

function buildManagedDdnsRemark(name, timestamp = formatDateTime()) {
  return `${GD_DDNS_RULE_PREFIX}:${name}@${timestamp}`;
}

function isLegacyManagedDdnsRemark(value, name) {
  return hasRemarkPrefix(value, name) && parseRuleTimestamp(value) !== null;
}

function isManagedDdnsRemark(value, name) {
  return hasRemarkPrefix(value, `${GD_DDNS_RULE_PREFIX}:${name}`) || isLegacyManagedDdnsRemark(value, name);
}

function buildManagedCliRemark(remark, timestamp = formatDateTime()) {
  return `${GD_CLI_RULE_PREFIX}:${remark}@${timestamp}`;
}

function isManagedCliRemark(value, remark) {
  return hasRemarkPrefix(value, `${GD_CLI_RULE_PREFIX}:${remark}`);
}

function parseRuleTimestamp(value) {
  if (typeof value !== 'string') return null;
  const index = value.lastIndexOf('@');
  if (index === -1) return null;
  const timestamp = value.slice(index + 1).trim();
  const matched = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!matched) return null;

  const [ , year, month, day, hours, minutes, seconds ] = matched;
  const yearNum = Number(year);
  const monthNum = Number(month);
  const dayNum = Number(day);
  const hoursNum = Number(hours);
  const minutesNum = Number(minutes);
  const secondsNum = Number(seconds);

  if (
    monthNum < 1 || monthNum > 12 ||
    dayNum < 1 || dayNum > 31 ||
    hoursNum < 0 || hoursNum > 23 ||
    minutesNum < 0 || minutesNum > 59 ||
    secondsNum < 0 || secondsNum > 59
  ) {
    return null;
  }

  const date = new Date(
    yearNum,
    monthNum - 1,
    dayNum,
    hoursNum,
    minutesNum,
    secondsNum
  );

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== yearNum ||
    date.getMonth() + 1 !== monthNum ||
    date.getDate() !== dayNum ||
    date.getHours() !== hoursNum ||
    date.getMinutes() !== minutesNum ||
    date.getSeconds() !== secondsNum
  ) {
    return null;
  }

  return date.getTime();
}

function isRuleExpired(value, ttlMs = GD_WEB_RULE_TTL_MS, now = Date.now()) {
  const timestamp = parseRuleTimestamp(value);
  if (timestamp === null) return false;
  return now - timestamp > ttlMs;
}

function isExpiredWebRule({ protocol, port, remark, ttlMs = GD_WEB_RULE_TTL_MS, now = Date.now() }) {
  return (
    RULE_PROTOCOLS.includes(normalizeProtocol(protocol)) &&
    port === PORT_RANGE &&
    hasRemarkPrefix(remark, GD_WEB_RULE_PREFIX) &&
    isRuleExpired(remark, ttlMs, now)
  );
}

function getConfiguredRuleIds(ruleConf) {
  const configuredIds = {};
  if (ruleConf.ids && typeof ruleConf.ids === 'object') {
    for (const protocol of RULE_PROTOCOLS) {
      const configuredId = ruleConf.ids[protocol];
      if (configuredId) configuredIds[protocol] = configuredId;
    }
  }
  if (ruleConf.id) configuredIds.default = ruleConf.id;
  return configuredIds;
}

function findManagedRule({ rules, ruleConf, protocol, idField, protocolField, remarkField, portField, remarkMatcher }) {
  const matchesManagedRule = rule => (
    normalizeProtocol(getRuleField(rule, protocolField)) === protocol &&
    getRuleField(rule, portField) === PORT_RANGE &&
    remarkMatcher(getRuleField(rule, remarkField) || '')
  );

  const configuredIds = getConfiguredRuleIds(ruleConf);
  const configuredId = configuredIds[protocol];
  if (configuredId) {
    const exactRule = rules.find(rule => getRuleField(rule, idField) === configuredId);
    if (exactRule && matchesManagedRule(exactRule)) return exactRule;
  }

  const matchedByRemark = rules.find(matchesManagedRule);
  if (matchedByRemark) return matchedByRemark;

  if (!configuredIds.default) return null;
  const defaultRule = rules.find(rule => getRuleField(rule, idField) === configuredIds.default);
  if (defaultRule && matchesManagedRule(defaultRule)) return defaultRule;
  return null;
}

module.exports = {
  PORT_RANGE,
  RULE_PROTOCOLS,
  GD_WEB_RULE_PREFIX,
  GD_WEB_RULE_TTL_MS,
  GD_DDNS_RULE_PREFIX,
  GD_CLI_RULE_PREFIX,
  toSourceCidrIp,
  normalizeIpForCompare,
  normalizeProtocol,
  formatDateTime,
  pickFirewallRules,
  getRuleField,
  hasRemarkPrefix,
  buildManagedDdnsRemark,
  isLegacyManagedDdnsRemark,
  isManagedDdnsRemark,
  buildManagedCliRemark,
  isManagedCliRemark,
  parseRuleTimestamp,
  isRuleExpired,
  isExpiredWebRule,
  getConfiguredRuleIds,
  findManagedRule,
};
