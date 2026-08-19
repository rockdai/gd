# OpenAPI 白名单创建接口 设计文档

- 日期：2026-05-14
- 范围：在 `gd-web` 上新增一个供脚本/CLI 调用的 OpenAPI，用 HTTP header 鉴权，复用 `PASSWORD` 环境变量

## 目标 / 非目标

**目标**
- 暴露一个无状态的 HTTP 接口，单次调用为单台机器添加单条白名单（IP）规则
- 鉴权直接走 header，不走"先登录换 JWT"两步流程，方便 curl / 脚本一行调用
- 复用现有 `app/service/aliyun.js#addIpToWhitelist` 业务逻辑，规则 remark 仍走 `gd-web:` 前缀，享受现有 24h 过期清理

**非目标**
- 不支持批量（一次多机器）
- 不引入新的 remark 前缀 `gd-openapi:`
- 不实现独立用户 / API key 体系——只有一个 `PASSWORD`

## API 契约

```
POST /openapi/whitelist
Headers:
  Authorization: Bearer <PASSWORD>
  Content-Type: application/json  或  application/x-www-form-urlencoded
```

请求体字段（JSON 与 form-encoded 等价）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ip` | string | 是 | IPv4 地址，需通过 `lib/ip.js#isValidIpv4` 校验 |
| `product` | string | 是 | 枚举 `ecs` / `swas-open` |
| `instanceId` | string | 是 | 实例 ID |
| `regionId` | string | 是 | 阿里云 region |
| `securityGroupId` | string | `product=ecs` 时必填 | ECS 安全组 ID |

响应：

| 状态 | Body | 触发条件 |
|---|---|---|
| `200` | `{success:true, status:"success"\|"partial", message, machine}` | 业务调用返回 `success` 或 `partial`（TCP/UDP 中至少一个写成功） |
| `400` | `{success:false, message}` | 字段缺失 / `ip` 非法 / `product` 不在枚举 / `ecs` 缺 `securityGroupId` |
| `401` | `{success:false, message}` | 缺 `Authorization` 头 / 不以 `Bearer ` 开头 / 密码不匹配 |
| `429` | `{success:false, message}` | 同 IP 1 分钟内"密码错"次数 ≥ 5（仅在 token 实际传了但不匹配时累加；缺/格式错的 header 不计入） |
| `500` | `{success:false, message}` | `PASSWORD` 未配置 / 控制器抛出未捕获异常 |
| `502` | `{success:false, status:"error", message, machine}` | `addIpToWhitelist` 返回 `error`（上游阿里云调用失败 / 拉规则失败） |

成功响应示例：
```json
{
  "success": true,
  "status": "success",
  "message": "TCP: added, UDP: already exists; cleaned 2 expired gd-web rule(s)",
  "machine": {
    "product": "swas-open",
    "instanceId": "i-xxx",
    "regionId": "cn-hangzhou"
  }
}
```

curl 示例：
```bash
curl -X POST https://gd.example.com/openapi/whitelist \
  -H "Authorization: Bearer $PASSWORD" \
  -d ip=1.2.3.4 -d product=swas-open -d instanceId=i-xxx -d regionId=cn-hangzhou
```

## 架构与代码结构

### 鉴权落点

新增路由级中间件 `app/middleware/password_auth.js`，仅挂在 `/openapi/*` 路由上。`config.jwtAuth.skipPaths` 增加 `/^\/openapi\//`，避免全局 `jwtAuth` 中间件先把请求拦掉。

为什么不走 fallback / 改 `jwtAuth`：保持"用户态接口走 JWT、OpenAPI 走 password"两条独立鉴权路径，互不污染、未来好演进（例如 OpenAPI 后续要换签名鉴权时只需改一个文件）。

### 文件清单

**新增**
- `app/middleware/password_auth.js`
  - 导出 `(options, app) => async (ctx, next) => {...}` 形式（egg 中间件签名）
  - 行为：
    1. 读 `process.env.PASSWORD`，未配置 → `500 + log error`（不计入限流）
    2. 先检查同 IP 失败计数：≥ `MAX_ATTEMPTS` → 直接 `429`
    3. 读 `ctx.get('authorization')`，无或不以 `Bearer ` 开头 → `401`，**不**累加失败计数（这类请求不构成密码爆破）
    4. 取 token = `header.substring(7)`
    5. 用 HMAC-SHA256（盐 `gd-openapi-auth`，区别于 `auth.js` 的 `gd-auth-compare`）做 `crypto.timingSafeEqual` 比较
    6. 不匹配 → `401`，**累加**失败计数；匹配 → 清空该 IP 的失败计数，`await next()`
  - 内部维护 `Map<clientIp, number[]>` 失败时间戳数组（`MAX_ATTEMPTS=5`、`WINDOW_MS=60_000`），结构与 `auth.js` 一致；用 `setInterval` + `unref()` 每 5 分钟清理空条目
  - 计数器作用域为模块级常量，且独立于 `auth.js` 的 `loginAttempts`
- `app/controller/openapi.js`
  - `addWhitelist(ctx)`：
    1. 取 body 字段 → 校验：所有必填存在、`isValidIpv4(ip)`、`product ∈ {ecs, swas-open}`、`product==='ecs' ⇒ securityGroupId`
    2. 任一校验失败 → `400 + { success:false, message }`
    3. `const machine = { product, instanceId, regionId, securityGroupId? }`
    4. `const [result] = await ctx.service.aliyun.addIpToWhitelist(ip, [machine])`
    5. 摊平为 `{ success: result.status !== 'error', status: result.status, message: result.message, machine: { product, instanceId, regionId, securityGroupId? } }`
    6. `result.status === 'error'` → `502`；其余 `200`
  - 控制器自身 `try/catch` 抛出的未捕获异常 → `500 + { success:false, message: err.message }`，并 `ctx.logger.error`

**修改**
- `app/router.js`
  - 新增：
    ```js
    const passwordAuth = app.middleware.passwordAuth({}, app);
    router.post('/openapi/whitelist', passwordAuth, controller.openapi.addWhitelist);
    ```
- `config/config.default.js`
  - `config.jwtAuth.skipPaths` 数组追加 `/^\/openapi\//`
- `README.md`
  - "API" 表格追加 `POST /openapi/whitelist`
  - 在 "认证方式" 一节加一段："OpenAPI 接口（`/openapi/*`）使用 `Authorization: Bearer <PASSWORD>` 鉴权，不走 JWT。"

## 安全考量

- **timing-safe 密码比较**：复用 `auth.js` 的 HMAC + `crypto.timingSafeEqual` 方案；HMAC 同时解决"两侧 buffer 长度可能不等"的问题。盐独立为 `gd-openapi-auth`。
- **失败限流**：同 IP 每分钟 ≥ 5 次"密码错"→ 429。和 `/api/login` 等价（login 也只对密码错累加，不对缺字段累加）；两个限流计数器互相隔离，避免误伤。
- **PASSWORD 未配置 = 500**：与 `/api/login` 行为一致，禁止"无密码=允许任何 token"的灾难性退化。
- **不打 PASSWORD / token 到日志**：失败日志只记 `clientIp` 和 `reason`（`missing-header` / `bad-format` / `bad-token`）。
- **JWT 路径不受影响**：`jwtAuth.skipPaths` 只新增 `/^\/openapi\//`，所有 `/api/*` 仍强制 JWT。

## 测试计划

新增：
- `test/app/middleware/password_auth.test.js`
  - 缺 `Authorization` → 401
  - 不以 `Bearer ` 开头 → 401
  - 密码错 → 401，且失败计数 +1
  - 密码对 → next 被调用，且失败计数清零
  - `PASSWORD` 未设置 → 500（用 `mm.env('PASSWORD', '')` mock）
  - 同 IP 连续 5 次"密码错"→ 第 6 次 429
  - 缺/格式错 header 重复多次仍是 401（不进 429）
- `test/app/controller/openapi.test.js`
  - 缺 `ip` / 非法 ip → 400
  - 缺 `instanceId` / `product` / `regionId` → 400
  - `product=ecs` 但缺 `securityGroupId` → 400
  - 成功路径：mock `service.aliyun.addIpToWhitelist` 返回 `[{status:'success', message:'...'}]` → 200，body 形态正确
  - 服务返回 `error` → 502
  - 同时验证 form-encoded 与 JSON 两种 Content-Type 都能解析

实现时用 `egg-bin test` 默认的 `egg-mock`，与 `test/index.test.js` 中既有写法对齐。

## 部署影响

- 不需要新环境变量；`PASSWORD` 已存在
- FC HTTP 触发器路由不动（`/openapi/*` 与 `/api/*` 同进同程）
- README 中"快速开始 / 认证方式"一节顺带说明新接口

## 不做的事 / 后续可演进

- 不做 IP 自动识别（`ctx.ip`）：FC + 反向代理后 `X-Forwarded-For` 是否可信需要单独评估，本次保持 caller 显式传 `ip` 简单可靠
- 不做批量 / 多机器：未来如有需要可在同一 controller 里按 `Array.isArray(body.machines)` 分支扩展
- 不抽公共 OpenAPI 鉴权基类：仅一个端点时 YAGNI；当 `/openapi/*` 路由 ≥ 3 个时再考虑
