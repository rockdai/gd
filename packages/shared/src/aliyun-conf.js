'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONF_FILE = '.aliyun.conf';

function parseKeyValue(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function findRepoRoot(startDir) {
  // Walk upwards. Prefer the first package.json that declares "workspaces"
  // (monorepo root); fall back to the topmost package.json otherwise.
  let dir = startDir;
  let lastPkgDir = null;
  while (true) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) {
      lastPkgDir = dir;
      try {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (pkg && pkg.workspaces) return dir;
      } catch (_) {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return lastPkgDir || startDir;
    dir = parent;
  }
}

function loadAliyunConf({ cwd = process.cwd(), filename = DEFAULT_CONF_FILE } = {}) {
  const root = findRepoRoot(cwd);
  const confPath = path.join(root, filename);
  if (!fs.existsSync(confPath)) return { confPath, values: null };
  const text = fs.readFileSync(confPath, 'utf8');
  return { confPath, values: parseKeyValue(text) };
}

function resolveCredentials({ cwd } = {}) {
  const envId = process.env.ACCESS_KEY_ID;
  const envSecret = process.env.ACCESS_KEY_SECRET;
  if (envId && envSecret) {
    return { accessKeyId: envId, accessKeySecret: envSecret, source: 'env' };
  }

  const { confPath, values } = loadAliyunConf({ cwd });
  if (values && values.ACCESS_KEY_ID && values.ACCESS_KEY_SECRET) {
    return {
      accessKeyId: values.ACCESS_KEY_ID,
      accessKeySecret: values.ACCESS_KEY_SECRET,
      source: confPath,
    };
  }

  return { accessKeyId: null, accessKeySecret: null, source: values ? confPath : null };
}

module.exports = {
  DEFAULT_CONF_FILE,
  parseKeyValue,
  loadAliyunConf,
  resolveCredentials,
};
