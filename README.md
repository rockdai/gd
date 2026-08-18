# GD - 阿里云白名单管理

阿里云 **ECS / 轻量应用服务器** 防火墙白名单管理工具。

## 功能

### 1) Web 服务（PWA）

基于 [Egg.js](https://eggjs.org/) 的 Progressive Web App，提供可视化界面：

- 前端直接调用 `get-ip.rockdai.com` 获取当前设备公网 IP（客户端侧获取真实 IP）
- 一键将当前公网 IP 添加到用户机器白名单
- 支持添加指定 IP 到机器白名单
- 基于 AK/SK 自动拉取用户的阿里云 ECS 和轻量应用服务器列表
- 支持勾选指定机器进行白名单配置

### 2) 后台定时服务

保留原有的 FC 定时触发服务（`index.js`），用于定期根据 DDNS 域名解析结果更新机器白名单。

### 3) 命令行工具

`ecs-dsec-handler`：获取当前设备公网 IP，为每台实例创建/维护防火墙规则。

每个模块只认自己前缀的规则，互不认领、互不删除，也不会碰用户手工维护的规则：

| 模块 | 前缀 | 清理范围 |
|------|------|----------|
| 定时任务 | `gd-ddns:` | 同名规则中的重复项 |
| Web | `gd-web` | 超过 24 小时的过期规则 |
| CLI | `gd-cli:` | 只修改，不清理 |
| Docker 同步 | `gd-job:<label>` | 自己 label 名下、源 IP 已不是当前公网 IP 的规则 |

### 4) Docker 定时同步（NAS / Homelab）

`@gd/job`：部署在自己的 NAS / Homelab 上常驻运行，定时获取当前家庭网络的公网 IP，
自动同步到阿里云 ECS / 轻量应用服务器白名单，并清理自己留下的旧 IP 规则。

## 快速开始

### 凭证配置

支持两种方式提供阿里云 AK/SK：

**A) 环境变量（推荐用于 FC 部署）：**

- `ACCESS_KEY_ID`
- `ACCESS_KEY_SECRET`

**B) 本地配置文件（推荐用于本地开发）：**

```bash
cp .aliyun.conf.example .aliyun.conf
# 编辑 .aliyun.conf 填入 ACCESS_KEY_ID / ACCESS_KEY_SECRET
```

> 建议使用**最小权限**的 RAM 子账号/角色。

### 本地开发（Web 服务）

```bash
npm i
npm run dev
# 访问 http://127.0.0.1:7001
```

> 这是 npm workspaces monorepo：`npm i` 会安装所有 `packages/*` 的依赖并把它们建成 `node_modules/@gd/*` 的 symlink。
> `npm run dev` / `npm run start` / `npm test` 在根目录均可直接用——根 `package.json` 把它们转发到对应 workspace。
> 若只跑某一包的测试：`npm test -w @gd/shared`、`npm test -w @gd/web`、`npm test -w @gd/scheduler`。

> 生产域名固定为 `https://gd.rockdai.com`，Passkey 默认也按这个域名配置。`http://127.0.0.1:7001` 只适合普通密码登录开发，不适合直接做 Passkey 真机联调。

### 命令行工具

```bash
npm i

# 使用配置文件
node bin/ecs-dsec-handler.js

# 使用环境变量
ACCESS_KEY_ID=xxx ACCESS_KEY_SECRET=yyy node bin/ecs-dsec-handler.js

# 指定 IP / dry-run
node bin/ecs-dsec-handler.js --ip 1.2.3.4
node bin/ecs-dsec-handler.js --dry-run
```

### 本地调试（定时任务 handler）

```bash
ACCESS_KEY_ID=xxx ACCESS_KEY_SECRET=yyy node -e "require('./index').handler({}, {}, console.log)"
```

## 部署到函数计算 FC

项目通过 [Serverless Devs](https://github.com/Serverless-Devs/Serverless-Devs) 部署到阿里云函数计算，配置见 `s.yaml`。

包含两个函数：

| 函数 | 说明 | 触发方式 |
|------|------|----------|
| `gd-web` | Egg.js Web 服务（PWA） | HTTP 触发器 |
| `ecs-dsec` | 定时更新白名单（原 index.js） | 定时触发器（每 5 分钟） |

> 函数配置（runtime、内存、超时、触发器等）在阿里云控制台管理，`s.yaml` 仅用于部署代码。

```bash
# 安装 Serverless Devs
npm install -g @serverless-devs/s

# 部署（仅更新代码，不更新函数配置）
s deploy --type code
```

> `s.yaml` 已包含 `actions.pre-deploy` 钩子，会在打包前自动跑 `scripts/materialize-workspace-deps.sh`——把 `node_modules/@gd/*` 的 workspace symlink 替换为实体副本，确保 FC 端 require `@gd/shared` 正常解析。
> **本地副作用提醒**：跑过 `s deploy` 后 `node_modules/@gd/*` 会从 symlink 变成静态副本；想恢复 symlink（让本地源码修改实时可见）重新跑一次 `npm install` 即可。

环境变量需在 FC 控制台配置 `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`。

## Docker 部署（NAS / Homelab）

```bash
cd packages/job
cp docker-compose.example.yml docker-compose.yml
# 编辑 docker-compose.yml 填入 AK/SK 和地域
docker compose up -d
docker compose logs -f gd-job
```

compose 不是必需的，直接用 docker 也一样（compose 只是把 build、run、自动重启、日志轮转写在一个文件里）：

```bash
docker build -f packages/job/Dockerfile -t gd-job .
docker run -d --name gd-job --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -e ACCESS_KEY_ID=xxx -e ACCESS_KEY_SECRET=yyy \
  -e TZ=Asia/Shanghai -e REGIONS=cn-hangzhou,cn-hongkong \
  -e RULE_LABEL=home \
  gd-job
docker logs -f gd-job
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ACCESS_KEY_ID` | — | 必填，阿里云 AK |
| `ACCESS_KEY_SECRET` | — | 必填，阿里云 SK |
| `MACHINE_ALLOW` | 空 | 只操作这些机器，逗号分隔，填实例 ID 或实例名皆可 |
| `MACHINE_DENY` | 空 | 不操作这些机器；与 `MACHINE_ALLOW` 都为空时处理所有机器 |
| `SYNC_INTERVAL` | `5m` | 同步间隔，接受 `5m` / `30s` / 纯秒数 |
| `REGIONS` | 十个常用地域 | 扫描地域，逗号分隔。每个地域每轮 2 次 API 调用，建议只填有机器的地域 |
| `RULE_LABEL` | `default` | 写进规则备注。多站点部署时必须各不相同，否则两边会互删对方的规则 |
| `IP_ENDPOINT` | `https://get-ip.rockdai.com` | 公网 IP 获取地址 |
| `TZ` | 容器默认 UTC | 建议设为 `Asia/Shanghai`，否则规则备注时间差 8 小时 |

名单里写的机器如果不存在（已释放、不在配置的地域、名字写错），跳过并记一行日志，不影响其他机器。

每轮都会完整检查一遍：规则已经存在就不重复创建（不产生写操作），缺了就补，旧 IP 的规则就清。所以新建的机器、在控制台手动删掉的规则、被其他模块的规则临时覆盖的 IP，都会在下一轮（默认 5 分钟内）自动修好，不需要重启容器。

日志：每轮一行摘要（`1.2.3.4 → 3 machine(s): 0 added, 0 removed, 0 failed`），只有真的写了规则或出错时才打印机器级细节。compose 示例里已配置日志轮转。

## 认证方式

Web 端默认使用密码登录：

- `PASSWORD`：访问密码
- `JWT_SECRET`：JWT 签名密钥，建议显式配置，避免函数重启后令牌失效

在此基础上，你还可以额外启用 Face ID / Passkey。它是附加登录方式，不会替代或关闭默认密码登录。

### OpenAPI 鉴权

`/openapi/*` 路由用 `Authorization: Bearer <PASSWORD>` 直接鉴权，不走 JWT。同 IP 1 分钟内 5 次错误密码会被限流到 429。示例：

```bash
curl -X POST https://gd.rockdai.com/openapi/whitelist \
  -H "Authorization: Bearer $PASSWORD" \
  -d ip=1.2.3.4 -d product=swas-open -d instanceId=i-xxx -d regionId=cn-hangzhou
```

### Face ID / Passkey

Passkey 采用**单用户 allowlist** 模型：

- 公开页面只允许使用已经批准过的 credential 登录
- 新设备绑定必须先在已登录态下发起
- 绑定完成后，页面会返回一段新的 `PASSKEY_CREDENTIALS_JSON`
- 把这段 JSON 写回环境变量并重启服务后，新设备才真正获准登录

相关环境变量：

- `PASSKEY_ENABLED`：是否启用 passkey 能力，默认 `true`
- `PASSKEY_RP_NAME`：显示给系统弹窗的站点名称，默认 `GD`
- `PASSKEY_RP_ID`：WebAuthn RP ID，默认 `gd.rockdai.com`
- `PASSKEY_ORIGIN`：完整来源，默认 `https://gd.rockdai.com`
- `PASSKEY_USER_NAME`：单用户逻辑用户名，默认 `admin`
- `PASSKEY_USER_DISPLAY_NAME`：单用户显示名，默认 `GD Admin`
- `PASSKEY_USER_ID`：单用户稳定 ID，默认 `gd-admin`
- `PASSKEY_CREDENTIALS_JSON`：已批准 passkey allowlist，默认 `[]`
- `PASSKEY_ENROLLMENT_ENABLED`：是否允许已登录用户继续绑定新设备，默认 `true`
- `PASSKEY_CHALLENGE_TTL_SEC`：passkey 挑战票据有效期，默认 `300`
- `PASSKEY_FLOW_TOKEN_SECRET`：passkey challenge token 专用签名密钥；默认由 `JWT_SECRET` 派生
- `PASSKEY_COUNTERS_FILE`：服务端持久化 passkey counter 的文件路径，默认 `packages/web/run/passkey-counters.json`（旧版默认是 `run/passkey-counters.json`，monorepo 化后 `appInfo.baseDir` 变成 `packages/web/`——本地有遗留计数器文件可以手工 mv 或显式设环境变量）

示例：

```bash
PASSWORD='your-password'
JWT_SECRET='replace-me'
PASSKEY_RP_ID='gd.rockdai.com'
PASSKEY_ORIGIN='https://gd.rockdai.com'
PASSKEY_CREDENTIALS_JSON='[]'
```

## 项目结构

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
│   ├── job/                # @gd/job —— Docker 定时同步（NAS / Homelab）
│   │   ├── src/{config,machines,sync}.js
│   │   ├── bin/gd-job.js
│   │   ├── Dockerfile
│   │   └── docker-compose.example.yml
│   └── cli/                # @gd/cli —— ecs-dsec-handler 命令行
│       └── bin/ecs-dsec-handler.js
└── docs/                   # 设计文档（含 spec / plan）
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | PWA 首页 |
| GET | `/api/auth/status` | 获取当前认证方式状态 |
| POST | `/api/login` | 使用密码登录，返回 JWT |
| POST | `/api/passkey/auth/options` | 获取 Face ID / Passkey 登录 challenge |
| POST | `/api/passkey/auth/verify` | 验证 Face ID / Passkey 登录并返回 JWT |
| POST | `/api/passkey/register/options` | 在已登录态下获取当前设备绑定 challenge |
| POST | `/api/passkey/register/verify` | 在已登录态下验证绑定并返回新的 allowlist JSON |
| GET | `/api/machines` | 获取用户所有机器列表（ECS + 轻量服务器） |
| POST | `/api/whitelist` | 添加 IP 到指定机器白名单 |
| POST | `/openapi/whitelist` | 创建一条白名单规则（OpenAPI，header 鉴权，单机器） |

> 公网 IP 获取由前端直接调用 `https://get-ip.rockdai.com`，确保拿到客户端的真实 IP。

### POST /api/whitelist

```json
{
  "ip": "1.2.3.4",
  "machines": [
    {
      "product": "swas-open",
      "instanceId": "xxx",
      "regionId": "cn-hangzhou"
    },
    {
      "product": "ecs",
      "instanceId": "xxx",
      "regionId": "cn-hangzhou",
      "securityGroupId": "sg-xxx"
    }
  ]
}
```

## 配置

### Egg.js 配置（`config/config.default.js`）

- `aliyun.accessKeyId` / `aliyun.accessKeySecret`：阿里云凭证（默认读取环境变量）
- `aliyun.regions`：扫描机器列表时覆盖的地域

### 定时任务配置（`config.js`）

- `DOMAIN`：需要解析的 DDNS 域名列表
- `RuleConfig`：需要更新的规则列表
- `RuleConfig[].ruleList[].id` / `ids`：仅用于定位已由定时任务创建、且 remark 以 `gd-ddns:` 开头的规则；`gd-web`、`gd-cli` 或手工维护规则即使 ID 填在这里也不会被定时任务认领

## 开发/协作约定

- **对该 GitHub 仓库的任何改动都请走 PR**：新建分支 → push 分支 → 提 PR → 评审合并
- 不要直接 push 到 `main`

## License

MIT
