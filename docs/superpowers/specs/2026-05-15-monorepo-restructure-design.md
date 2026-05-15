# Monorepo 化项目结构改造 —— 设计文档

- 任务: task-018
- 日期: 2026-05-15
- 状态: design approved, pending implementation plan

## 1. 背景与目标

仓库 `gd` 包含三个独立部署单元（FC `gd-web` Egg.js 应用、FC `ecs-dsec` 定时任务、本地 CLI `ecs-dsec-handler`），它们共享 `lib/` 下的纯函数（防火墙规则解析、阿里云凭证、IP 工具等），但目前所有源码摊平在仓库根，包边界靠目录约定。

**改造目标**: 按 monorepo 组织拆出 4 个 workspace，让"哪段代码归哪个产物"显式化，便于后续单包独立演进、独立测试、独立加依赖。

**硬约束（任务描述明文）**: 不得破坏原有功能。具体翻译为：

| 旧用法 | 必须仍然工作 |
|---|---|
| `npm run dev` / `npm run start` | Egg.js 起 web 服务 |
| `s deploy --type code` / `s deploy --function code` | FC 上传后 `bootstrap.js` / `index.js` 作为 handler 仍生效（**FC 控制台 handler 配置不动**）；workspace symlink 实体化在 `s.yaml` 的 `actions.pre-deploy` 钩子里自动完成，无需用户额外步骤（详见 §7.3）|
| `node bin/ecs-dsec-handler.js` (README 范例) | 仍可执行 |
| `node -e "require('./index').handler({},{},console.log)"` | 仍可执行（README 范例） |
| `npx ecs-dsec-handler` | 仍可执行 |
| `npm test` | 全部测试仍跑 |

## 2. 关键决策（已确认）

| # | 决策 | 选项 |
|---|---|---|
| D1 | monorepo 风格 | npm workspaces + 根 shim 转发 FC 入口 |
| D2 | 测试归属 | 跟随代码进入各 package；根 `npm test` = `npm test -ws --if-present` |
| D3 | 包命名 | `@gd/*` 私有 scope，`"private": true` |
| D4 | CLI 入口 | 根 `bin/ecs-dsec-handler.js` 保留为 1 行 shim |

## 3. 目录布局

```
gd/
├── package.json              # workspaces: ["packages/*"]，根 scripts + bin shim
├── bootstrap.js              # shim → packages/web/bootstrap
├── index.js                  # shim → packages/scheduler
├── config.js                 # shim → @gd/shared/src/rule-config
├── bin/ecs-dsec-handler.js   # shim → packages/cli/bin/ecs-dsec-handler.js
├── s.yaml                    # 加 actions.pre-deploy 钩子调用 materialize 脚本（§7.3）
├── docs/                     # 不变
├── scripts/
│   └── materialize-workspace-deps.sh   # 部署前把 node_modules/@gd/* symlink 实体化
├── packages/
│   ├── shared/               # @gd/shared
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.js              # re-export 子模块
│   │   │   ├── firewall-rule.js
│   │   │   ├── swas-firewall.js
│   │   │   ├── ecs-firewall.js
│   │   │   ├── ip.js
│   │   │   ├── aliyun-conf.js
│   │   │   ├── public-ip.js
│   │   │   ├── handler-swas-open.js
│   │   │   └── rule-config.js        # 原根 config.js（DOMAIN + RuleConfig）
│   │   └── test/
│   │       ├── firewall-rule.test.js
│   │       ├── swas-firewall.test.js
│   │       └── handler-swas-open.test.js
│   ├── web/                  # @gd/web
│   │   ├── package.json
│   │   ├── bootstrap.js
│   │   ├── app/{controller,middleware,service,public,router.js}
│   │   ├── config/{config.default.js,plugin.js}
│   │   ├── lib/
│   │   │   ├── access-token.js
│   │   │   ├── passkey.js
│   │   │   └── passkey-counter-store.js
│   │   └── test/
│   │       ├── app/controller/openapi.test.js
│   │       ├── app/middleware/{jwt_auth,password_auth}.test.js
│   │       ├── app/service/aliyun.test.js
│   │       └── lib/{access-token,passkey,passkey-counter-store}.test.js
│   ├── scheduler/            # @gd/scheduler
│   │   ├── package.json
│   │   ├── index.js
│   │   └── test/
│   │       └── index.test.js         # 原根 test/index.test.js（"scheduler rule ownership"）
│   └── cli/                  # @gd/cli
│       ├── package.json
│       └── bin/ecs-dsec-handler.js
└── (其他根级文件: .aliyun.conf.example, .gitignore 等保持不动)
```

## 4. 源码拆分映射

按"谁 require"判定归属：

| 旧路径 | 新路径 | 用方 |
|---|---|---|
| `lib/firewall-rule.js` | `packages/shared/src/firewall-rule.js` | scheduler + web + cli |
| `lib/swas-firewall.js` | `packages/shared/src/swas-firewall.js` | scheduler + web + cli |
| `lib/ecs-firewall.js` | `packages/shared/src/ecs-firewall.js` | scheduler + web |
| `lib/ip.js` | `packages/shared/src/ip.js` | web |
| `lib/aliyun-conf.js` | `packages/shared/src/aliyun-conf.js` | web + cli |
| `lib/public-ip.js` | `packages/shared/src/public-ip.js` | cli |
| `lib/handler-swas-open.js` | `packages/shared/src/handler-swas-open.js` | cli |
| `lib/access-token.js` | `packages/web/lib/access-token.js` | 仅 web |
| `lib/passkey.js` | `packages/web/lib/passkey.js` | 仅 web |
| `lib/passkey-counter-store.js` | `packages/web/lib/passkey-counter-store.js` | 仅 web |
| `config.js` | `packages/shared/src/rule-config.js` | scheduler + cli |

说明: `ip`、`aliyun-conf` 当前只有 web/cli 用，但跨包性质决定它们更适合放 `shared`，避免 web 把 cli 隐式拉进依赖图。`public-ip`、`handler-swas-open` 同理：当前只 cli 用，但作为"对外服务的纯逻辑封装"放 `shared` 更稳，未来 scheduler 或 web 想复用就直接 require。

**`config.js` 归属**: 该文件导出的 `DOMAIN`/`RuleConfig` 是 DDNS 域名→白名单规则的**部署配置数据**，scheduler（FC 定时函数）与 cli（`ecs-dsec-handler`）都把它当 input 读。两者是平级消费者，没有谁是谁的子集，因此放进 `shared` 而不是让 cli 依赖 scheduler。命名改为 `rule-config.js`，避免与 Egg 的 `config/` 概念混淆。

## 5. 包 manifest

### 5.1 根 `package.json`

```jsonc
{
  "name": "gd",
  "version": "1.0.0",
  "private": true,
  "repository": "git@github.com:rockdai/gd.git",
  "workspaces": ["packages/*"],
  "bin": { "ecs-dsec-handler": "bin/ecs-dsec-handler.js" },
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

注: 顶层 `devDependencies` 留 `egg-bin` 是因为 npm workspaces hoist 后，`egg-bin` 在根 `node_modules/.bin/` 可见，各 workspace 的 `egg-bin test` 都能解析到。

**为什么没有 `deploy` 相关 npm script**: workspace symlink 实体化由 `s.yaml` 的 `actions.pre-deploy` 钩子接管（§7.3.4），任何 `s deploy ...` 调用形态都会自动触发，不需要在 npm 层包一遍。保留 README 里"`s deploy --function code --assume-yes`"作为唯一部署入口、与现状一致。

### 5.2 `packages/shared/package.json`

```jsonc
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

**Re-export 风格**: 实际改造时统一走子路径 `require('@gd/shared/src/firewall-rule')`，不通过 barrel `require('@gd/shared')` 拿——这与现在 `require('../../lib/firewall-rule')` 的颗粒度一一对应，diff 最小、含义最清晰。

`src/index.js` 可选地提供 barrel 作为便利出口，但不强求所有调用方改用它：

```js
'use strict';
module.exports = {
  ...require('./firewall-rule'),
  ...require('./ip'),
  // 其他子模块按需补充
};
```

`src/` 命名是为了让"包入口"与"内部源码"语义分开，后面若想换打包/编译方式不影响外部 require 路径。

### 5.3 `packages/web/package.json`

```jsonc
{
  "name": "@gd/web",
  "version": "1.0.0",
  "private": true,
  "egg": { "framework": "egg" },
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

注: `@alicloud/*` 在 `@gd/shared` 已经声明，web 再显式声明是因为 `app/service/aliyun.js` 直接 require 这两个 SDK；显式声明能避免依赖隐式经由 hoist 解析、出现"shared 不再依赖某 SDK 时 web 突然挂"的脆弱关系。

### 5.4 `packages/scheduler/package.json`

```jsonc
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

注: scheduler 有现存回归测试 `test/index.test.js`（"scheduler rule ownership"，mock 阿里云 SDK + `swas-firewall`，断言 `index.js#__private__.handleEcsRuleConfig` / `handleSwasRuleConfig` 不动手工规则、做正确去重等行为）——必须给 scheduler 配 `scripts.test`，否则根 `npm test -ws --if-present` 会跳过这个 package，scheduler 覆盖完全丢失。

### 5.5 `packages/cli/package.json`

```jsonc
{
  "name": "@gd/cli",
  "version": "1.0.0",
  "private": true,
  "bin": { "ecs-dsec-handler": "bin/ecs-dsec-handler.js" },
  "dependencies": {
    "@gd/shared": "*"
  }
}
```

注: CLI 不直接 require `@alicloud/*` SDK——它通过 `@gd/shared/src/handler-swas-open` 间接拿——所以不显式列，避免重复声明带来的版本漂移风险。

## 6. 入口 shim

### 6.1 根 `index.js`（FC scheduler handler）

```js
'use strict';
module.exports = require('./packages/scheduler');
```

`packages/scheduler/index.js` 即原根 `index.js`，`exports.handler` 不变；FC 控制台 handler 设为 `index.handler`（与今天相同）依然命中。

### 6.2 根 `config.js`

原根 `config.js`（`DOMAIN` + `RuleConfig`）被两个 package 当 input 读：

- scheduler `index.js`: `require('./config')`（FC 定时任务）
- cli `bin/ecs-dsec-handler.js`: `require('../config')`（CLI 工具，line 52: `const { RuleConfig } = require('../config');`）

迁移目标位置：`packages/shared/src/rule-config.js`。scheduler 与 cli 都改为 `require('@gd/shared/src/rule-config')`。

根 `config.js` 仍保留为 shim，兜底外部脚本/CI 直接 `require('./config')` 的旧用法：

```js
'use strict';
module.exports = require('@gd/shared/src/rule-config');
```

文件极小，留着零成本。**重要**: shim 通过 `@gd/shared` 解析依赖 `node_modules/@gd/shared`，因此根目录的 `npm install` 必须先跑——否则 shim 自身 require 失败。CI 工作流已有 `npm install` 步骤，本地用户使用 shim 的前提也是已经装好依赖。

### 6.3 根 `bootstrap.js`（FC web 入口）

```js
'use strict';
require('./packages/web/bootstrap');
```

`packages/web/bootstrap.js` 内容与原根 `bootstrap.js` 完全一致：

```js
'use strict';
const egg = require('egg');
egg.startCluster({
  baseDir: __dirname,
  port: process.env.PORT || 9000,
  workers: 1,
});
```

`baseDir: __dirname` ≡ `packages/web`，Egg.js 按约定在 `packages/web/app` / `packages/web/config` 加载 controller / service / config，符合 egg framework 默认查找。

### 6.4 根 `bin/ecs-dsec-handler.js`

```js
#!/usr/bin/env node
'use strict';
require('../packages/cli/bin/ecs-dsec-handler');
```

文件需保留可执行位（`chmod +x`）。根 `package.json` `bin` 字段指向它，`npm install` 后会建 symlink。

## 7. 运行时路径与配置兼容

### 7.1 `aliyun-conf.findRepoRoot` 改造

现状（`lib/aliyun-conf.js`）：

```js
function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) return dir;        // 撞到第一个 package.json 就返回
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
```

monorepo 化后 CLI 从 `packages/cli/bin/` 调用，向上撞到的第一个 `package.json` 是 `packages/cli/package.json`——不会读到仓库根的 `.aliyun.conf`。

**修复**：改"找到 *最顶层* 含 `workspaces` 字段或父目录已无 package.json 的那个 `package.json`"，即继续向上直到 `package.json` 含 `"workspaces"` 字段（识别 monorepo 根）：

```js
function findRepoRoot(startDir) {
  let dir = startDir;
  let lastPkgDir = null;
  while (true) {
    const p = path.join(dir, 'package.json');
    if (fs.existsSync(p)) {
      lastPkgDir = dir;
      try {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (pkg && pkg.workspaces) return dir;   // monorepo 根
      } catch (_) { /* ignore unreadable / malformed */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return lastPkgDir || startDir;
    dir = parent;
  }
}
```

向后兼容：单包仓库（无 `workspaces` 字段）行为不变——返回最顶层的有 package.json 的目录。

### 7.2 `passkey.counterStoreFile` 默认路径

`config/config.default.js`：
```js
counterStoreFile: process.env.PASSKEY_COUNTERS_FILE ||
  path.join(appInfo.baseDir, 'run', 'passkey-counters.json')
```

`appInfo.baseDir` 现在等于 `packages/web`，所以默认路径变为 `packages/web/run/passkey-counters.json`（之前是 `<repo>/run/passkey-counters.json`）。

**对线上影响**: FC 部署后 `/code` 目录是只读 + 临时，counter 文件本来就只在跑实例的内存有效，重启会丢；线上注入 `PASSKEY_COUNTERS_FILE` 指向 NAS 才真持久。所以默认路径变化不影响 FC 生产。

**对本地影响**: 若本地有遗留 `run/passkey-counters.json`，README 加一句迁移说明：把它 mv 到 `packages/web/run/passkey-counters.json`，或显式设 `PASSKEY_COUNTERS_FILE`。

不改 `config.default.js` 计算逻辑，**仅在 README 加 migration note**。

### 7.3 FC 部署兼容：workspace 依赖实体化

#### 7.3.1 问题陈述

`s.yaml`:
```yaml
gd-web:    { props: { code: ./ } }
ecs-dsec:  { props: { code: ./ } }
```

`code: ./` 把仓库根整体上传到 FC。npm workspaces 安装后，`node_modules/@gd/{shared,web,scheduler,cli}` 是 **symlink**（指向 `../../packages/<name>`，相对路径）。两条相关事实：

1. **`s` CLI 打包行为不能假设**: 是否跟随 symlink、是否把相对 symlink 重写、是否原样上传 link 节点——版本/平台差异大，不能作为设计前提。
2. **即使 symlink 原样上传**: 上传内容也同时包含 `packages/*` 实体目录，Node.js 端 `require('@gd/shared')` 从 `node_modules/@gd/shared`（link）→ `../../packages/shared`（target）能解析；但**前提是 link 的相对路径在 FC 上仍指向同一文件树**——这隐含假设 `s` 不会把 symlink 重写成绝对路径。

硬约束"`s deploy --function code` 后 FC handler 仍生效"不能依赖这些未验证假设。

#### 7.3.2 设计决策：实体化 (materialize) workspace symlink，由 `s.yaml` 钩子触发

把 `node_modules/@gd/*` 的 symlink 显式替换为目标目录的**实体副本**。上传内容里就不再有 symlink，`require('@gd/shared')` 在 FC 上像普通 npm 包一样从 `node_modules/@gd/shared/` 实体目录解析。

**集成点 = `s.yaml` 的 `actions.pre-deploy` 钩子**（详见 §7.3.4）：用户/CI 直接跑 `s deploy --type code` / `s deploy --function code --assume-yes` 即可，`s` CLI 自动在打包前执行实体化脚本。这样 §1 硬约束表里"`s deploy --type code` 必须仍然工作"是字面满足的——用户的命令行不需要任何改动。

这是确定性方案：完全规避 `s` 打包对 symlink 的处理细节、`tar`/`zip` 链接节点编码、Node.js symlink 跟随等所有未知行为。

#### 7.3.3 脚本: `scripts/materialize-workspace-deps.sh`

**核心语义**: 以 `packages/*` 为权威源，**每次运行都重新刷一份**到 `node_modules/@gd/*`。不观察 `node_modules` 现在是 symlink 还是实体——直接 `rm -rf` 再 `cp -R`。

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

**为什么不再"观察 symlink"**: 上一版脚本只在 `node_modules/@gd/<name>` 是 symlink 时才动手。这会产生一个常见失败路径：本地第一次 `s deploy` 后 `node_modules/@gd/shared` 已是实体副本；之后改 `packages/shared/src/...` 源码，再 `s deploy`，pre-deploy 钩子见到不是 symlink 就跳过，上传的仍是旧副本。所以脚本必须以 `packages/*` 为权威，**每次都重写**。

**为什么用 `node -p` 读 `package.json.name`**: 包名（如 `@gd/shared`）才是 `require('@gd/shared')` 解析的唯一依据。靠目录名约定容易在重命名 / 加非 `@gd/*` 包时静默错配。

**为什么是 `cp -R` 而非 `cp -RL`**: `cp -RL` 会展开 `packages/<name>/` 里所有嵌套 symlink；我们要的只是顶层 `node_modules/@gd/<name>` 从 link/旧副本变成与 `packages/<name>/` 内容一致的实体，里面本身没有 symlink，普通 `cp -R` 即可。

**幂等性的正确含义**: "同样的 `packages/*` 源 → 同样的 `node_modules/@gd/*` 内容"。不是"二次运行 count=0"。脚本每次都做完整刷新；同一 deploy 内被两个 resource 钩子调用两次也只是相同工作做两次，开销可忽略。

**多次运行的副作用**: 每次都 `rm -rf` + `cp -R`，I/O 量 = 所有 `@gd/*` 包文件大小之和。当前 4 个包都是源码级 npm package，无 build 产物，总量小（KB-MB 级），可忽略。

#### 7.3.4 集成：`s.yaml` 的 `actions.pre-deploy` 钩子

Serverless Devs v3（`edition: 3.0.0`）支持资源级 `actions.pre-deploy`，在 `s deploy` 打包/上传**之前**执行任意 shell 命令。把 materialize 挂在这里，任何形态的 `s deploy ...` 调用（CI、本地、`--type code`、`--function code`、`--function-name` 子集部署）都会先实体化，无需 wrapper。

现状 `s.yaml`:
```yaml
edition: 3.0.0
name: gd-whitelist
access: "default"

vars:
  region: cn-hangzhou

resources:
  gd-web:
    component: fc3
    props: { region: ${vars.region}, functionName: gd-web, code: ./ }
  ecs-dsec:
    component: fc3
    props: { region: ${vars.region}, functionName: ecs-dsec, code: ./ }
```

改造为：

```yaml
edition: 3.0.0
name: gd-whitelist
access: "default"

vars:
  region: cn-hangzhou

resources:
  gd-web:
    component: fc3
    actions:
      pre-deploy:
        - run: bash scripts/materialize-workspace-deps.sh
          path: ./
    props: { region: ${vars.region}, functionName: gd-web, code: ./ }
  ecs-dsec:
    component: fc3
    actions:
      pre-deploy:
        - run: bash scripts/materialize-workspace-deps.sh
          path: ./
    props: { region: ${vars.region}, functionName: ecs-dsec, code: ./ }
```

要点：

- **per-resource 重复声明**: Serverless Devs v3 的 `actions` 是资源级字段；同一个钩子要分别挂到 `gd-web` 与 `ecs-dsec` 下。`s deploy --function code` 一次部署两个函数时两条钩子都会跑——脚本以 `packages/*` 为权威每次都完整刷新（§7.3.3），等于把同一份工作做了两遍，单次开销很小（仅 KB-MB 级的 `cp -R`），可忽略。
- **`path: ./`**: 命令在仓库根执行，与 `scripts/materialize-workspace-deps.sh` 的根目录依赖一致。
- **CI workflow 不变**: `.github/workflows/fc-deploy.yaml` 维持现有 `s deploy --function code --assume-yes`；钩子在 `s` CLI 内部接管。
- **本地 README 不变**: README "部署到函数计算 FC" 一节展示的 `s deploy --type code` 维持原样，仅在文字里补一句"`s.yaml` 已包含 pre-deploy 钩子，会自动实体化 workspace 依赖到 `node_modules/@gd/*`，无需手动处理"。

**为什么不在 npm 层另开 `deploy:fc:code` 脚本**: 多一条入口反而增加用户认知负担、且与硬约束"旧 `s deploy --type code` 必须工作"间产生分歧（用户走旧命令时容易绕过 wrapper）。`s.yaml` 钩子是单一真相源，任何 `s deploy` 调用都安全。

#### 7.3.5 已知副作用与权衡

- **部署链路上无副作用**: 每次 `s deploy` 都把 `packages/*` 最新内容刷进 `node_modules/@gd/*`，上传的代码包永远反映当前源码状态。第 3 轮 review 指出的"二次部署上传旧副本"问题被这一语义直接消除。
- **本地开发副作用**: 一次 `s deploy` 之后，`node_modules/@gd/*` 从 npm workspaces 建的 symlink 变成静态实体副本。此后再编辑 `packages/shared/src/...` 源码，`npm test` / `npm run dev` 这种走 `require('@gd/shared')` 解析的进程会从**旧的静态副本**读源码，改动不可见。**对策**：README 注明"本地跑过 `s deploy` 后想恢复实时联动，重新 `npm install` 即可"——`npm install` 会重建 `node_modules/@gd/*` 为 symlink 指回 `packages/*`。CI 上是临时容器，无此影响。
- **可选改进**: 若日后觉得本地"deploy 后必须 `npm install`"太烦，可把 `s.yaml` 钩子改为复制到独立的 `dist/` 目录、把 `code: ./` 改为 `code: ./dist`，不动 `node_modules/`。本轮 spec 不引入这个变形，以维持 `code: ./` 现状最小化 `s.yaml` 变更面。

### 7.4 CLI 的 cwd 行为

`bin/ecs-dsec-handler.js` 当前用 `resolveCredentials({ cwd: __dirname })`。`__dirname` 现在是 `packages/cli/bin`。配合 7.1 的 `findRepoRoot` 改造后，CLI 还是能向上找到带 `workspaces` 的根 `package.json`，定位到根的 `.aliyun.conf`。

如果用户从其他目录跑 `node bin/ecs-dsec-handler.js`（根 shim），shim 立即 require 到 `packages/cli/bin/...`，`__dirname` 同样是 `packages/cli/bin`，行为一致。

如果用户 `cd /tmp && node /path/to/gd/bin/ecs-dsec-handler.js`，行为也一致——`__dirname` 是绝对路径，定位仓库根。

## 8. 测试组织

### 8.1 测试文件迁移映射

| 旧路径 | 新路径 | 说明 |
|---|---|---|
| `test/index.test.js` | `packages/scheduler/test/index.test.js` | scheduler 回归测试，mock `@alicloud/*` + `swas-firewall`，断言 `handleEcsRuleConfig` / `handleSwasRuleConfig` 行为 |
| `test/app/controller/openapi.test.js` | `packages/web/test/app/controller/openapi.test.js` | |
| `test/app/middleware/jwt_auth.test.js` | `packages/web/test/app/middleware/jwt_auth.test.js` | |
| `test/app/middleware/password_auth.test.js` | `packages/web/test/app/middleware/password_auth.test.js` | |
| `test/app/service/aliyun.test.js` | `packages/web/test/app/service/aliyun.test.js` | |
| `test/lib/access-token.test.js` | `packages/web/test/lib/access-token.test.js` | |
| `test/lib/passkey.test.js` | `packages/web/test/lib/passkey.test.js` | |
| `test/lib/passkey-counter-store.test.js` | `packages/web/test/lib/passkey-counter-store.test.js` | |
| `test/lib/firewall-rule.test.js` | `packages/shared/test/firewall-rule.test.js` | |
| `test/lib/swas-firewall.test.js` | `packages/shared/test/swas-firewall.test.js` | |
| `test/lib/handler-swas-open.test.js` | `packages/shared/test/handler-swas-open.test.js` | |

测试文件内 `require` 路径同步改为新位置：

- **scheduler `test/index.test.js`** 用 `require.resolve('../lib/firewall-rule')`、`require.resolve('../lib/swas-firewall')` 做 `require.cache` 投毒。迁移后 scheduler `index.js` 改成 require `@gd/shared/src/firewall-rule` 与 `@gd/shared/src/swas-firewall`，测试的 `require.resolve` 路径必须同步改成 `@gd/shared/src/firewall-rule`、`@gd/shared/src/swas-firewall`——否则 mock 不会命中 `index.js` 实际 require 的那个模块，所有 mock 测试静默失效。
- web 测试内 `require('../../app/...')` 改成 `require('../../app/...')`（相对位置一致，无需变化）；对应 `lib/*` 测试中的 `require('../../lib/access-token')` 等也保持相对路径。
- shared 测试内 `require('../../lib/firewall-rule')` 等改为相对路径 `require('../src/firewall-rule')`。

### 8.2 测试 runner

| Package | `scripts.test` | 跑哪些 |
|---|---|---|
| `@gd/shared` | `egg-bin test` | firewall-rule、swas-firewall、handler-swas-open |
| `@gd/web` | `egg-bin test` | 全部 web 单测 + Egg 集成测试 |
| `@gd/scheduler` | `egg-bin test` | `test/index.test.js` |
| `@gd/cli` | （无 test 脚本） | 暂无 |

根 `npm test = npm test -ws --if-present` 自动跳过 cli。**`@gd/scheduler` 必须显式声明 `scripts.test`**，否则 scheduler 回归覆盖完全消失。

### 8.3 测试中潜在的"跨包内部相对引用"

部分测试今天通过 `require('../../app/service/...')` 触达源码。迁移后改为包内相对 `require('../../app/service/...')`（位置不变即可），或显式 `require('@gd/web/app/service/...')`——后者要求 web package 显式声明自身能被这种路径 require（npm workspaces 默认支持，`@gd/web/<path>` 解析到 `packages/web/<path>`）。

## 9. 部署兼容性 verify 清单

实施完成时必须逐项 ✅：

| # | 验证 | 命令 |
|---|---|---|
| V1 | `npm install` 成功，`node_modules/@gd/*` 是 symlink 指 `packages/*` | `ls -l node_modules/@gd` |
| V2 | 全部测试通过，且 scheduler 测试**真的跑了** | `npm test` 输出包含 `@gd/scheduler` 的 `scheduler rule ownership` describe 块 |
| V3 | web 本地起服 | `npm run dev` 后访问 `http://127.0.0.1:7001` |
| V4 | scheduler handler 可调用 | `node -e "require('./index').handler({},{},console.log)"`（缺凭证应正常报错，而非 module-not-found） |
| V5 | CLI dry-run | `node bin/ecs-dsec-handler.js --help` 及 `--dry-run` |
| V6 | 根 bin shim 可执行 | `chmod +x bin/ecs-dsec-handler.js`，`./bin/ecs-dsec-handler.js --help` |
| V7 | CLI 读到 `RuleConfig` | CLI 在 `--dry-run` 下打印它扫描的 `swas-open` 配置项数量，与 `packages/shared/src/rule-config.js` 中 `RuleConfig.filter(c=>c.product==='swas-open').length` 一致 |
| V8 | `npx ecs-dsec-handler` 入口正常 | `npm install` 后 `npx ecs-dsec-handler --help` |
| V9 | 实体化脚本可独立跑 | `npm install && bash scripts/materialize-workspace-deps.sh`，再 `ls -l node_modules/@gd` 全部不是 symlink |
| V10 | 实体化后 require 仍可解析 | 实体化后跑 `node -e "console.log(require('@gd/shared/src/firewall-rule').PORT_RANGE)"` 输出 `1/65535` |
| V11 | 脚本每次都以源为权威刷新 | `bash scripts/materialize-workspace-deps.sh` → 编辑 `packages/shared/src/__verify__.txt` 写入 `v2` → 再跑一次 → 断言 `grep -q v2 node_modules/@gd/shared/src/__verify__.txt`；最后 `rm packages/shared/src/__verify__.txt`、再跑一次、断言该文件不再出现在 node_modules 副本下（确认删除也同步） |
| V12 | `s.yaml` 钩子自动触发实体化 | 测试环境跑 `npm install --production && s deploy --function code --assume-yes`，FC 端启动无 `Cannot find module '@gd/shared'`；脚本输出中能看到 `[materialize] ... <= ...` 行 |
| V13 | 旧 README 命令示例仍可用 | 按 README 第 49-77 行命令逐条手测（包含 `s deploy --type code` 直接调用） |

## 10. 实施步骤（高层次）

详细步骤进入 implementation plan。这里仅锚定大块：

1. 建包骨架：`packages/{shared,web,scheduler,cli}` + 各 `package.json`。
2. 移动源码（用 `git mv` 保 history）：
   - `lib/*` → 拆 `@gd/shared/src/*` + `@gd/web/lib/*`（按 §4 映射）
   - 根 `config.js` → `packages/shared/src/rule-config.js`
   - `app/` + `config/` + 根 `bootstrap.js` → `packages/web/`
   - 根 `index.js` → `packages/scheduler/index.js`
   - `bin/*` → `packages/cli/bin/`
3. 改全部 require 路径：
   - web 内部 `../../lib/{firewall-rule,swas-firewall,ecs-firewall,ip,aliyun-conf}` → `@gd/shared/src/<x>`
   - web 内部 `../../lib/{access-token,passkey,passkey-counter-store}` → 包内相对（位置在 `packages/web/lib/`，相对路径保持 `../../lib/<x>`）
   - scheduler `index.js` 的 `./lib/<x>` → `@gd/shared/src/<x>`
   - scheduler `index.js` 的 `./config` → `@gd/shared/src/rule-config`
   - cli `bin/ecs-dsec-handler.js` 的 `../lib/<x>` → `@gd/shared/src/<x>`
   - cli `bin/ecs-dsec-handler.js` 的 `../config` → `@gd/shared/src/rule-config`
4. 改 `aliyun-conf.findRepoRoot` 识别 workspaces 根（§7.1）。
5. 写根 shim：`index.js`、`config.js`、`bootstrap.js`、`bin/ecs-dsec-handler.js`（§6）。
6. 更新根 `package.json`：workspaces、scripts、devDependencies（§5.1）。
7. 移动测试 + 调 require（§8.1）：
   - **scheduler 测试**: `test/index.test.js` → `packages/scheduler/test/index.test.js`，把 `require.resolve('../lib/swas-firewall')` 改成 `require.resolve('@gd/shared/src/swas-firewall')`，并给 `@gd/scheduler` 加 `scripts.test`（§5.4）。
   - 其它测试按 §8.1 映射移动 + 调 require。
8. 新建 `scripts/materialize-workspace-deps.sh` 并 `chmod +x`（§7.3.3）。
9. 改造 `s.yaml`：给 `gd-web` 和 `ecs-dsec` 两个 resource 各加 `actions.pre-deploy` 钩子调用实体化脚本（§7.3.4）。CI workflow `.github/workflows/fc-deploy.yaml` 不需要改动。
10. `npm install` → `npm test` 全绿。
11. 执行 §9 V1–V13 全清单验证；特别是 V12 在测试环境实跑一次 FC 部署。
12. 更新 README "项目结构" / "快速开始" / "本地开发" / "部署" 章节，加：
    - monorepo 概述 + 包列表
    - passkey counter 路径迁移 note
    - 部署命令不变（`s deploy --type code` / `s deploy --function code`），但 `s.yaml` 已挂 pre-deploy 钩子自动实体化 workspace 依赖
    - 实体化对本地开发的副作用（运行 `s deploy` 后 `node_modules/@gd/*` 从 symlink 变成实体副本，源码改动不再实时可见；想恢复重新 `npm install` 即可）

## 11. 不在本次范围

- 不动 FC 控制台函数配置（runtime、内存、handler 名称、触发器）。
- 不引入 TypeScript / 构建工具 / pnpm。
- 不重写 `@gd/shared` 内的算法或 API；模块/导出形状保持不变，仅位置变更。
- 不新增 lint/format 规则。
- 不引入 changesets / 发布流水线（私有包不发布到 npm）。

## 12. 验收标准

- §9 V1–V13 全 ✅（包含 RuleConfig 加载、scheduler 测试运行、实体化脚本、`s.yaml` 钩子真实部署）。
- 没有任何源码（除 shim 外）继续从根目录的 `lib/` 或 `app/` require。
- `git mv` 保留 history（rename detection 触发）。
- README 与文档反映新结构。
- `s.yaml` 含 `actions.pre-deploy` 钩子，直接 `s deploy --type code` 也能跑通。
