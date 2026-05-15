# Monorepo 化项目结构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `gd` 仓库改造成 4 个 npm workspaces（`@gd/{shared,web,scheduler,cli}`）的 monorepo，不破坏 FC 部署、CLI、Egg.js Web 服务、定时函数等所有现有用法。

**Architecture:** 源码按"哪个产物消费它"拆进 `packages/*`，根目录保留 FC 入口的 1 行 shim（`bootstrap.js` / `index.js` / `config.js` / `bin/ecs-dsec-handler.js`）。Workspace symlink 在 `s deploy` 时由 `s.yaml` 的 `actions.pre-deploy` 钩子自动实体化进 `node_modules/@gd/*`，规避 `s` CLI 对 symlink 处理的不确定性。设计依据见 `docs/superpowers/specs/2026-05-15-monorepo-restructure-design.md`。

**Tech Stack:** Node.js (≥16), npm workspaces, Egg.js 3.x, Serverless Devs v3 (`edition: 3.0.0`) + fc3 component, `egg-bin` (mocha) for tests, bash for the materialize script.

---

## 前置约定

- 所有命令都从仓库根 `/Users/minibot/.baxian/repos/rockdai/gd/.baxian-worktrees/task-018_fb5df06cc209b59a/` 执行，除非显式说明。
- 所有文件移动都用 `git mv` 而非 `mv`，触发 git rename detection 保留 history。
- 每个 task 末尾都跑测试 + 提交一次。任务之间的 commit 必须保持仓库处于"全部测试可通过"的状态。
- 引用 spec 时统一指 `docs/superpowers/specs/2026-05-15-monorepo-restructure-design.md`。
- 把当前 head（baseline）记下来：`git rev-parse HEAD` 在动手前应该是 `edc8d4d`。

---

### Task 1: 声明 npm workspaces 与 4 个空 package 骨架

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/web/package.json`
- Create: `packages/scheduler/package.json`
- Create: `packages/cli/package.json`
- Create: `packages/shared/src/.gitkeep`
- Create: `packages/shared/test/.gitkeep`
- Create: `packages/web/test/.gitkeep`
- Create: `packages/scheduler/test/.gitkeep`
- Create: `packages/cli/bin/.gitkeep`
- Modify: `package.json` （根，加 `"workspaces"`）

- [ ] **Step 1: 建子目录骨架**

```bash
mkdir -p packages/shared/src packages/shared/test
mkdir -p packages/web/test
mkdir -p packages/scheduler/test
mkdir -p packages/cli/bin
touch packages/shared/src/.gitkeep
touch packages/shared/test/.gitkeep
touch packages/web/test/.gitkeep
touch packages/scheduler/test/.gitkeep
touch packages/cli/bin/.gitkeep
```

`.gitkeep` 是空 placeholder，让空目录能被 git 跟踪。后续 task 把真实源码移进来后可以删掉。

- [ ] **Step 2: 写 `packages/shared/package.json`（最小骨架）**

```json
{
  "name": "@gd/shared",
  "version": "1.0.0",
  "private": true
}
```

deps 和 main 字段在 Task 3 真正搬代码时再加，避免空包的 `egg-bin test` 报"找不到测试"。

- [ ] **Step 3: 写 `packages/web/package.json`（最小骨架）**

```json
{
  "name": "@gd/web",
  "version": "1.0.0",
  "private": true
}
```

- [ ] **Step 4: 写 `packages/scheduler/package.json`（最小骨架）**

```json
{
  "name": "@gd/scheduler",
  "version": "1.0.0",
  "private": true
}
```

- [ ] **Step 5: 写 `packages/cli/package.json`（最小骨架）**

```json
{
  "name": "@gd/cli",
  "version": "1.0.0",
  "private": true
}
```

- [ ] **Step 6: 给根 `package.json` 加 `"workspaces"`**

修改根 `package.json`，加 `"workspaces": ["packages/*"]`。其余字段不动——`dependencies`、`scripts.test = "egg-bin test"`、`bin`、`egg` 等都保持原样，确保 Tasks 2-7 期间根命令仍可用。

具体 edit：在 `"private": true,` 行下、`"repository"` 行上插入一行：

- Old:
```json
  "private": true,
  "repository": "git@github.com:rockdai/gd.git",
```
- New:
```json
  "private": true,
  "workspaces": ["packages/*"],
  "repository": "git@github.com:rockdai/gd.git",
```

- [ ] **Step 7: `npm install` 让 workspaces 生效**

```bash
npm install
```

第一次执行可能会重 hoist 一些已存在的依赖；产生的 `package-lock.json` 变更要一起提交。

- [ ] **Step 8: 验证 4 个 @gd/* symlink 都建好**

```bash
ls -l node_modules/@gd/
```

期望输出包含 4 行，每行形如 `shared -> ../../packages/shared`、`web -> ../../packages/web` 等（链接为相对路径）。

- [ ] **Step 9: 跑原 root 测试确认 baseline 没坏**

```bash
npm test
```

期望：所有原有测试通过。workspaces 声明本身不影响 root `egg-bin test` 的行为。

- [ ] **Step 10: 提交**

```bash
git add packages/ package.json package-lock.json
git commit -m "chore: declare npm workspaces with empty @gd/* skeletons

为后续 monorepo 拆分准备好 packages/{shared,web,scheduler,cli} 4 个空 workspace
和根 workspaces 声明。源码与测试在后续 task 中逐个迁入；现阶段所有根命令
（npm run dev/start/test、s deploy、bin/ecs-dsec-handler.js）仍按原样工作。"
```

---

### Task 2: 创建 materialize 脚本并独立验证

**Files:**
- Create: `scripts/materialize-workspace-deps.sh`

- [ ] **Step 1: 建 scripts 目录**

```bash
mkdir -p scripts
```

- [ ] **Step 2: 写脚本（按 spec §7.3.3 完整版）**

文件 `scripts/materialize-workspace-deps.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES_DIR="$ROOT/packages"
GD_NM_DIR="$ROOT/node_modules/@gd"

if [ ! -d "$PACKAGES_DIR" ]; then
  echo "[materialize] no packages/ directory at $PACKAGES_DIR" >&2
  exit 1
fi

mkdir -p "$GD_NM_DIR"

count=0
for pkg_dir in "$PACKAGES_DIR"/*/; do
  pkg_dir="${pkg_dir%/}"
  pkg_json="$pkg_dir/package.json"
  if [ ! -f "$pkg_json" ]; then
    echo "[materialize] skip $pkg_dir (no package.json)" >&2
    continue
  fi

  pkg_name="$(node -p "require('$pkg_json').name")"
  case "$pkg_name" in
    @gd/*) ;;
    *)
      echo "[materialize] skip $pkg_dir (name '$pkg_name' not under @gd/*)" >&2
      continue
      ;;
  esac

  pkg_short="${pkg_name#@gd/}"
  dest="$GD_NM_DIR/$pkg_short"

  rm -rf "$dest"
  cp -R "$pkg_dir" "$dest"
  count=$((count + 1))
  echo "[materialize] $dest <= $pkg_dir (refreshed)"
done

echo "[materialize] done, refreshed $count workspace package(s)"
```

- [ ] **Step 3: 加可执行位**

```bash
chmod +x scripts/materialize-workspace-deps.sh
```

- [ ] **Step 4: 跑一次确认基础逻辑**

```bash
bash scripts/materialize-workspace-deps.sh
```

期望输出：
```
[materialize] /.../node_modules/@gd/shared <= /.../packages/shared (refreshed)
[materialize] /.../node_modules/@gd/web <= /.../packages/web (refreshed)
[materialize] /.../node_modules/@gd/scheduler <= /.../packages/scheduler (refreshed)
[materialize] /.../node_modules/@gd/cli <= /.../packages/cli (refreshed)
[materialize] done, refreshed 4 workspace package(s)
```

此时 4 个包只各含 `package.json` + `.gitkeep`，但脚本工作。

- [ ] **Step 5: 确认 `node_modules/@gd/*` 不再是 symlink**

```bash
ls -l node_modules/@gd/
```

期望：4 行均为 `drwx...` 目录形式，不是 `lrwx...` symlink。

- [ ] **Step 6: 验证 spec §7.3.5 的恢复路径——`npm install` 把 symlink 重建回来**

```bash
npm install
ls -l node_modules/@gd/
```

期望：4 行重新变 symlink 指 `packages/*`。

- [ ] **Step 7: 提交**

```bash
git add scripts/materialize-workspace-deps.sh
git commit -m "build: add materialize-workspace-deps.sh for FC deploy packaging

s deploy 时通过 s.yaml actions.pre-deploy 钩子调用，把 node_modules/@gd/*
从 npm workspaces 的 symlink 替换为 packages/* 的实体副本，避免 Serverless
Devs 打包对 symlink 处理不确定导致 FC 端 require @gd/shared 失败。

脚本以 packages/* 为权威源、每次 rm -rf + cp -R 全量刷新，保证后续
s deploy 都能反映最新源码（而非首次实体化时的快照）。详见 spec §7.3。"
```

---

### Task 3: 迁移 `@gd/shared`（lib/* + config.js + 跨包 require 改造）

**Files:**
- Move: 8 个文件 `lib/*.js`、`config.js` → `packages/shared/src/*`
- Move: 3 个测试 `test/lib/{firewall-rule,swas-firewall,handler-swas-open}.test.js` → `packages/shared/test/*`
- Create: `packages/shared/src/index.js`
- Create: `config.js` （根 shim）
- Modify: `packages/shared/package.json`（加 deps + scripts.test + main）
- Modify: `index.js` (root, 临时仍在 root，更新 require 路径)
- Modify: `bin/ecs-dsec-handler.js` (临时仍在 root，更新 require 路径)
- Modify: `app/controller/api.js`、`app/controller/openapi.js`、`app/service/aliyun.js`（更新 require 路径）
- Modify: `test/index.test.js`、`test/app/service/aliyun.test.js`（更新 require/require.resolve 路径）

- [ ] **Step 1: 移动 7 个共享 lib 文件**

```bash
git mv lib/firewall-rule.js     packages/shared/src/firewall-rule.js
git mv lib/swas-firewall.js     packages/shared/src/swas-firewall.js
git mv lib/ecs-firewall.js      packages/shared/src/ecs-firewall.js
git mv lib/ip.js                packages/shared/src/ip.js
git mv lib/aliyun-conf.js       packages/shared/src/aliyun-conf.js
git mv lib/public-ip.js         packages/shared/src/public-ip.js
git mv lib/handler-swas-open.js packages/shared/src/handler-swas-open.js
```

- [ ] **Step 2: 把根 `config.js` 移成 `rule-config.js`**

```bash
git mv config.js packages/shared/src/rule-config.js
```

注意：根目录 `config.js` 此刻消失。后面 Step 13 会写回 1 行 shim。

- [ ] **Step 3: 删空 `lib/` 占位、删 `packages/shared/src/.gitkeep`**

```bash
rmdir lib 2>/dev/null || true
rm packages/shared/src/.gitkeep
```

`rmdir` 只在 `lib/` 已经空时成功；若仍有遗留文件就保留（Task 5 会处理 web 私有 lib）。

实际上现在 `lib/` 还含 `access-token.js`、`passkey.js`、`passkey-counter-store.js` 三个 web-private 文件，所以 `rmdir` 会失败，保持 `lib/` 目录。

- [ ] **Step 4: 移动 shared 的 3 个测试文件**

```bash
git mv test/lib/firewall-rule.test.js     packages/shared/test/firewall-rule.test.js
git mv test/lib/swas-firewall.test.js     packages/shared/test/swas-firewall.test.js
git mv test/lib/handler-swas-open.test.js packages/shared/test/handler-swas-open.test.js
rm packages/shared/test/.gitkeep
```

- [ ] **Step 5: 写 `packages/shared/src/index.js` barrel**

```js
'use strict';

module.exports = {
  ...require('./firewall-rule'),
  ...require('./ip'),
};
```

只 re-export 通用工具；其余子模块（aliyun-conf、handler-swas-open、rule-config 等）通过 `require('@gd/shared/src/<x>')` 子路径访问，避免大型 barrel 把所有东西都打包暴露。

- [ ] **Step 6: 更新 `packages/shared/package.json` 为完整形态**

```json
{
  "name": "@gd/shared",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.js",
  "scripts": {
    "test": "egg-bin test"
  },
  "dependencies": {
    "@alicloud/ecs20140526": "6.1.0",
    "@alicloud/swas-open20200601": "4.0.0"
  }
}
```

- [ ] **Step 7: 更新 `packages/shared/test/firewall-rule.test.js` 的 require**

把 `require('../../lib/firewall-rule')` 改成 `require('../src/firewall-rule')`：

- Old: `} = require('../../lib/firewall-rule');`
- New: `} = require('../src/firewall-rule');`

- [ ] **Step 8: 更新 `packages/shared/test/swas-firewall.test.js` 的 require**

- Old: `const { listAllFirewallRules } = require('../../lib/swas-firewall');`
- New: `const { listAllFirewallRules } = require('../src/swas-firewall');`

- [ ] **Step 9: 更新 `packages/shared/test/handler-swas-open.test.js` 的 require（两处）**

- Old: `const { PORT_RANGE } = require('../../lib/firewall-rule');`
- New: `const { PORT_RANGE } = require('../src/firewall-rule');`

- Old: `const { __private__: { ensureSwasRuleForProtocol } } = require('../../lib/handler-swas-open');`
- New: `const { __private__: { ensureSwasRuleForProtocol } } = require('../src/handler-swas-open');`

- [ ] **Step 10: 更新根 `index.js`（仍在 root，下个 task 才搬到 scheduler）**

文件 `index.js` 第 1-28 行区域里多处 `require('./lib/...')` 与 `require('./config')`，逐条改为 `@gd/shared/src/...`：

- Old:
```js
const {
  default: ECSClient,
  ModifySecurityGroupRuleRequest,
  AuthorizeSecurityGroupRequest,
} = require('@alicloud/ecs20140526');
const {
  default: SWASClient,
  ModifyFirewallRuleRequest,
  CreateFirewallRulesRequest,
  DeleteFirewallRulesRequest,
} = require('@alicloud/swas-open20200601');

const { DOMAIN, RuleConfig } = require('./config');
const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeIpForCompare,
  formatDateTime,
  getRuleField,
  buildManagedDdnsRemark,
  isManagedDdnsRemark,
  isOurManagedRemark,
  findManagedRule,
  findRuleByProtocolPortSource,
} = require('./lib/firewall-rule');
const { listAllFirewallRules } = require('./lib/swas-firewall');
const { listSecurityGroupRules } = require('./lib/ecs-firewall');
```
- New:
```js
const {
  default: ECSClient,
  ModifySecurityGroupRuleRequest,
  AuthorizeSecurityGroupRequest,
} = require('@alicloud/ecs20140526');
const {
  default: SWASClient,
  ModifyFirewallRuleRequest,
  CreateFirewallRulesRequest,
  DeleteFirewallRulesRequest,
} = require('@alicloud/swas-open20200601');

const { DOMAIN, RuleConfig } = require('@gd/shared/src/rule-config');
const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeIpForCompare,
  formatDateTime,
  getRuleField,
  buildManagedDdnsRemark,
  isManagedDdnsRemark,
  isOurManagedRemark,
  findManagedRule,
  findRuleByProtocolPortSource,
} = require('@gd/shared/src/firewall-rule');
const { listAllFirewallRules } = require('@gd/shared/src/swas-firewall');
const { listSecurityGroupRules } = require('@gd/shared/src/ecs-firewall');
```

- [ ] **Step 11: 更新根 `bin/ecs-dsec-handler.js`（仍在 root，Task 7 才搬到 cli）**

文件里有 4 处 require 要改（行号大约 5、6、45、52）：

- Old: `const { handleSwasOpen } = require('../lib/handler-swas-open');`
- New: `const { handleSwasOpen } = require('@gd/shared/src/handler-swas-open');`

- Old: `const { getPublicIp } = require('../lib/public-ip');`
- New: `const { getPublicIp } = require('@gd/shared/src/public-ip');`

- Old: `    const { resolveCredentials } = require('../lib/aliyun-conf');`
- New: `    const { resolveCredentials } = require('@gd/shared/src/aliyun-conf');`

- Old: `    const { RuleConfig } = require('../config');`
- New: `    const { RuleConfig } = require('@gd/shared/src/rule-config');`

- [ ] **Step 12: 更新 `app/controller/api.js`**

文件第 4 行：

- Old: `const { isValidIpv4 } = require('../../lib/ip');`
- New: `const { isValidIpv4 } = require('@gd/shared/src/ip');`

- [ ] **Step 13: 更新 `app/controller/openapi.js`**

文件第 4 行：

- Old: `const { isValidIpv4 } = require('../../lib/ip');`
- New: `const { isValidIpv4 } = require('@gd/shared/src/ip');`

- [ ] **Step 14: 更新 `app/service/aliyun.js`**

文件 16-29 行区域 4 个 require 改：

- Old: `const { resolveCredentials } = require('../../lib/aliyun-conf');`
- New: `const { resolveCredentials } = require('@gd/shared/src/aliyun-conf');`

- Old: `} = require('../../lib/firewall-rule');`
- New: `} = require('@gd/shared/src/firewall-rule');`

- Old: `const { listAllFirewallRules } = require('../../lib/swas-firewall');`
- New: `const { listAllFirewallRules } = require('@gd/shared/src/swas-firewall');`

- Old: `const { listSecurityGroupRules } = require('../../lib/ecs-firewall');`
- New: `const { listSecurityGroupRules } = require('@gd/shared/src/ecs-firewall');`

- [ ] **Step 15: 更新 `test/index.test.js`（仍在 root，Task 6 才搬到 scheduler）**

文件第 5、11 行：

- Old: `const { PORT_RANGE } = require('../lib/firewall-rule');`
- New: `const { PORT_RANGE } = require('@gd/shared/src/firewall-rule');`

- Old: `  const swasFirewallPath = require.resolve('../lib/swas-firewall');`
- New: `  const swasFirewallPath = require.resolve('@gd/shared/src/swas-firewall');`

注意 `require.resolve` 路径必须和 `index.js`（scheduler 主体）里实际 require 的字符串一致，否则 `require.cache` 投毒失效——所以这两条要同步改。

- [ ] **Step 16: 更新 `test/app/service/aliyun.test.js`**

文件第 6、12 行：

- Old: `const { PORT_RANGE } = require('../../../lib/firewall-rule');`
- New: `const { PORT_RANGE } = require('@gd/shared/src/firewall-rule');`

- Old: `  const swasFirewallPath = require.resolve('../../../lib/swas-firewall');`
- New: `  const swasFirewallPath = require.resolve('@gd/shared/src/swas-firewall');`

- [ ] **Step 17: 写根 `config.js` shim**

新建 `config.js`：

```js
'use strict';

module.exports = require('@gd/shared/src/rule-config');
```

兜底有人 `require('./config')` 拿 RuleConfig/DOMAIN。spec §6.2 已说明该 shim 依赖 `node_modules/@gd/shared` 存在，CI/local 都已经 `npm install` 过，正常。

- [ ] **Step 18: `npm install` 重建 node_modules 视图，让 `@gd/shared` 拿到新 deps**

```bash
npm install
```

- [ ] **Step 19: 跑 shared 测试**

```bash
npm test -w @gd/shared
```

期望：firewall-rule、swas-firewall、handler-swas-open 三个 test 文件全绿。

- [ ] **Step 20: 跑根 `npm test`（root 还没改 scripts.test，仍是 `egg-bin test`）**

```bash
npm test
```

期望：`test/index.test.js`（scheduler 回归）、`test/app/{controller,middleware,service}/*.test.js`（web）、`test/lib/{access-token,passkey,passkey-counter-store}.test.js`（web 私有）全部通过。

注意 root 的 `test/lib/firewall-rule.test.js` 等已经移走、root `test/lib/` 现在只剩 access-token、passkey、passkey-counter-store 三个测试，正常被 egg-bin 收。

- [ ] **Step 21: 提交**

```bash
git add -A
git commit -m "feat(shared): extract @gd/shared package

把 lib/{firewall-rule,swas-firewall,ecs-firewall,ip,aliyun-conf,public-ip,
handler-swas-open}.js 与 config.js 全部移入 packages/shared/src/，并把
config.js 重命名为 rule-config.js 以与 Egg 的 config/ 概念区分。

更新所有调用方 require 路径：
- 根 index.js 与 bin/ecs-dsec-handler.js
- app/controller/{api,openapi}.js、app/service/aliyun.js
- test/index.test.js、test/app/service/aliyun.test.js 同步把 require.resolve
  改为 @gd/shared/src/... 以确保 require.cache mock 命中

根 config.js 保留 1 行 shim 指 @gd/shared/src/rule-config，兜底外部脚本。"
```

---

### Task 4: 修复 `findRepoRoot` 识别 workspaces 根（TDD）

**Files:**
- Create: `packages/shared/test/aliyun-conf.test.js`
- Modify: `packages/shared/src/aliyun-conf.js`

- [ ] **Step 1: 写失败测试**

新建 `packages/shared/test/aliyun-conf.test.js`：

```js
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

    const { values } = loadAliyunConf({ cwd: baseDir });
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -w @gd/shared
```

期望：前两条新 it 都失败——第一条因为旧 `findRepoRoot` 在 `packages/cli/` 就停下，读不到 root 的 `.aliyun.conf`；第二条会通过（兼容路径），第三条会通过（loadAliyunConf 已处理空情况）。

- [ ] **Step 3: 实现 spec §7.1 的修复**

修改 `packages/shared/src/aliyun-conf.js` 里的 `findRepoRoot`：

- Old:
```js
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
```
- New:
```js
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
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -w @gd/shared
```

期望：3 条新 it 全绿，原 firewall 测试也仍绿。

- [ ] **Step 5: 跑根 `npm test` 确认 baseline 仍没坏**

```bash
npm test
```

期望：全部通过。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "fix(shared): findRepoRoot now identifies workspaces root, not first parent

monorepo 化后 CLI 从 packages/cli/bin/ 启动，旧 findRepoRoot 撞到的第一个
package.json 是 packages/cli/package.json，找不到仓库根的 .aliyun.conf。

改为继续向上、优先返回带 'workspaces' 字段的 package.json 所在目录；若一路
没有 workspaces 字段则回退到最顶层的 package.json，保留单包仓库的旧行为。

新增 packages/shared/test/aliyun-conf.test.js 用临时目录模拟 monorepo 与
单包两种结构，确保行为正确。spec §7.1。"
```

---

### Task 5: 迁移 `@gd/web`（app/、config/、bootstrap.js、web 私有 lib、测试）

**Files:**
- Move: `app/` → `packages/web/app/`
- Move: `config/` → `packages/web/config/`
- Move: `bootstrap.js` → `packages/web/bootstrap.js`
- Move: `lib/access-token.js`、`lib/passkey.js`、`lib/passkey-counter-store.js` → `packages/web/lib/`
- Move: `test/app/`、`test/lib/access-token.test.js`、`test/lib/passkey.test.js`、`test/lib/passkey-counter-store.test.js` → `packages/web/test/`
- Create: `bootstrap.js` （根 shim）
- Modify: `packages/web/package.json`（加 deps、scripts、egg 配置）

- [ ] **Step 1: 建 web 子目录骨架**

```bash
mkdir -p packages/web/lib packages/web/test/app packages/web/test/lib
rm -f packages/web/test/.gitkeep
```

- [ ] **Step 2: 移动 Egg.js 应用主体**

```bash
git mv app    packages/web/app
git mv config packages/web/config
git mv bootstrap.js packages/web/bootstrap.js
```

注意 `bootstrap.js` 此刻从 root 消失，Step 8 会写回 shim。

- [ ] **Step 3: 移动 3 个 web 私有 lib 文件**

```bash
git mv lib/access-token.js          packages/web/lib/access-token.js
git mv lib/passkey.js               packages/web/lib/passkey.js
git mv lib/passkey-counter-store.js packages/web/lib/passkey-counter-store.js
```

- [ ] **Step 4: 删空的根 `lib/` 目录**

```bash
rmdir lib
```

此刻 `lib/` 已经空（shared 文件在 Task 3 移走，web 私有刚移走）。

- [ ] **Step 5: 移动 web 相关测试**

```bash
git mv test/app/controller          packages/web/test/app/controller
git mv test/app/middleware          packages/web/test/app/middleware
git mv test/app/service             packages/web/test/app/service
git mv test/lib/access-token.test.js          packages/web/test/lib/access-token.test.js
git mv test/lib/passkey.test.js               packages/web/test/lib/passkey.test.js
git mv test/lib/passkey-counter-store.test.js packages/web/test/lib/passkey-counter-store.test.js
```

- [ ] **Step 6: 清理空目录**

```bash
rmdir test/app 2>/dev/null || true
rmdir test/lib 2>/dev/null || true
```

`test/app/` 应该空（所有子目录都移走）；`test/lib/` 也应该空（最后 3 个测试刚移走）。root `test/` 还有 `index.test.js`（Task 6 处理）。

- [ ] **Step 7: 写 `packages/web/package.json` 完整形态**

```json
{
  "name": "@gd/web",
  "version": "1.0.0",
  "private": true,
  "egg": {
    "framework": "egg"
  },
  "scripts": {
    "dev":   "egg-bin dev",
    "start": "EGG_SERVER_ENV=prod NODE_ENV=prod EGG_WORKERS=1 node bootstrap.js",
    "test":  "egg-bin test",
    "cov":   "egg-bin cov"
  },
  "dependencies": {
    "@gd/shared": "*",
    "@alicloud/ecs20140526": "6.1.0",
    "@alicloud/swas-open20200601": "4.0.0",
    "egg": "^3.34.0",
    "jsonwebtoken": "^9.0.3",
    "@simplewebauthn/server": "^13.3.0"
  }
}
```

`"egg": {"framework":"egg"}` 字段从根迁过来；根 package.json 的 egg 字段会在 Task 8 删掉。`@alicloud/*` 重复声明是因为 `app/service/aliyun.js` 直接 require 这两个 SDK（spec §5.3 已说明）。

- [ ] **Step 8: 写根 `bootstrap.js` shim**

新建 `bootstrap.js`：

```js
'use strict';

require('./packages/web/bootstrap');
```

`./packages/web/bootstrap` 直接定位到 `packages/web/bootstrap.js`（per Node.js 解析），不依赖 `@gd/web` 包解析。

- [ ] **Step 9: `npm install` 触发新 deps 安装**

```bash
npm install
```

`@simplewebauthn/server`、`jsonwebtoken`、`egg` 等都已在根存在，hoist 即可。

- [ ] **Step 10: 跑 web 测试**

```bash
npm test -w @gd/web
```

期望：`test/app/controller/openapi.test.js`、`test/app/middleware/{jwt_auth,password_auth}.test.js`、`test/app/service/aliyun.test.js`、`test/lib/{access-token,passkey,passkey-counter-store}.test.js` 全绿。

注意 web 内部 require 路径不需要改：
- `app/controller/auth.js` 的 `require('../../lib/access-token')` 在 packages/web/app/controller/ 下相对解析 = `packages/web/lib/access-token` ✓
- `test/app/middleware/jwt_auth.test.js` 的 `require('../../../lib/access-token')` 在 packages/web/test/app/middleware/ 下相对解析 = `packages/web/lib/access-token` ✓
- shared 相关 require 路径已经在 Task 3 改成 `@gd/shared/src/...`，跨包绝对路径，与位置无关

- [ ] **Step 11: 跑 shared 测试 + 根测试，确认没有回归**

```bash
npm test -w @gd/shared
npm test
```

`npm test` 此刻只会跑 root `test/index.test.js`（scheduler 回归，未移走）。

- [ ] **Step 12: 跑一次 `npm run dev` 看 Egg 能起服（Ctrl-C 关闭）**

```bash
npm run dev
```

期望：root scripts `dev` 还是 `egg-bin dev`，会在 root 当前目录运行——root 没有 app/、config/ 了，egg-bin 应该会报错。这是预期：Task 8 会把 root scripts.dev 改成 `npm run dev -w @gd/web`。

**临时跳过 dev 验证**，直接 Step 13。Task 8 之后再验证。

- [ ] **Step 13: 提交**

```bash
git add -A
git commit -m "feat(web): extract @gd/web package

把 Egg.js 应用主体（app/, config/, bootstrap.js）+ 3 个 web 私有 lib 文件
（access-token, passkey, passkey-counter-store）+ 对应测试迁入
packages/web/，更新 packages/web/package.json 把 egg framework 配置、Egg
scripts、相关 dependencies 都从根迁过来。

根 bootstrap.js 用 1 行 shim 重定向到 packages/web/bootstrap，保证 FC web
函数的 handler 配置不变；包内相对 require 路径保持原样（位置对称迁移）。
跨包 require 已在 Task 3 改为 @gd/shared/src/...，不需要再动。"
```

---

### Task 6: 迁移 `@gd/scheduler`（index.js + 它的回归测试）

**Files:**
- Move: `index.js` → `packages/scheduler/index.js`
- Move: `test/index.test.js` → `packages/scheduler/test/index.test.js`
- Create: `index.js` （根 shim）
- Modify: `packages/scheduler/package.json`（加 scripts.test、main、deps）
- Modify: `packages/scheduler/test/index.test.js`（修 require.resolve 路径，确保 mock 命中）

- [ ] **Step 1: 把 root `index.js` 移到 scheduler**

```bash
git mv index.js packages/scheduler/index.js
```

`require('./config')`、`require('./lib/...')` 已在 Task 3 改为 `@gd/shared/src/*`，跨包路径与位置无关，移动后仍可解析。

- [ ] **Step 2: 把 root `test/index.test.js` 移到 scheduler**

```bash
git mv test/index.test.js packages/scheduler/test/index.test.js
```

- [ ] **Step 3: 清理 root `test/`**

```bash
rmdir test 2>/dev/null || true
```

此刻 `test/` 应该完全空，可以删掉。

- [ ] **Step 4: 修 scheduler 测试里 `require.resolve('../index')` 与文件相对路径**

`packages/scheduler/test/index.test.js` 第 8 行：

- Old: `  const indexPath = require.resolve('../index');`
- New: `  const indexPath = require.resolve('../index');`

不变——测试相对位置不变（test/ 与 index.js 都在 packages/scheduler/ 下，`../index` 仍解析到 `packages/scheduler/index`）。Task 3 已经把 swas-firewall 路径改为 `@gd/shared/src/swas-firewall`，本步骤只需确认。

具体确认：
```bash
grep -n "require\|require.resolve" packages/scheduler/test/index.test.js | head -20
```

应该看到：
- 第 5 行: `const { PORT_RANGE } = require('@gd/shared/src/firewall-rule');`
- 第 8 行: `const indexPath = require.resolve('../index');`
- 第 11 行: `const swasFirewallPath = require.resolve('@gd/shared/src/swas-firewall');`

若发现 `@gd/shared/src/swas-firewall` 路径处仍是 `../lib/...`，说明 Task 3 Step 15 漏了——补做。

- [ ] **Step 5: 更新 `packages/scheduler/package.json`**

```json
{
  "name": "@gd/scheduler",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "scripts": {
    "test": "egg-bin test"
  },
  "dependencies": {
    "@gd/shared": "*",
    "@alicloud/ecs20140526": "6.1.0",
    "@alicloud/swas-open20200601": "4.0.0"
  }
}
```

`scripts.test` 是必须的——spec §5.4 已明确，否则 `npm test -ws --if-present` 会跳过 scheduler。

- [ ] **Step 6: 写根 `index.js` shim**

新建 `index.js`：

```js
'use strict';

module.exports = require('./packages/scheduler');
```

FC 控制台 handler 配置仍是 `index.handler`——`module.exports` 会代理到 `packages/scheduler/index.js` 的 `exports.handler`，保留旧入口。

- [ ] **Step 7: 跑 scheduler 测试**

```bash
npm test -w @gd/scheduler
```

期望：13 个 `scheduler rule ownership` describe 块下的 it 全绿。

- [ ] **Step 8: 跑根的 `index.js` shim 验证（缺凭证应报阿里云相关错，不是 module-not-found）**

```bash
ACCESS_KEY_ID= ACCESS_KEY_SECRET= node -e "require('./index').handler({},{},(e,r)=>{console.log('err:',e?e.message:'(none)','res:',r);});"
```

期望：要么 `err: (some aliyun error)`、要么 `err: Failed to reconcile ...`。若是 `Cannot find module ...` 就说明 require 链路断了。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat(scheduler): extract @gd/scheduler package

把根 index.js（FC ecs-dsec 定时函数 handler）和它的回归测试
test/index.test.js 一起迁入 packages/scheduler/。回归测试现在落到正确的
package 下，并通过 @gd/scheduler 的 scripts.test = 'egg-bin test' 被
根 npm test -ws --if-present 收纳，而不是被静默跳过（spec finding 2 修正）。

根 index.js 替换为 1 行 shim 指向 packages/scheduler，FC 控制台
handler 配置 index.handler 仍命中。"
```

---

### Task 7: 迁移 `@gd/cli`（bin/ + 根 bin shim）

**Files:**
- Move: `bin/ecs-dsec-handler.js` → `packages/cli/bin/ecs-dsec-handler.js`
- Create: `bin/ecs-dsec-handler.js` （根 shim）
- Modify: `packages/cli/package.json`（加 bin 字段 + dep）

- [ ] **Step 1: 把 CLI 文件移入 cli**

```bash
git mv bin/ecs-dsec-handler.js packages/cli/bin/ecs-dsec-handler.js
rm -f packages/cli/bin/.gitkeep
```

require 路径已在 Task 3 改为 `@gd/shared/src/*` + `@gd/shared/src/rule-config`，跨包路径与位置无关。

- [ ] **Step 2: 写 `packages/cli/package.json` 完整形态**

```json
{
  "name": "@gd/cli",
  "version": "1.0.0",
  "private": true,
  "bin": {
    "ecs-dsec-handler": "bin/ecs-dsec-handler.js"
  },
  "dependencies": {
    "@gd/shared": "*"
  }
}
```

不显式列 `@alicloud/*`——CLI 本身不 require 它，依赖通过 `@gd/shared/src/handler-swas-open` 传递（spec §5.5）。

- [ ] **Step 3: 写根 `bin/ecs-dsec-handler.js` shim**

新建 `bin/ecs-dsec-handler.js`：

```js
#!/usr/bin/env node
'use strict';

require('../packages/cli/bin/ecs-dsec-handler');
```

注意 `#!/usr/bin/env node` shebang 必须保留，配合根 `package.json` 的 `bin` 字段让 `npx ecs-dsec-handler` 仍能 spawn。

- [ ] **Step 4: 给根 bin shim 加可执行位**

```bash
chmod +x bin/ecs-dsec-handler.js
```

- [ ] **Step 5: 给 cli 本体 bin 也加可执行位**

```bash
chmod +x packages/cli/bin/ecs-dsec-handler.js
```

`git mv` 应该保留模式位，但显式 `chmod +x` 兜底。

- [ ] **Step 6: `npm install` 刷新 npm 的 bin link**

```bash
npm install
```

应该看到 `node_modules/.bin/ecs-dsec-handler` 软链建好（指根 `bin/ecs-dsec-handler.js`）。

- [ ] **Step 7: 验证 CLI shim 链路**

```bash
ACCESS_KEY_ID= ACCESS_KEY_SECRET= node bin/ecs-dsec-handler.js --help
```

期望：打印 usage（不依赖凭证），不报 `Cannot find module`。

```bash
npx ecs-dsec-handler --help
```

期望：同样打印 usage。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(cli): extract @gd/cli package

把 bin/ecs-dsec-handler.js 迁入 packages/cli/，根 bin/ecs-dsec-handler.js
替换为 1 行 shim 保留 README 范例与 npx ecs-dsec-handler 入口。CLI 不
直接 require @alicloud/* SDK——通过 @gd/shared/src/handler-swas-open 间接
拿——所以 @gd/cli 只声明 @gd/shared 一条依赖（spec §5.5）。"
```

---

### Task 8: 更新根 `package.json` scripts、清理迁走的 deps

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: 全文重写根 `package.json`**

新内容：

```json
{
  "name": "gd",
  "version": "1.0.0",
  "private": true,
  "repository": "git@github.com:rockdai/gd.git",
  "workspaces": ["packages/*"],
  "bin": {
    "ecs-dsec-handler": "bin/ecs-dsec-handler.js"
  },
  "scripts": {
    "dev":   "npm run dev   -w @gd/web",
    "start": "npm run start -w @gd/web",
    "test":  "npm test -ws --if-present",
    "cov":   "npm run cov -ws --if-present"
  },
  "devDependencies": {
    "egg-bin": "^6.13.0"
  }
}
```

变更要点：
- 去掉 `"egg": {"framework":"egg"}`——已迁到 `@gd/web`。
- 去掉 `"dependencies"` 整段——`@alicloud/*`、`egg`、`jsonwebtoken`、`@simplewebauthn/server` 都已在子 package 各自声明。
- `scripts.dev` / `scripts.start` 改为 dispatch 到 `@gd/web`。
- `scripts.test` / `scripts.cov` 改为 `-ws --if-present`，遍历所有 workspace。
- `devDependencies` 保留 `egg-bin`——npm hoist 后 root `node_modules/.bin/egg-bin` 可见，各 workspace 都能调用。

- [ ] **Step 2: `npm install` 重建 node_modules（清理已删的 root deps）**

```bash
npm install
```

应该看到 npm 删除已不再被根 package.json 引用的包（实际上它们仍被子 package 引用，所以会保留）。`package-lock.json` 会变。

- [ ] **Step 3: 验证 4 个 @gd/* symlink 仍在**

```bash
ls -l node_modules/@gd/
```

期望：4 行 symlink。

- [ ] **Step 4: 跑全套测试**

```bash
npm test
```

期望：根 `npm test` 现在等价于 `npm test --workspaces --if-present`，依次跑 `@gd/shared`、`@gd/web`、`@gd/scheduler` 的测试。`@gd/cli` 无 scripts.test，自动跳过。所有跑到的 describe/it 全绿。

- [ ] **Step 5: 验证 `npm run dev` 现在能起 web 服**

```bash
npm run dev
```

应该看到 Egg.js 启动日志（"Egg started on http://127.0.0.1:7001"），按 Ctrl-C 关闭。

- [ ] **Step 6: 验证 `npm run start` 入口正常（不需要等到真起起来，过 require resolution 即可）**

```bash
EGG_SERVER_ENV=prod NODE_ENV=prod EGG_WORKERS=1 timeout 5 npm run start 2>&1 | head -20 || true
```

期望：看到 Egg 启动序列，5 秒超时退出。若有 `Cannot find module` 立即查问题。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "chore: rewrite root package.json for workspace dispatch

- 加 \"workspaces\": [\"packages/*\"]
- scripts.dev / scripts.start 转发到 @gd/web
- scripts.test / scripts.cov 改为 npm test -ws --if-present
- 删除已迁出的 dependencies（@alicloud/*、egg、jsonwebtoken、@simplewebauthn/server）
  和 egg framework 配置——它们现在归各 workspace
- 保留 devDependencies.egg-bin 给 hoist 后所有 workspace 共用"
```

---

### Task 9: 给 `s.yaml` 加 `actions.pre-deploy` 钩子

**Files:**
- Modify: `s.yaml`

- [ ] **Step 1: 改写 `s.yaml`**

完整新内容：

```yaml
edition: 3.0.0
name: gd-whitelist
access: "default"

vars:
  region: cn-hangzhou

# 只部署代码，不更新函数配置。函数配置在阿里云控制台上管理。
# 部署命令: s deploy --function code --assume-yes
#
# pre-deploy 钩子把 npm workspaces symlink 实体化到 node_modules/@gd/*，
# 避免 Serverless Devs 打包对 symlink 处理不确定。详见
# docs/superpowers/specs/2026-05-15-monorepo-restructure-design.md §7.3

resources:
  # Web service (Egg.js PWA)
  gd-web:
    component: fc3
    actions:
      pre-deploy:
        - run: bash scripts/materialize-workspace-deps.sh
          path: ./
    props:
      region: ${vars.region}
      functionName: gd-web
      code: ./

  # 定时更新白名单（复用已有函数 ecs-dsec）
  ecs-dsec:
    component: fc3
    actions:
      pre-deploy:
        - run: bash scripts/materialize-workspace-deps.sh
          path: ./
    props:
      region: ${vars.region}
      functionName: ecs-dsec
      code: ./
```

- [ ] **Step 2: 静态校验 YAML 合法**

```bash
node -e "console.log(require('yaml').parse(require('fs').readFileSync('s.yaml','utf8')).resources['gd-web'].actions['pre-deploy'])"
```

期望：打印一个数组，含一项 `{ run: 'bash scripts/materialize-workspace-deps.sh', path: './' }`。

如果 `yaml` 模块不在 node_modules，用 Python 兜底：
```bash
python3 -c "import yaml,sys; print(yaml.safe_load(open('s.yaml'))['resources']['gd-web']['actions']['pre-deploy'])"
```

- [ ] **Step 3: 提交**

```bash
git add s.yaml
git commit -m "build: add actions.pre-deploy materialize hook to s.yaml

把 scripts/materialize-workspace-deps.sh 挂在 gd-web 与 ecs-dsec 两个
fc3 resource 的 pre-deploy 钩子上。这样任何形态的 s deploy ...
调用（CI、本地、--type code、--function code）都会先实体化
node_modules/@gd/* 再打包上传，FC 端 require @gd/shared 正常工作。

用户命令行无需改动；spec 硬约束 'old s deploy 必须仍工作' 字面满足。"
```

---

### Task 10: 更新 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 改"项目结构"小节为 monorepo 树**

定位到 README 里 `## 项目结构` 标题下面那段 ASCII 树（README:155-183 区域），替换为新结构：

- Old:
```
├── app/                    # Egg.js 应用
│   ├── controller/         # 控制器
│   │   ├── home.js         # 首页（PWA 入口）
│   │   └── api.js          # API 接口
│   ├── service/            # 服务层
│   │   └── aliyun.js       # 阿里云 SDK 服务
│   ├── public/             # 静态资源
│   │   ├── index.html      # PWA 页面
│   │   ├── manifest.json   # PWA manifest
│   │   └── sw.js           # Service Worker
│   └── router.js           # 路由定义
├── config/                 # Egg.js 配置
│   ├── config.default.js   # 默认配置（含 AK/SK、regions）
│   └── plugin.js           # 插件配置
├── lib/                    # 公共库
│   ├── aliyun-conf.js      # AK/SK 读取
│   ├── handler-swas-open.js # 轻量服务器处理
│   └── public-ip.js        # 公网 IP 获取
├── bin/                    # 命令行工具
│   └── ecs-dsec-handler.js
├── index.js                # FC 定时任务 handler
├── config.js               # 定时任务规则配置
├── bootstrap.js            # FC 自定义运行时启动入口
├── s.yaml                  # Serverless Devs 部署配置
└── package.json
```
- New:
```
├── package.json            # npm workspaces 入口；scripts 转发到子 package
├── bootstrap.js            # 根 shim → packages/web/bootstrap（FC web handler）
├── index.js                # 根 shim → packages/scheduler（FC ecs-dsec handler）
├── config.js               # 根 shim → @gd/shared/src/rule-config（兜底外部 require）
├── bin/ecs-dsec-handler.js # 根 shim → packages/cli/bin/...
├── s.yaml                  # Serverless Devs 部署配置；含 pre-deploy 钩子
├── scripts/
│   └── materialize-workspace-deps.sh  # 部署前把 workspace symlink 实体化
├── packages/
│   ├── shared/             # @gd/shared —— 跨 package 共用纯函数
│   │   ├── src/
│   │   │   ├── firewall-rule.js, swas-firewall.js, ecs-firewall.js
│   │   │   ├── ip.js, aliyun-conf.js, public-ip.js
│   │   │   ├── handler-swas-open.js
│   │   │   └── rule-config.js          # 原根 config.js（DOMAIN + RuleConfig）
│   │   └── test/
│   ├── web/                # @gd/web —— Egg.js PWA + OpenAPI
│   │   ├── app/{controller,middleware,service,public}/, router.js
│   │   ├── config/         # Egg.js 配置（含 passkey、jwt、aliyun、amap）
│   │   ├── bootstrap.js    # Egg.js 启动入口
│   │   ├── lib/            # web 私有：access-token、passkey、passkey-counter-store
│   │   └── test/
│   ├── scheduler/          # @gd/scheduler —— FC 定时任务
│   │   ├── index.js
│   │   └── test/index.test.js
│   └── cli/                # @gd/cli —— ecs-dsec-handler 命令行
│       └── bin/ecs-dsec-handler.js
└── docs/                   # 设计文档（含 spec / plan）
```

- [ ] **Step 2: 在"快速开始 / 本地开发"小节注明 monorepo 用法**

定位到 `### 本地开发（Web 服务）` 区域，在 `npm i` 那段后面补一个 note 块：

加入这一段（放在 `npm run dev` 命令后、`> 生产域名...` 之前）：

```markdown
> 这是 npm workspaces monorepo：`npm i` 会安装所有 `packages/*` 的依赖并把它们建成 `node_modules/@gd/*` 的 symlink。
> `npm run dev` / `npm run start` / `npm test` 在根目录均可直接用——根 `package.json` 把它们转发到对应 workspace。
> 若只跑某一包的测试：`npm test -w @gd/shared`、`npm test -w @gd/web`、`npm test -w @gd/scheduler`。
```

- [ ] **Step 3: 在"部署到函数计算 FC"小节加 pre-deploy 钩子说明**

在 `s deploy --type code` 命令后面补一个 note：

```markdown
> `s.yaml` 已包含 `actions.pre-deploy` 钩子，会在打包前自动跑 `scripts/materialize-workspace-deps.sh`——把 `node_modules/@gd/*` 的 workspace symlink 替换为实体副本，确保 FC 端 require `@gd/shared` 正常解析。
> **本地副作用提醒**：跑过 `s deploy` 后 `node_modules/@gd/*` 会从 symlink 变成静态副本；想恢复 symlink（让本地源码修改实时可见）重新跑一次 `npm install` 即可。
```

- [ ] **Step 4: 加 passkey counter 路径迁移 note**

定位到 `PASSKEY_COUNTERS_FILE` 那一行说明（README:143 附近），改为：

- Old: `- \`PASSKEY_COUNTERS_FILE\`：服务端持久化 passkey counter 的文件路径，默认 \`run/passkey-counters.json\``
- New: `- \`PASSKEY_COUNTERS_FILE\`：服务端持久化 passkey counter 的文件路径，默认 \`packages/web/run/passkey-counters.json\`（旧版默认是 \`run/passkey-counters.json\`，monorepo 化后 \`appInfo.baseDir\` 变成 \`packages/web/\`——本地有遗留计数器文件可以手工 mv 或显式设环境变量）`

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: update README for monorepo structure

- 项目结构小节改为 packages/* 4 个 workspace 的新树
- 本地开发小节加 npm workspaces 用法说明
- 部署小节注明 s.yaml pre-deploy 钩子和本地 symlink 副作用
- passkey counter 路径加一条迁移说明"
```

---

### Task 11: 端到端 verify（自动化 V1-V11）+ 手工 V12-V13

**Files:** 无（验证步骤）

- [ ] **Step 1: V1 — `npm install` 后 `node_modules/@gd/*` 全是 symlink**

```bash
npm install
ls -l node_modules/@gd/ | grep -E "^l"
```

期望：4 行 `l...` symlink 行。

- [ ] **Step 2: V2 — 全测试通过，且 scheduler describe 块**真的**跑了**

```bash
npm test 2>&1 | tee /tmp/gd-test.log
grep -F "scheduler rule ownership" /tmp/gd-test.log
```

期望：第一条 `npm test` 退出码 0；第二条 grep 输出非空（证明 scheduler describe 块被收纳）。

- [ ] **Step 3: V3 — web 本地起服**

```bash
timeout 8 npm run dev 2>&1 | tee /tmp/gd-dev.log || true
grep -F "egg started" /tmp/gd-dev.log
```

期望：grep 命中。

(`timeout 8` 后 SIGTERM；用 `|| true` 让脚本继续。)

- [ ] **Step 4: V4 — scheduler handler 入口可调用**

```bash
ACCESS_KEY_ID= ACCESS_KEY_SECRET= node -e "require('./index').handler({},{},(e,r)=>{console.log('err:',e?e.message:'(none)');});" 2>&1
```

期望：输出含 `err: ` 但不是 `Cannot find module ...`。

- [ ] **Step 5: V5 — CLI dry-run**

```bash
node bin/ecs-dsec-handler.js --help
node bin/ecs-dsec-handler.js --dry-run 2>&1 | head -5
```

期望：第一条打印 usage；第二条要么打印 IP / 凭证 source，要么因为没配凭证报错——但不能是 module-not-found。

- [ ] **Step 6: V6 — 根 bin shim 可执行（无 `node` 前缀）**

```bash
ls -l bin/ecs-dsec-handler.js
./bin/ecs-dsec-handler.js --help
```

期望：第一条看到 `-rwx...` 模式；第二条打印 usage。

- [ ] **Step 7: V7 — CLI 实际读到 `RuleConfig`**

```bash
node -e "
  const { RuleConfig } = require('@gd/shared/src/rule-config');
  const swasCount = RuleConfig.filter(c => c.product === 'swas-open').length;
  console.log('swas-open count:', swasCount);
"
```

记下输出的数字 N。然后：

```bash
ACCESS_KEY_ID= ACCESS_KEY_SECRET= node bin/ecs-dsec-handler.js --dry-run 2>&1 | grep -c "swas-open" || true
```

期望：第二条命中次数 ≥ N（每个 swas-open conf 会触发若干行 log）。或者更简单——直接用 V7 的两个数字对比。重点是验证"CLI 真的把 RuleConfig 读出来并对每条 swas-open 配置走了一遍逻辑"。

- [ ] **Step 8: V8 — `npx ecs-dsec-handler` 入口正常**

```bash
npx ecs-dsec-handler --help
```

期望：打印 usage。

- [ ] **Step 9: V9 — 实体化脚本独立跑**

```bash
bash scripts/materialize-workspace-deps.sh
ls -l node_modules/@gd/ | grep -v "^l"
```

期望：第二条至少 4 行 `d...` 目录行（不是 symlink）。

- [ ] **Step 10: V10 — 实体化后 require 仍可解析**

```bash
node -e "console.log(require('@gd/shared/src/firewall-rule').PORT_RANGE)"
```

期望：打印 `1/65535`。

- [ ] **Step 11: V11 — 脚本每次都以源为权威刷新**

```bash
bash scripts/materialize-workspace-deps.sh
echo "v2-marker" > packages/shared/src/__verify__.txt
bash scripts/materialize-workspace-deps.sh
grep -q "v2-marker" node_modules/@gd/shared/src/__verify__.txt && echo "V11 add: OK"
rm packages/shared/src/__verify__.txt
bash scripts/materialize-workspace-deps.sh
test ! -e node_modules/@gd/shared/src/__verify__.txt && echo "V11 delete: OK"
```

期望：两条 `... OK` 都打印。

- [ ] **Step 12: 恢复 npm workspaces symlink 让本地开发体验回来**

```bash
npm install
ls -l node_modules/@gd/ | grep -c "^l"
```

期望：第二条输出 `4`。

- [ ] **Step 13: V13 — 手工按 README 第 49-77 行命令逐条 smoke test**

按 README "本地开发"、"命令行工具"、"本地调试（定时任务 handler）"小节列的命令各跑一次，确认没有 module-not-found / scripts 路径错。

- [ ] **Step 14: V12 — 测试环境真实 `s deploy`（手工执行 + 记录结果）**

**注意：本步骤需要测试环境的阿里云凭证和一个非生产 FC 函数命名空间，不要直接对 prod 跑。**

```bash
# 设置测试环境凭证（占位，按实际改）
export ACCESS_KEY_ID=<test_id>
export ACCESS_KEY_SECRET=<test_sec>

npm install --production
s deploy --function code --assume-yes 2>&1 | tee /tmp/gd-deploy.log

grep -F "[materialize]" /tmp/gd-deploy.log
```

期望：第三条命中——证明 pre-deploy 钩子确实跑了。然后在阿里云 FC 控制台触发一次 gd-web 函数请求和 ecs-dsec 函数调度，确认没有 `Cannot find module '@gd/shared'`。

若没有测试环境或不便部署，**至少**用 `s deploy --function code --dry-run`（如果工具支持）或者 `s build`（如果有）来确认打包阶段不报错。

- [ ] **Step 15: 提交 verify 日志（可选）**

```bash
mkdir -p docs/superpowers/verify
cp /tmp/gd-test.log docs/superpowers/verify/2026-05-15-task11-test.log 2>/dev/null || true
cp /tmp/gd-deploy.log docs/superpowers/verify/2026-05-15-task11-deploy.log 2>/dev/null || true
git add docs/superpowers/verify/ 2>/dev/null
git diff --cached --stat | grep -q verify && git commit -m "chore: archive task-018 verify run logs" || true
```

这是 best-effort 归档；如果日志文件不存在或没被改动，commit 跳过。

---

## 最终检查清单

完成 Tasks 1-11 后，按以下顺序自检 ONE MORE TIME：

- [ ] **结构对齐 spec §3**: `tree -L 3 packages/ -I node_modules` 与 spec 目录布局一一对应。
- [ ] **没有遗留**: `git grep -nE "require\\('(\\.\\./)?lib/" -- packages/` 输出空（所有 `lib/` 引用要么走 `@gd/shared/src/...` 要么走包内相对路径）。
- [ ] **rename history 保留**: `git log --diff-filter=R --name-status` 显示一系列 `R...` 记录（rename detection 生效）。
- [ ] **shim 极简**: `wc -l index.js bootstrap.js config.js bin/ecs-dsec-handler.js` 每个文件都 ≤ 4 行。
- [ ] **CI workflow 无改动**: `git diff main -- .github/workflows/` 输出空。
- [ ] **acceptance §12 全 ✅**: §9 V1-V13 全过、README 反映新结构、`s.yaml` 含 pre-deploy 钩子。

---

## 出错时怎么办

- **Test 某条挂掉**: 先看是不是 require 路径漏改。`git grep "require\\('\\.\\./lib"` / `git grep "require\\('\\.\\./config"` 全仓库扫一遍。
- **`npm install` 失败**: 确认 4 个子包的 `package.json` 都 valid JSON；检查根 `package.json` 的 `workspaces` 字段拼写。
- **`s deploy` 报 `Cannot find module '@gd/shared'`**: 多半 materialize 没跑或路径错。手动 `bash scripts/materialize-workspace-deps.sh` 看输出，然后 `ls -lR node_modules/@gd/`。
- **scheduler 测试找不到 mock**: 检查 `packages/scheduler/test/index.test.js` 里 `require.resolve` 字符串是不是 `@gd/shared/src/swas-firewall`（必须和 `packages/scheduler/index.js` 里实际 require 字符串完全一致）。
- **本地 dev 改完源码看不到生效**: 是不是跑过 `s deploy` 之后没 `npm install`？参见 Task 11 Step 12。

---

## Plan 完成后

按 writing-plans skill 的协定，把这份 plan 交付给执行流程。两种方式：

1. **Subagent-Driven（推荐）** —— 用 `superpowers:subagent-driven-development` skill，每个 task 派一个 fresh subagent 实施，task 间留 review checkpoint。适合 baxian 这种 PR 流程：每 task commit 后人工 review 一次。
2. **Inline Execution** —— 用 `superpowers:executing-plans` skill，在当前 session 串行执行所有 task，按 plan 节奏走，必要时 checkpoint。
