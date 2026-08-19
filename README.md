# GD (Gateway Guard)

[![CI](https://github.com/rockdai/gd/actions/workflows/ci.yaml/badge.svg)](https://github.com/rockdai/gd/actions/workflows/ci.yaml)
[![Docker](https://img.shields.io/docker/v/rockdai/gd/latest?label=docker&logo=docker)](https://hub.docker.com/r/rockdai/gd)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

阿里云 **ECS 安全组 / 轻量应用服务器（SWAS）防火墙** 白名单管理。四种形态覆盖「把动态 IP 放行到自己机器」的常见场景：手机网页一键放行、DDNS 域名跟踪、命令行、NAS 常驻同步。

> GD (Gateway Guard) manages firewall whitelists for Alibaba Cloud ECS security groups and Simple Application Server (SWAS). It ships four tools around one job — keeping your ever-changing client IP allowed on your own machines: a PWA for one-tap allow, a DDNS-tracking scheduled function, a CLI, and a Docker daemon for NAS / homelab. Docs are Chinese-first.

| 组件 | 适用场景 | 部署形态 |
|------|----------|----------|
| **Web**（`@gd/web`） | 手机 / 电脑上打开网页，一键把当前公网 IP 放行到勾选的机器 | 函数计算 FC（或任意 Node 环境） |
| **DDNS 定时任务**（`@gd/scheduler`） | 家里有 DDNS 域名，解析变了自动跟进白名单 | FC 定时触发（每 5 分钟） |
| **CLI**（`@gd/cli`） | 脚本里或手动跑一次，放行当前公网 IP | 本地 Node |
| **Docker 同步**（`@gd/job`） | NAS / Homelab 常驻，无需 DDNS，定时对账家庭公网 IP | Docker，镜像 [`rockdai/gd`](https://hub.docker.com/r/rockdai/gd) |

## 规则所有权契约

**这是你敢在生产账号上跑它的前提，先读这个。**

每个模块只在规则备注（remark / description）里写自己的前缀，也只认领、只清理自己前缀的规则——互相不碰，更不碰你手工维护的规则：

| 模块 | 备注前缀 | 清理范围 |
|------|----------|----------|
| Web | `gd-web@<时间>` | 超过 24 小时的过期规则 |
| DDNS 定时任务 | `gd-ddns:<域名>@<时间>` | 同域名规则中的重复项 |
| CLI | `gd-cli:<备注>@<时间>` | 只修改，不清理 |
| Docker 同步 | `gd-job:<label>@<时间>` | 自己 label 名下、源 IP 已不是当前公网 IP 的规则 |

所有删除操作外层都有一道 fail-closed 守卫（`isOurManagedRemark`）：备注不匹配任何 `gd-*` 前缀的规则，无论内层判断怎么写，都删不掉。规则统一为 TCP + UDP 各一条、全端口（`1/65535`）、源为 `<IP>/32`——它管的是「谁能连」，端口收敛交给安全组其他规则或机器自身。

## 快速开始

先准备一个**最小权限** RAM 子账号的 AK/SK（所需权限见 [SECURITY.md](SECURITY.md)）。

### Docker 同步（最容易上手）

不需要 clone 仓库，镜像多架构（`linux/amd64` + `linux/arm64`），`latest` 跟随 `main`，另有 `sha-<commit>` 标签：

```bash
docker run -d --name gd-job --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 \
  -e ACCESS_KEY_ID=xxx -e ACCESS_KEY_SECRET=yyy \
  -e TZ=Asia/Shanghai -e REGIONS=cn-hangzhou,cn-hongkong \
  -e RULE_LABEL=home \
  rockdai/gd:latest
docker logs -f gd-job
```

它每 `SYNC_INTERVAL`（默认 5 分钟）跑一轮完整对账：取当前公网 IP → 列出机器 → 缺的规则补上、别处已放行的不重复建、自己名下旧 IP 的规则清掉。所以新建的机器、控制台里手删的规则，下一轮自动修好，不用重启容器。

日志每轮一行摘要（`1.2.3.4 → 3 machine(s): 2 rule(s) added, 0 rule(s) removed, 0 failure(s)`；规则按条数计，每台机器 TCP + UDP 两条），只有真的写了规则或出错才打机器级细节；启动后第一轮例外——每台机器都打一行（含 `already exists`），方便部署时看清全貌。

用 compose 的话，把 [`packages/job/docker-compose.example.yml`](packages/job/docker-compose.example.yml) 存成 `docker-compose.yml` 填好即用；自己构建：`docker build -f packages/job/Dockerfile -t gd-job .`（上下文是仓库根目录）。

环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET` | — | 必填，阿里云 AK/SK |
| `MACHINE_ALLOW` | 空 | 只操作这些机器，逗号分隔，实例 ID 或实例名皆可 |
| `MACHINE_DENY` | 空 | 不操作这些机器；两者都为空时处理所有机器 |
| `SYNC_INTERVAL` | `5m` | 同步间隔，接受 `5m` / `30s` / 纯秒数 |
| `REGIONS` | 十个常用地域 | 扫描地域，逗号分隔。每地域每轮 2 次 API 调用，建议只填有机器的 |
| `RULE_LABEL` | `default` | 写进规则备注。多站点部署必须各不相同，否则互删对方规则。不含 `:`/`@`，≤32 字符 |
| `IP_ENDPOINT` | `https://get-ip.rockdai.com` | 公网 IP 查询地址，纯文本返回 IPv4（10 秒超时；私网/回环地址会被拒绝，本轮跳过）。默认是作者自建的 best-effort 服务，自部署建议换成自己的 |
| `TZ` | UTC | 建议 `Asia/Shanghai`，否则规则备注时间差 8 小时 |

名单里的机器不存在（已释放、不在配置地域、名字写错）时跳过并记日志，不影响其他机器。

### Web

```bash
npm i          # Node >= 20；npm workspaces，一次装齐所有包
npm run dev    # http://127.0.0.1:7001
```

页面功能：自动列出所有 ECS + 轻量服务器 → 显示当前设备公网 IP（浏览器直连 `IP_ENDPOINT`，拿的是客户端真实 IP，不是服务端出口 IP）→ 勾选机器一键放行；也可以手填任意 IP。

生产部署（FC 或自托管 `npm start`，监听 `PORT`，默认 9000）需要配置的环境变量见下方[Web 配置](#web-配置)。

### CLI

```bash
cp .aliyun.conf.example .aliyun.conf            # 凭证（或走环境变量）
cp rule-config.example.json rule-config.json    # 规则配置（哪些域名放行到哪些机器）
export RULE_CONFIG_FILE=rule-config.json

node bin/ecs-dsec-handler.js                    # 放行当前公网 IP
node bin/ecs-dsec-handler.js --ip 1.2.3.4       # 指定 IP
node bin/ecs-dsec-handler.js --dry-run          # 只看不写
```

> CLI 目前只处理 `swas-open` 条目；配置里的 `ecs` 条目由定时任务负责，CLI 会逐条跳过并记日志，若一条可处理的都没有则报错退出。

### DDNS 定时任务

本地跑一次（FC 部署见[下文](#部署到函数计算-fc)）：

```bash
ACCESS_KEY_ID=xxx ACCESS_KEY_SECRET=yyy RULE_CONFIG_FILE=rule-config.json \
  node -e "require('./index').handler({}, {}, console.log)"
```

对配置里的每个 DDNS 域名：解析出 IP → 更新/创建对应机器上 `gd-ddns:<域名>` 名下的规则 → 清理同域名的重复规则。

## 配置参考

### 凭证

两种方式，环境变量优先：

- 环境变量 `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`（FC / Docker 用这个）
- 项目根 `.aliyun.conf`（本地开发用，已 gitignore）：`cp .aliyun.conf.example .aliyun.conf` 后填入

### 规则配置（`RULE_CONFIG_JSON` / `RULE_CONFIG_FILE`）

定时任务和 CLI 需要知道「哪些域名放行到哪些机器」——这是每个部署者自己的拓扑，不进仓库。两种给法（前者优先）：

- `RULE_CONFIG_JSON`：内联 JSON（FC 等托管环境在控制台环境变量里填）
- `RULE_CONFIG_FILE`：JSON 文件路径（本地：`cp rule-config.example.json rule-config.json` 后编辑，已 gitignore）

格式见 [`rule-config.example.json`](rule-config.example.json)，一个非空数组，每项：

- `product`：`ecs` 或 `swas-open`；`regionId`
- `groupId`（ecs 安全组）/ `instanceId`（swas-open 实例）
- `ruleList[].name`：DDNS 域名（解析成 IP 写入规则）；所有 `name` 去重后即要解析的域名列表
- `ruleList[].id`（可选）：仅用于定位已由定时任务创建、且备注以 `gd-ddns:` 开头的规则；其他模块或手工维护的规则即使 ID 填在这里也不会被认领

缺失、为空或格式错误都会在调用时直接报错，不会静默跳过。

### Web 配置

认证：默认密码登录，可额外启用 Face ID / Passkey（附加方式，不替代密码）。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PASSWORD` | — | 访问密码（页面登录 + OpenAPI Bearer 鉴权共用） |
| `JWT_SECRET` | 随机生成 | JWT 签名密钥。建议显式配置，否则函数重启后所有登录失效 |
| `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET` | — | 阿里云凭证 |
| `REGIONS` | 十个常用地域 | 拉取机器列表时扫描的地域 |
| `IP_ENDPOINT` | `https://get-ip.rockdai.com` | 浏览器端查公网 IP 的地址，经 `/api/auth/status` 下发给前端。默认是作者自建服务（对方能看到你的出口 IP），自部署建议换成自己的 |
| `AMAP_WEB_SERVICE_KEY` | 空 | 可选，高德 Web 服务 key，用于显示 IP 归属地；不配则不显示 |

Face ID / Passkey 采用**单用户 allowlist** 模型：公开页面只允许已批准的 credential 登录；新设备必须在已登录态下发起绑定，绑定完成后页面给出新的 `PASSKEY_CREDENTIALS_JSON`，写回环境变量并重启后才真正生效。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PASSKEY_RP_ID` | — | WebAuthn RP ID（如 `gd.example.com`），**必填**，不配则 Passkey 不可用（密码登录不受影响） |
| `PASSKEY_ORIGIN` | — | 完整来源（如 `https://gd.example.com`），**必填**，同上 |
| `PASSKEY_CREDENTIALS_JSON` | `[]` | 已批准的 credential allowlist |
| `PASSKEY_ENABLED` | `true` | 是否启用 passkey 能力 |
| `PASSKEY_ENROLLMENT_ENABLED` | `true` | 是否允许已登录用户绑定新设备 |
| `PASSKEY_RP_NAME` | `GD` | 系统弹窗里显示的站点名 |
| `PASSKEY_USER_NAME` / `PASSKEY_USER_DISPLAY_NAME` / `PASSKEY_USER_ID` | `admin` / `GD Admin` / `gd-admin` | 单用户身份信息 |
| `PASSKEY_CHALLENGE_TTL_SEC` | `300` | challenge 有效期（秒） |
| `PASSKEY_FLOW_TOKEN_SECRET` | 由 `JWT_SECRET` 派生 | challenge token 签名密钥 |
| `PASSKEY_COUNTERS_FILE` | `packages/web/run/passkey-counters.json` | passkey counter 持久化路径 |

> 本地 `http://127.0.0.1:7001` 只适合密码登录开发；Passkey 依赖固定的 RP ID / origin，真机联调要用实际部署域名。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | PWA 首页 |
| GET | `/api/auth/status` | 认证方式状态 + `ipEndpoint` 下发 |
| POST | `/api/login` | 密码登录，返回 JWT |
| POST | `/api/passkey/auth/options` · `/api/passkey/auth/verify` | Passkey 登录 |
| POST | `/api/passkey/register/options` · `/api/passkey/register/verify` | 已登录态下绑定新设备 |
| GET | `/api/machines` | 机器列表（ECS + 轻量服务器） |
| GET | `/api/ip-location` | IP 归属地（服务端代查高德，key 不出后端） |
| POST | `/api/whitelist` | 添加 IP 到多台机器白名单 |
| POST | `/openapi/whitelist` | 单机器创建白名单规则（`Authorization: Bearer <PASSWORD>`，不走 JWT；同 IP 1 分钟 5 次错误密码限流 429） |

```bash
# OpenAPI 示例
curl -X POST https://gd.example.com/openapi/whitelist \
  -H "Authorization: Bearer $PASSWORD" \
  -d ip=1.2.3.4 -d product=swas-open -d instanceId=i-xxx -d regionId=cn-hangzhou
```

`POST /api/whitelist` 请求体：

```json
{
  "ip": "1.2.3.4",
  "machines": [
    { "product": "swas-open", "instanceId": "xxx", "regionId": "cn-hangzhou" },
    { "product": "ecs", "instanceId": "xxx", "regionId": "cn-hangzhou", "securityGroupId": "sg-xxx" }
  ]
}
```

## 部署到函数计算 FC

通过 [Serverless Devs](https://github.com/Serverless-Devs/Serverless-Devs) 部署，配置见 `s.yaml`；仓库的 `fc-deploy.yaml` 工作流会在 push `main` 时自动部署（仅上游仓库）。

| 函数 | 入口 | 触发方式 |
|------|------|----------|
| `gd-web` | `bootstrap.js`（custom runtime） | HTTP 触发器 |
| `ecs-dsec` | `index.handler` | 定时触发器（每 5 分钟） |

```bash
npm install -g @serverless-devs/s
s deploy --function code --assume-yes   # 仅更新代码
```

> 函数配置（runtime、内存、触发器、环境变量）都在 FC 控制台管理，`s.yaml` 与部署工作流只更新代码。
> `s.yaml` 的 pre-deploy 钩子会把 `node_modules/@gd/*` 的 workspace symlink 实体化（`scripts/materialize-workspace-deps.sh`），确保 FC 端 require 正常。本地跑过 `s deploy` 后想恢复 symlink，重新 `npm install` 即可。

FC 控制台需要配置的环境变量：

| 函数 | 必须 | 说明 |
|------|------|------|
| `gd-web` | `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`、`PASSWORD`、`JWT_SECRET` | 凭证与登录 |
| `gd-web` | `PASSKEY_RP_ID` / `PASSKEY_ORIGIN` | 不配则 Passkey 不可用（密码登录不受影响） |
| `ecs-dsec` | `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`、`RULE_CONFIG_JSON` | **`RULE_CONFIG_JSON` 缺失时每次定时调用直接报错**，升级到含规则加载器的版本前先配好 |

## 项目结构

npm workspaces monorepo，根目录的 `bootstrap.js` / `index.js` / `bin/ecs-dsec-handler.js` 是指向各包的 1 行 shim（FC 与 CLI 的入口路径保持稳定）：

```
├── packages/
│   ├── shared/        # @gd/shared —— 跨包共用：规则备注契约、防火墙读写、IP 工具、规则配置加载器
│   ├── web/           # @gd/web —— Egg.js PWA + OpenAPI（controller/service/middleware + 单文件前端）
│   ├── scheduler/     # @gd/scheduler —— FC 定时任务（DDNS → 白名单）
│   ├── job/           # @gd/job —— Docker 定时同步（Dockerfile、compose 示例在此）
│   └── cli/           # @gd/cli —— ecs-dsec-handler 命令行
├── rule-config.example.json   # 规则配置示例（真实配置 rule-config.json 已 gitignore）
├── s.yaml                     # Serverless Devs 部署配置
└── docs/design/               # 设计文档
```

## 开发

```bash
npm i && npm test        # 全部测试（CI 在 Node 20 / 22 / 24 上跑同样的命令）
npm test -w @gd/shared   # 只跑某个包
```

协作约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)。

## License

[MIT](LICENSE)
