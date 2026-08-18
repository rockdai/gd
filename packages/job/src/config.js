'use strict';

const { resolveRegions } = require('@gd/shared/src/regions');

const DEFAULT_INTERVAL_SECONDS = 300;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600 };
const MAX_INTERVAL_SECONDS = 2147483;

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseInterval(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_INTERVAL_SECONDS;

  const matched = raw.match(/^(\d+)([smh])?$/i);
  if (!matched) throw new Error(`Invalid SYNC_INTERVAL: ${value}`);

  const amount = Number(matched[1]);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid SYNC_INTERVAL: ${value}`);

  const seconds = amount * UNIT_SECONDS[(matched[2] || 's').toLowerCase()];
  if (seconds > MAX_INTERVAL_SECONDS) throw new Error(`Invalid SYNC_INTERVAL: ${value} (max ${MAX_INTERVAL_SECONDS}s)`);
  return seconds;
}

function loadConfig(env = process.env) {
  const accessKeyId = (env.ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (env.ACCESS_KEY_SECRET || '').trim();
  if (!accessKeyId) throw new Error('ACCESS_KEY_ID is required');
  if (!accessKeySecret) throw new Error('ACCESS_KEY_SECRET is required');

  const label = env.RULE_LABEL !== undefined ? (env.RULE_LABEL || '').trim() : 'default';
  // 备注格式为 gd-job:<label>@<时间戳>，label 含分隔符会让解析产生歧义
  if (!label || label.includes(':') || label.includes('@')) {
    throw new Error(`Invalid RULE_LABEL: ${env.RULE_LABEL} (must be non-empty and contain neither ":" nor "@")`);
  }

  return {
    credential: { accessKeyId, accessKeySecret },
    allow: parseList(env.MACHINE_ALLOW),
    deny: parseList(env.MACHINE_DENY),
    intervalSeconds: parseInterval(env.SYNC_INTERVAL),
    regions: resolveRegions(env.REGIONS ?? ''),
    label,
    ipEndpoint: env.IP_ENDPOINT || undefined,
  };
}

module.exports = { loadConfig, parseInterval, parseList, DEFAULT_INTERVAL_SECONDS };
