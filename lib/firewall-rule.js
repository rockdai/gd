'use strict';

const PORT_RANGE = '1/65535';
const RULE_PROTOCOLS = [ 'TCP', 'UDP' ];
const GD_WEB_RULE_PREFIX = 'gd-web';
const GD_WEB_RULE_TTL_MS = 24 * 60 * 60 * 1000;

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

function parseRuleTimestamp(value) {
  if (typeof value !== 'string') return null;
  const index = value.lastIndexOf('@');
  if (index === -1) return null;
  const timestamp = value.slice(index + 1).trim();
  const matched = timestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!matched) return null;

  const [ , year, month, day, hours, minutes, seconds ] = matched;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  );

  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

function isRuleExpired(value, ttlMs = GD_WEB_RULE_TTL_MS, now = Date.now()) {
  const timestamp = parseRuleTimestamp(value);
  if (timestamp === null) return false;
  return now - timestamp > ttlMs;
}

module.exports = {
  PORT_RANGE,
  RULE_PROTOCOLS,
  GD_WEB_RULE_PREFIX,
  GD_WEB_RULE_TTL_MS,
  toSourceCidrIp,
  normalizeIpForCompare,
  normalizeProtocol,
  formatDateTime,
  pickFirewallRules,
  getRuleField,
  hasRemarkPrefix,
  parseRuleTimestamp,
  isRuleExpired,
};
