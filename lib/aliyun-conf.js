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
  // Walk upwards looking for package.json
  let dir = startDir;
  while (true) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
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
