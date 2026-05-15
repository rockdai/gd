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
| `s deploy --type code` | FC 上传后 `bootstrap.js` / `index.js` 作为 handler 仍生效（**FC 控制台 handler 配置不动**）|
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
├── config.js                 # shim → packages/scheduler/config
├── bin/ecs-dsec-handler.js   # shim → packages/cli/bin/ecs-dsec-handler.js
├── s.yaml                    # 不变
├── docs/                     # 不变
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
│   │   │   └── handler-swas-open.js
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
│   │       ├── index.test.js
│   │       ├── app/controller/openapi.test.js
│   │       ├── app/middleware/{jwt_auth,password_auth}.test.js
│   │       ├── app/service/aliyun.test.js
│   │       └── lib/{access-token,passkey,passkey-counter-store}.test.js
│   ├── scheduler/            # @gd/scheduler
│   │   ├── package.json
│   │   ├── index.js
│   │   └── config.js
│   └── cli/                  # @gd/cli
│       ├── package.json
│       └── bin/ecs-dsec-handler.js
└── (其他根级文件: .aliyun.conf.example, .gitignore 等保持不动)
```

## 4. lib/ 拆分映射

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

说明: `ip`、`aliyun-conf` 当前只有 web/cli 用，但跨包性质决定它们更适合放 `shared`，避免 web 把 cli 隐式拉进依赖图。`public-ip`、`handler-swas-open` 同理：当前只 cli 用，但作为"对外服务的纯逻辑封装"放 `shared` 更稳，未来 scheduler 或 web 想复用就直接 require。

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
  "dependencies": {
    "@gd/shared": "*",
    "@alicloud/ecs20140526": "6.1.0",
    "@alicloud/swas-open20200601": "4.0.0"
  }
}
```

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

原根 `config.js` 被 scheduler 的 `index.js` 通过 `require('./config')` 引入；迁移后 scheduler 内部 `require('./config')` 直接解析到 `packages/scheduler/config.js`。

根 `config.js` 仍保留为 shim：

```js
'use strict';
module.exports = require('./packages/scheduler/config');
```

理由：兜底外部脚本/CI 可能 `require('./config')` 拿 `RuleConfig`/`DOMAIN`。文件极小，留着零成本。

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

### 7.3 `s.yaml` 与 FC 上传内容

`s.yaml`:
```yaml
gd-web:
  props: { code: ./ }
ecs-dsec:
  props: { code: ./ }
```

`code: ./` 把仓库根整体上传。npm workspaces 模式下根 `node_modules` 已 hoist 所有依赖、且包含 `packages/*` 的 symlink（指向 `../packages/*`）。**风险**: `s` CLI 上传时是否会跟随 symlink？

- 如果跟随：上传内容里 `node_modules/@gd/web` 等被解为实际文件，FC 端 require 正常。
- 如果不跟随：上传后 `node_modules/@gd/*` 是断 symlink，FC 端 require `@gd/shared` 失败。

**对策**：

1. 在实施 plan 里把"`s deploy` 前重新打包"步骤明确化：必要时先 `npm install --omit=dev` 一次确认 `node_modules` 是符号链接还是实体；
2. 加 `.fcignore` / `package.json` 的 `files`/`bundleDependencies` 都不引入；
3. 若 `s` 默认行为是不跟随 symlink，准备 fallback：在 `s.yaml` 的 build hook 里加 `npm install --workspaces=false` 后 `cp -rL`，或干脆把 `@gd/shared` 用 npm pack/portal 写法在部署前展开。

**这一节是已知风险点，需在 implementation plan 的 verification 阶段实际测一次 `s deploy`**（或本地用 `s build` 模拟打包，看产物）才能下结论。spec 不预先选择 fallback 方案。

### 7.4 CLI 的 cwd 行为

`bin/ecs-dsec-handler.js` 当前用 `resolveCredentials({ cwd: __dirname })`。`__dirname` 现在是 `packages/cli/bin`。配合 7.1 的 `findRepoRoot` 改造后，CLI 还是能向上找到带 `workspaces` 的根 `package.json`，定位到根的 `.aliyun.conf`。

如果用户从其他目录跑 `node bin/ecs-dsec-handler.js`（根 shim），shim 立即 require 到 `packages/cli/bin/...`，`__dirname` 同样是 `packages/cli/bin`，行为一致。

如果用户 `cd /tmp && node /path/to/gd/bin/ecs-dsec-handler.js`，行为也一致——`__dirname` 是绝对路径，定位仓库根。

## 8. 测试组织

### 8.1 测试文件迁移映射

| 旧路径 | 新路径 |
|---|---|
| `test/index.test.js` | `packages/web/test/index.test.js` |
| `test/app/controller/openapi.test.js` | `packages/web/test/app/controller/openapi.test.js` |
| `test/app/middleware/jwt_auth.test.js` | `packages/web/test/app/middleware/jwt_auth.test.js` |
| `test/app/middleware/password_auth.test.js` | `packages/web/test/app/middleware/password_auth.test.js` |
| `test/app/service/aliyun.test.js` | `packages/web/test/app/service/aliyun.test.js` |
| `test/lib/access-token.test.js` | `packages/web/test/lib/access-token.test.js` |
| `test/lib/passkey.test.js` | `packages/web/test/lib/passkey.test.js` |
| `test/lib/passkey-counter-store.test.js` | `packages/web/test/lib/passkey-counter-store.test.js` |
| `test/lib/firewall-rule.test.js` | `packages/shared/test/firewall-rule.test.js` |
| `test/lib/swas-firewall.test.js` | `packages/shared/test/swas-firewall.test.js` |
| `test/lib/handler-swas-open.test.js` | `packages/shared/test/handler-swas-open.test.js` |

测试文件内 `require` 路径同步改为新位置（相对路径或 `@gd/*`）。

### 8.2 测试 runner

每个 package `scripts.test = "egg-bin test"`；根 `npm test = npm test -ws --if-present`，遍历所有 workspace。

scheduler 和 cli 当前没有 unit test。它们的 package 不写 `scripts.test`，`-ws --if-present` 自动跳过。

### 8.3 测试中潜在的"跨包内部相对引用"

部分测试今天通过 `require('../../app/service/...')` 触达源码。迁移后改为包内相对 `require('../../app/service/...')`（位置不变即可），或显式 `require('@gd/web/app/service/...')`——后者要求 web package 显式声明自身能被这种路径 require（npm workspaces 默认支持，`@gd/web/<path>` 解析到 `packages/web/<path>`）。

## 9. 部署兼容性 verify 清单

实施完成时必须逐项 ✅：

| # | 验证 | 命令 |
|---|---|---|
| V1 | `npm install` 成功，`node_modules/@gd/*` 是 symlink 指 `packages/*` | `ls -l node_modules/@gd` |
| V2 | 全部测试通过 | `npm test` |
| V3 | web 本地起服 | `npm run dev` 后访问 `http://127.0.0.1:7001` |
| V4 | scheduler handler 可调用 | `node -e "require('./index').handler({},{},console.log)"`（缺凭证应正常报错，而非 module-not-found） |
| V5 | CLI dry-run | `node bin/ecs-dsec-handler.js --help` 及 `--dry-run` |
| V6 | 根 bin shim 可执行 | `chmod +x bin/ecs-dsec-handler.js`，`./bin/ecs-dsec-handler.js --help` |
| V7 | s.yaml 打包后 node_modules 完整 | `s build` 或 `s deploy --dry-run` 看产物（这一步若工具不支持就在测试环境做一次真实部署） |
| V8 | 旧 README 命令示例仍可用 | 按 README 第 49-77 行命令逐条手测 |

## 10. 实施步骤（高层次）

详细步骤进入 implementation plan。这里仅锚定大块：

1. 建包骨架：`packages/{shared,web,scheduler,cli}` + 各 `package.json`。
2. 移动源码：
   - lib/* → 拆 shared + web（按 §4 映射）
   - app/ + config/ + 原 bootstrap → packages/web/
   - 原 index.js + config.js → packages/scheduler/
   - bin/* → packages/cli/bin/
3. 改全部 require 路径：
   - web 内部 `../../lib/<x>` → `@gd/shared/src/<x>` 或 `../../lib/<x>`（web 私有 lib）
   - scheduler 内部 `./lib/<x>` → `@gd/shared/src/<x>`
   - cli 内部 `../lib/<x>` → `@gd/shared/src/<x>`
4. 改 `aliyun-conf.findRepoRoot` 识别 workspaces 根（§7.1）。
5. 写根 shim：`index.js`、`config.js`、`bootstrap.js`、`bin/ecs-dsec-handler.js`（§6）。
6. 更新根 `package.json`：workspaces、scripts、devDependencies（§5.1）。
7. 移动测试 + 调 require（§8.1）。
8. `npm install` → `npm test`。
9. 执行 §9 V1–V8 全清单验证。
10. 更新 README "项目结构" / "快速开始" / "本地开发" 章节，加 passkey counter 迁移 note。

## 11. 不在本次范围

- 不动 FC 控制台函数配置（runtime、内存、handler 名称、触发器）。
- 不引入 TypeScript / 构建工具 / pnpm。
- 不重写 `@gd/shared` 内的算法或 API；模块/导出形状保持不变，仅位置变更。
- 不新增 lint/format 规则。
- 不引入 changesets / 发布流水线（私有包不发布到 npm）。

## 12. 验收标准

- §9 V1–V8 全 ✅。
- 没有任何源码（除 shim 外）继续从根目录的 `lib/` 或 `app/` require。
- `git mv` 保留 history（rename detection 触发）。
- README 与文档反映新结构。
