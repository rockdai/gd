'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadAliyunConf } = require('../src/aliyun-conf');

describe('findRepoRoot via loadAliyunConf', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-aliyun-conf-test-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns workspaces-root .aliyun.conf when called from a deep workspace subdir', () => {
    fs.writeFileSync(
      path.join(baseDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] })
    );
    fs.writeFileSync(
      path.join(baseDir, '.aliyun.conf'),
      'ACCESS_KEY_ID=root-id\nACCESS_KEY_SECRET=root-sec'
    );
    const cliBin = path.join(baseDir, 'packages', 'cli', 'bin');
    fs.mkdirSync(cliBin, { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, 'packages', 'cli', 'package.json'),
      JSON.stringify({ name: '@gd/cli' })
    );

    const { values } = loadAliyunConf({ cwd: cliBin });
    assert.deepStrictEqual(values, {
      ACCESS_KEY_ID: 'root-id',
      ACCESS_KEY_SECRET: 'root-sec',
    });
  });

  it('falls back to topmost package.json when no workspaces field is present', () => {
    fs.writeFileSync(
      path.join(baseDir, 'package.json'),
      JSON.stringify({ name: 'single' })
    );
    fs.writeFileSync(
      path.join(baseDir, '.aliyun.conf'),
      'ACCESS_KEY_ID=single-id\nACCESS_KEY_SECRET=single-sec'
    );
    // Start from a nested directory that has no package.json of its own,
    // forcing findRepoRoot to walk up and find the topmost package.json.
    const deepDir = path.join(baseDir, 'src', 'util');
    fs.mkdirSync(deepDir, { recursive: true });

    const { values } = loadAliyunConf({ cwd: deepDir });
    assert.deepStrictEqual(values, {
      ACCESS_KEY_ID: 'single-id',
      ACCESS_KEY_SECRET: 'single-sec',
    });
  });

  it('returns null values when no .aliyun.conf exists', () => {
    fs.writeFileSync(
      path.join(baseDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] })
    );

    const { values } = loadAliyunConf({ cwd: baseDir });
    assert.strictEqual(values, null);
  });
});
