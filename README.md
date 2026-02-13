# aliyun-ecs-dsec

一个用于**自动更新阿里云安全组 / 轻量应用服务器防火墙规则**的小工具。

## 背景

我家里有两条宽带（电信 / 联通）。路由器每次重新拨号联网后，家庭公网 IP 通常会变化。

为避免把云上资源（ECS / 轻量应用服务器）完全暴露在公网，我在家里的 NAS 上配置了 DDNS，把当前公网 IP 绑定到 `keydiary.dev` 的子域名（以及其他自用域名）上。本项目部署在**阿里云函数计算 FC**，通过定时触发运行：

1. 解析 DDNS 域名 → 得到当前家庭公网 IP
2. 调用阿里云 OpenAPI → 更新对应资源的安全规则（备注会带上域名和时间戳）

这样云资源可以只放行来自家庭网络的访问，从而增加一层安全防护。

## 功能

- 支持 **轻量应用服务器（swas-open）**：更新防火墙规则（`ModifyFirewallRule`）
- （代码已预留）支持 **ECS（ecs）**：更新安全组规则（`ModifySecurityGroupRule`）
- 通过 `config.js` 配置：
  - 需要解析的域名（DDNS）
  - 需要更新的资源（region / instanceId / ruleId 等）

> 注意：当前实现把端口范围设置为 `1/65535`，协议为 TCP（见 `index.js`）。如果你只想放行特定端口，建议把范围收窄。

## 运行方式

### 1) 环境变量（AK）

在函数计算 FC（或本地运行）时需要提供：

- `ACCESS_KEY_ID`
- `ACCESS_KEY_SECRET`

建议使用**最小权限**的 RAM 子账号/角色，只授予修改对应安全组/防火墙规则所需的权限。

### 2) 配置文件

编辑 `config.js`：

- `DOMAIN`：需要解析的 DDNS 域名列表（例如电信 / 联通 各一个域名）
- `RuleConfig`：需要更新的规则列表
  - `product`: `swas-open` 或 `ecs`
  - `regionId`
  - `instanceId`（swas-open）/ `groupId`（ecs，若启用）
  - `ruleList`: `{ name: <domain>, id: <ruleId> }`

### 3) 本地调试

Node.js 18+（FC 运行时同样支持 fetch）：

```bash
npm i
ACCESS_KEY_ID=xxx ACCESS_KEY_SECRET=yyy node -e "require('./index').handler({}, {}, console.log)"
```

### 4) 部署到函数计算 FC

- 运行时：Node.js 18+
- 触发器：定时触发（例如每 5~10 分钟）
- 环境变量：配置 `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET`

## 开发/协作约定（重要）

- **对该 GitHub 仓库的任何改动都请走 PR**：新建分支 → push 分支 → 提 PR → 评审合并
- 不要直接 push 到 `main`

## 实现细节

- DNS 解析使用：阿里 DNS 的 HTTP 解析接口：
  - `http://dns.alidns.com/resolve?name=<domain>&type=1`
- 更新规则：
  - swas-open: `ModifyFirewallRuleRequest`（`@alicloud/swas-open20200601`）
  - ecs: `ModifySecurityGroupRuleRequest`（`@alicloud/ecs20140526`）

## License

MIT
