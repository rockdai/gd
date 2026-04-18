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

定时任务和 CLI 只会修改带系统托管 remark 的规则，不会认领或覆盖普通手工规则。

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

> `Face ID / Passkey` 真机联调需要可信 HTTPS 域名和正确的 `PASSKEY_RP_ID` / `PASSKEY_ORIGIN`。`http://127.0.0.1:7001` 只适合普通密码登录开发。

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

环境变量需在 FC 控制台配置 `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`。

## 认证方式

Web 端默认使用密码登录：

- `PASSWORD`：访问密码
- `JWT_SECRET`：JWT 签名密钥，建议显式配置，避免函数重启后令牌失效

在此基础上，你还可以额外启用 Face ID / Passkey。它是附加登录方式，不会替代或关闭默认密码登录。

### Face ID / Passkey

Passkey 采用**单用户 allowlist** 模型：

- 公开页面只允许使用已经批准过的 credential 登录
- 新设备绑定必须先在已登录态下发起
- 绑定完成后，页面会返回一段新的 `PASSKEY_CREDENTIALS_JSON`
- 把这段 JSON 写回环境变量并重启服务后，新设备才真正获准登录

相关环境变量：

- `PASSKEY_ENABLED`：是否启用 passkey 能力，默认 `true`
- `PASSKEY_RP_NAME`：显示给系统弹窗的站点名称，默认 `GD`
- `PASSKEY_RP_ID`：可选，WebAuthn RP ID；不填时自动使用当前请求域名
- `PASSKEY_ORIGIN`：可选，完整来源；不填时自动使用当前请求来源
- `PASSKEY_USER_NAME`：单用户逻辑用户名，默认 `admin`
- `PASSKEY_USER_DISPLAY_NAME`：单用户显示名，默认 `GD Admin`
- `PASSKEY_USER_ID`：单用户稳定 ID，默认 `gd-admin`
- `PASSKEY_CREDENTIALS_JSON`：已批准 passkey allowlist，默认 `[]`
- `PASSKEY_ENROLLMENT_ENABLED`：是否允许已登录用户继续绑定新设备，默认 `true`
- `PASSKEY_CHALLENGE_TTL_SEC`：passkey 挑战票据有效期，默认 `300`

示例：

```bash
PASSWORD='your-password'
JWT_SECRET='replace-me'
PASSKEY_CREDENTIALS_JSON='[]'
```

生产环境域名为 `https://gd.rockdai.com`。如果服务就是通过这个域名对外提供，通常不需要再额外配置 `PASSKEY_RP_ID` / `PASSKEY_ORIGIN`。

## 项目结构

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
- `RuleConfig[].ruleList[].id` / `ids`：仅用于定位已由本工具创建并托管的规则，不能填写手工维护规则的 ID

## 开发/协作约定

- **对该 GitHub 仓库的任何改动都请走 PR**：新建分支 → push 分支 → 提 PR → 评审合并
- 不要直接 push 到 `main`

## License

MIT
