'use strict';

function matchesEntry(machine, entry) {
  return entry === machine.instanceId || entry === machine.instanceName;
}

function selectMachines(machines, { allow = [], deny = [] } = {}) {
  let selected = machines;
  if (allow.length > 0) selected = selected.filter(m => allow.some(entry => matchesEntry(m, entry)));
  if (deny.length > 0) selected = selected.filter(m => !deny.some(entry => matchesEntry(m, entry)));
  return selected;
}

// 名单里写了但一台都没匹配上的条目：已释放、不在配置的地域、或名字写错
function findMissingEntries(machines, entries) {
  return entries.filter(entry => !machines.some(m => matchesEntry(m, entry)));
}

// 排序后取第一个：阿里云未承诺 DescribeInstances 的安全组顺序稳定，
// 不排序的话两轮之间顺序一变，旧 IP 规则会残留在另一个安全组里无人清理。
function primarySecurityGroupId(machine) {
  return [ ...(machine.securityGroupIds || []) ].sort()[0];
}

function withSecurityGroup(machine) {
  if (machine.product !== 'ecs') return machine;
  return { ...machine, securityGroupId: primarySecurityGroupId(machine) };
}

module.exports = {
  matchesEntry,
  selectMachines,
  findMissingEntries,
  primarySecurityGroupId,
  withSecurityGroup,
};
