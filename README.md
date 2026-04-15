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

## 开发/协作约定

- **对该 GitHub 仓库的任何改动都请走 PR**：新建分支 → push 分支 → 提 PR → 评审合并
- 不要直接 push 到 `main`

## License

MIT
