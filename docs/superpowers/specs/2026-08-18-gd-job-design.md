# gd-job：Docker 化家庭公网 IP 白名单同步程序

- 日期：2026-08-18
- 状态：设计待审
- 相关模块：`@gd/shared`、`@gd/web`、`@gd/scheduler`、`@gd/cli`

## 1. 背景与目标

现有四个模块都能把某个 IP 写进阿里云防火墙白名单，但都不适合跑在家里：

| 模块 | 形态 | 为什么不适合 NAS |
|------|------|------------------|
| `@gd/web` | Egg.js PWA | 要人点按钮，规则 24h 过期 |
| `@gd/scheduler` | FC 定时函数 | 跟着 DDNS 域名走，目标机器写死在 `rule-config.js` |
| `@gd/cli` | 一次性命令 | 跑完就退出，不定时 |

目标是新增一个可以 `docker compose up -d` 丢在 NAS / Homelab 上长期运行的程序：定时获取本机所在网络的公网 IP，自动同步到用户阿里云账号下的 ECS / 轻量应用服务器防火墙白名单，并清理自己留下的旧 IP 规则。

## 2. 非目标

- 不提供 Web 界面或 HTTP 接口。要看状态就看容器日志。
- 不管理 DDNS 域名解析。那是 `@gd/scheduler` 的职责。
- 本次不发布容器镜像到 GHCR / Docker Hub，只提供 `Dockerfile` 让用户自行构建。发布另开 PR 处理。
- 不支持 IPv6。现有四个模块都只处理 IPv4，保持一致。

## 3. 规则归属契约

项目的核心安全约定是：每个模块只认领、只修改、只删除自己前缀的规则，绝不碰其他模块的规则和用户手工维护的规则。

| 模块 | 备注前缀 | 备注形态 |
|------|----------|----------|
| `@gd/web` | `gd-web` | `gd-web@2026-08-18 09:00:00` |
| `@gd/scheduler` | `gd-ddns` | `gd-ddns:<域名>@2026-08-18 09:00:00` |
| `@gd/cli` | `gd-cli` | `gd-cli:<remark>@2026-08-18 09:00:00` |
| **`@gd/job`（新增）** | **`gd-job`** | **`gd-job:<label>@2026-08-18 09:00:00`** |

采用 `gd-cli` 那种 `前缀:标识@时间戳` 的三段形态，而不是 `gd-web` 的两段形态，是为了支持多站点部署（见 §7）。

注意区分：代码常量 `GD_JOB_RULE_PREFIX`（值为 `gd-job`）必须保持模块专属，它与 `GD_WEB_RULE_PREFIX` / `GD_DDNS_RULE_PREFIX` / `GD_CLI_RULE_PREFIX` 并列，正是模块间互不认领规则的身份标识。§6 中「配置项不区分模块」指的是环境变量命名，不涉及这组常量。

### 3.1 隔离性验证

新增 `gd-job` 前缀需要把它加进 `isOurManagedRemark()`（该函数是所有删除操作的 fail-closed 外层守卫）。已确认这不会让既有模块误删 gd-job 规则：

- **`@gd/web`**：`packages/web/app/service/aliyun.js` 的清理条件是 `isOurManagedRemark(remark) && isExpiredWebRule({...})`。`isExpiredWebRule` 内部要求 `hasRemarkPrefix(remark, 'gd-web')`，`gd-job:home@...` 不满足，返回 `false`。
- **`@gd/scheduler`**：`packages/scheduler/index.js:337` 的 `isOurManagedRemark` 作用在 `staleRules` 上，而 `staleRules` 来自 `matchedRules`（`packages/scheduler/index.js:218-222` 已用 `isManagedDdnsRemark` 过滤过）。gd-job 规则根本进不了这个集合。

反向同理：gd-job 的清理条件要求 `isManagedJobRemark(remark, label)`，不会碰到 `gd-web` / `gd-ddns` / `gd-cli` 和手工规则。

## 4. 架构

### 4.1 复用策略

`packages/web/app/service/aliyun.js` 里约 240 行正是 gd-job 需要的逻辑：跨地域列机器、按协议循环加规则、加之前预检以保护手工规则、列规则失败时 fail-closed 拒绝写入、按谓词批量删除。但它是 Egg `Service`，依赖 `this.config` / `this.logger` / `this.app.baseDir`，普通 Node 进程无法直接使用。

**决策：把这部分提取到 `@gd/shared/src/machine-firewall.js` 成为纯函数，web 与 job 共用。**

不复制一份的理由：清理逻辑是安全敏感代码，两份拷贝必然随时间漂移，而需求明确要求 gd-job 的清理逻辑与 web 模块保持一致——只有共用同一份代码才能真正做到。

提取后：

```
@gd/shared/src/machine-firewall.js   （新增，纯函数，无框架依赖）
  listMachines({ credential, regions, logger })
  listEcsInstances({ credential, regionId })
  listSwasInstances({ credential, regionId })
  addIpRules({ credential, machine, sourceCidrIp, remark, logger })
  cleanupRules({ credential, machine, shouldDelete, logger })

@gd/web app/service/aliyun.js        （变薄，保留 web 专属部分）
  getCredential()                    Egg 配置读取
  listMachines()                     委托 shared
  addIpToWhitelist()                 委托 shared，传入 gd-web 前缀
  _cleanupExpiredWebRules()          委托 shared，传入 gd-web + TTL 谓词
  _buildProtocolOperationResult()    保留：web API 响应格式
  _appendCleanupMessage()            保留：web API 响应格式
```

`addIpRules` 与 `cleanupRules` 通过参数区分两个消费方：前者接收调用方构造好的 `remark` 字符串，后者接收 `shouldDelete(rule)` 谓词。web 传 `gd-web` + 24h TTL 谓词，job 传 `gd-job:<label>` + 源 IP 不等于当前 IP 的谓词。

`packages/web/test/app/service/aliyun.test.js` 中直接调用 `_addIpToEcs` / `_addIpToSwas` / `_cleanupExpiredEcsRules` / `_cleanupExpiredSwasRules` 的 11 个用例，随代码迁移到 `packages/shared/test/machine-firewall.test.js`。迁移后这些用例同时保护 web 和 job 两个消费方，覆盖强于现状。留在 web 的是 `_appendCleanupMessage` / `_buildProtocolOperationResult` 的 3 个消息格式化用例。

### 4.2 包结构

```
packages/job/
├── package.json              @gd/job，依赖 @gd/shared
├── bin/gd-job.js             入口：解析配置 → 启动定时循环
├── src/
│   ├── config.js             环境变量 → 配置对象 + 校验
│   ├── machines.js           allow/deny 筛选
│   └── sync.js               单轮同步
├── Dockerfile
├── docker-compose.example.yml
└── test/
```

`src/` 只有三个文件：`config.js` 和 `machines.js` 各自封装一块可独立测试的纯逻辑，`sync.js` 是编排。定时循环逻辑只有几行，放在 `bin/gd-job.js` 里，不单独开文件。

不在仓库根目录加 shim（`@gd/web` / `@gd/scheduler` 那种）——gd-job 只通过 Docker 运行，没有 FC handler 配置或外部 `require` 需要兼容。

## 5. 单轮同步流程

```
1. ip ← getPublicIp(endpoint)
      失败 → 记 warn，跳过本轮，不更新 lastIp
2. ip === lastIp → 跳过本轮（一行 info 日志）
3. machines ← listMachines(regions)
      Promise.allSettled：单个地域失败只记 warn，其余地域继续
4. targets ← applyAllowDeny(machines)
5. 对每台 target（串行）：
      rules ← 列出该机器现有规则     ← 一次调用，供 a 和 b 共用
        失败 → 该机器标记失败，跳到下一台（fail-closed，不加不删）
      a. 加：TCP / UDP 中缺少 (协议, 1/65535, 当前IP) 的，创建 gd-job:<label>@<now>
      b. 清：rules 中 isManagedJobRemark(remark, label) 且 源IP ≠ 当前IP 的，批量删除
6. 所有 target 均成功 → lastIp = ip
   有任一失败       → 不更新 lastIp，下一轮重试
```

### 5.1 与 web 模块刻意不同的两点

**先加后清（web 是先清后加）。** web 清理的是与本次新增无关的、已过期 24h 的旧规则，先清后加没有风险。gd-job 清理的恰恰是「正在被替换的那条规则」——先删会留出一段两个 IP 都不通的窗口；先加后删则窗口内新旧 IP 都通，不会把自己关在门外。

**一次列规则供加和清共用（web 是两次）。** web 的清理和新增分别独立列规则，是因为两者在代码结构上互不相关。gd-job 两步作用于同一批规则，共用一次列举即可，API 调用量减半。删除按第 5 步开头列举时拿到的 `ruleId` 执行，新创建的规则不在这批数据里，不会被误删。

### 5.2 过期规则的定义

需求中的「清理过期规则」在 gd-job 语境下定义为**源 IP 不等于当前公网 IP 的自有规则**，与时间无关。

这与 web 的 24h TTL 不同，原因是两者语义不同：web 规则是临时授权，到点自动失效才是正确行为；gd-job 是 DDNS 语义，规则应当跟随 IP，只要 IP 仍然有效就必须一直存在。

若照搬 TTL，会与「IP 未变则不重复操作」的需求直接冲突：家里公网 IP 若 24 小时未变，程序会把自己刚建的、当前正在生效的规则当作过期规则删掉，又因为 IP 没变而不去重建，导致白名单断链。

清理的**机制**仍与 web 完全一致：只认自己前缀、`isOurManagedRemark` fail-closed 外层守卫、批量删除、删除失败不影响新增结果。

## 6. 配置项

全部通过环境变量提供，符合 Docker 惯例。

变量名不带 `GD_JOB_` 之类的模块前缀，与项目现有约定一致——`ACCESS_KEY_ID`、`PASSWORD`、`JWT_SECRET` 都是裸描述名，只有确实成体系的子系统才加前缀（`PASSKEY_*`、`AMAP_*`）。这些配置项按项目级语义定义，不属于 gd-job 私有。

其中两项在其他模块也有对应概念，本次一并统一为同一个变量，避免同一个值在项目里存在两份来源：

- **`REGIONS`**：`@gd/web` 目前把十个地域硬编码在 `config/config.default.js`。改为默认值下沉到 `@gd/shared`，web 和 job 都读同一个 `REGIONS` 变量，未设置时取共享默认值。web 的现有行为不变（未设置即等于今天的硬编码列表）。
- **`IP_ENDPOINT`**：`@gd/shared/src/public-ip.js` 目前把地址写死在同名常量里。改为该常量作为默认值、允许 `IP_ENDPOINT` 覆盖，`@gd/cli` 与 `@gd/job` 共同受益。

`MACHINE_ALLOW` / `MACHINE_DENY` / `SYNC_INTERVAL` / `RULE_LABEL` 目前只有 gd-job 消费，但同样按项目级命名，将来其他模块需要同类语义时直接复用同一个变量。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ACCESS_KEY_ID` | — | 必填。阿里云 AK |
| `ACCESS_KEY_SECRET` | — | 必填。阿里云 SK |
| `MACHINE_ALLOW` | 空 | 机器白名单，逗号分隔 |
| `MACHINE_DENY` | 空 | 机器黑名单，逗号分隔 |
| `SYNC_INTERVAL` | `5m` | 定时间隔，接受 `5m` / `30s` / 纯秒数 |
| `REGIONS` | 见下 | 扫描地域，逗号分隔 |
| `RULE_LABEL` | `default` | 写进规则备注，用于多站点隔离 |
| `IP_ENDPOINT` | `https://get-ip.rockdai.com` | 公网 IP 获取地址 |
| `TZ` | 容器默认（UTC） | 建议设为 `Asia/Shanghai` |

`REGIONS` 的共享默认值即目前 `packages/web/config/config.default.js` 中的十个地域，迁至 `@gd/shared` 后由 web 和 job 共用：`cn-hangzhou`、`cn-shanghai`、`cn-beijing`、`cn-shenzhen`、`cn-hongkong`、`ap-northeast-1`、`ap-southeast-1`、`us-west-1`、`us-east-1`、`eu-central-1`。

之所以必须可配：每轮对每个地域各调用一次 ECS 和 SWAS 列举接口，十个地域即 20 次调用。按默认 5 分钟间隔计算是每天 5760 次，其中绝大多数打在用户没有任何机器的地域上。

`TZ` 之所以必须提供：规则备注中的时间戳由 `formatDateTime()` 生成，取的是本地时间。容器默认 UTC 会让备注时间比实际早 8 小时。FC 上的 `ecs-dsec` 函数同样显式配置了该变量。

### 6.1 刻意不做成配置项

- **端口与协议**：固定 `1/65535` + TCP/UDP，与现有四个模块一致。做成可配会与既有模块产生行为差异，且会渗入规则匹配逻辑（预检和清理都依赖端口相等判断）。
- **启动是否立即执行**：固定为启动时立即同步一次，不等第一个间隔。NAS 重启后应尽快恢复访问，没有需要延迟的场景。

## 7. 多站点隔离

`RULE_LABEL` 的存在是为了解决一个真实的相互破坏问题。若同一个阿里云账号下，家里和公司各跑一个 gd-job，而备注中不带区分标识：

```
家里实例：看到 gd-job@t 源IP=5.6.7.8 → 不是我的 IP，删除 → 添加 1.2.3.4
公司实例：看到 gd-job@t 源IP=1.2.3.4 → 不是我的 IP，删除 → 添加 5.6.7.8
```

两边每 5 分钟互删一次，谁都连不上。备注写成 `gd-job:home@...` / `gd-job:office@...` 后，`isManagedJobRemark(remark, label)` 只匹配自己的 label，各认各的，互不干扰。

## 8. 机器筛选语义

```
allow 和 deny 均为空  → 处理所有扫描到的机器
仅 allow 非空         → 只处理命中 allow 的机器
仅 deny 非空          → 处理除命中 deny 之外的所有机器
两者均非空            → 先按 allow 取子集，再从中排除命中 deny 的
```

单条配置的匹配规则：`entry === machine.instanceId || entry === machine.instanceName`，即填实例 ID 或实例名皆可。

名单中列出的机器若在扫描结果中不存在（已释放、不在配置的地域、或名字拼错），跳过并记一行 info 日志，不视为错误、不影响其他机器、不阻止 `lastIp` 更新。这与需求中「如果机器不存在则跳过」一致。

ECS 挂载多个安全组时，只操作 `[...securityGroupIds].sort()[0]`，与 web 前端 `index.html:1315` 取第一个安全组的行为一致。排序是为了让「第一个」的选取结果确定——阿里云未承诺 `DescribeInstances` 返回的安全组顺序稳定，若顺序在两轮之间变化，旧 IP 规则会残留在另一个安全组中无人清理，等同于旧 IP 被长期放行。排序后该风险消失，且不改变「只动第一个」的语义。

## 9. 状态管理

`lastIp` 仅保存在进程内存中，不挂载数据卷、不写文件。

理由是新增路径本身幂等：预检发现当前 IP 的规则已存在就跳过创建。容器重启导致 `lastIp` 丢失时，下一轮会完整执行一次，但由于规则已存在、也没有旧 IP 规则需要清理，实际产生的是若干次只读 API 调用和零次写操作。为此引入数据卷不划算。

`lastIp` 只在一轮中所有目标机器都成功后才更新。否则一次瞬时失败会让程序误以为已同步完成，在 IP 不变的情况下永远不再重试。

## 10. 错误处理

| 失败点 | 处理 |
|--------|------|
| 获取公网 IP 失败 | warn，跳过本轮，不更新 `lastIp` |
| 某地域列举机器失败 | warn，该地域机器视为不存在，其余地域继续（`Promise.allSettled`，与 web 一致） |
| 某机器列举规则失败 | error，该机器既不加也不删（fail-closed，与 web 一致），标记本轮有失败 |
| 某机器新增规则失败 | error，继续处理下一台，标记本轮有失败 |
| 某机器删除旧规则失败 | error，继续处理下一台，标记本轮有失败 |
| 配置校验失败（缺 AK/SK、间隔非法） | 启动时立即退出并打印原因 |

除配置校验外，任何运行期失败都不使进程退出——NAS 上的容器应当持续重试而不是反复重启。

## 11. Docker 交付

`Dockerfile` 基于 `node:20-alpine`，在仓库根执行 `npm ci --omit=dev`，入口 `node packages/job/bin/gd-job.js`。workspace symlink 在同一镜像层内可正常解析，不存在 FC 部署时那种打包丢失问题，因此不需要 `scripts/materialize-workspace-deps.sh`。

`docker-compose.example.yml` 提供一份可直接改用的示例，含 `restart: unless-stopped` 和 `TZ=Asia/Shanghai`。

README 增加「Docker 部署（NAS / Homelab）」一节。

## 12. 测试计划

沿用现有 `egg-bin test` + `assert`，不引入新框架。

**`packages/shared/test/machine-firewall.test.js`**（从 web 迁移的 11 个用例）
- 手工规则已覆盖该 IP 时不重复授权（ECS / SWAS）
- 同一 IP 重复提交不重复创建 SWAS 规则
- 无规则覆盖时正常创建
- 拒绝删除备注不符合托管格式的规则（ECS / SWAS）
- 列举规则抛错时 fail-closed，拒绝新增（ECS / SWAS）
- 确实删除命中谓词的规则

**`packages/shared/test/firewall-rule.test.js`**（新增）
- `buildManagedJobRemark` / `isManagedJobRemark` 的构造与匹配
- label 隔离：`gd-job:home@...` 不被 `isManagedJobRemark(value, 'office')` 匹配
- `isOurManagedRemark('gd-job:home@<合法时间戳>')` 为 `true`
- `isOurManagedRemark('gd-job:home@invalid')` 为 `false`

**`packages/job/test/`**（新增）
- allow / deny 四种组合的筛选结果
- 名单中机器不存在时跳过且不报错
- 按 instanceId 和按 instanceName 均能匹配
- 多安全组时选中排序后的第一个
- IP 未变时跳过整轮
- 上一轮有失败时不更新 `lastIp`，下一轮重新执行
- 旧 IP 规则被识别为待删、当前 IP 规则被保留
- `SYNC_INTERVAL` 解析：`5m` / `30s` / `300` / 非法值
- `REGIONS` 未设置时回落到 shared 默认列表，设置后按逗号切分并去除空白
- `IP_ENDPOINT` 未设置时 `getPublicIp()` 仍请求内置常量地址

## 13. 对既有模块的影响

| 模块 | 影响 |
|------|------|
| `@gd/shared` | 新增 `machine-firewall.js`；`firewall-rule.js` 增加 `GD_JOB_RULE_PREFIX`、`buildManagedJobRemark`、`isManagedJobRemark`，并把 `gd-job` 加入 `isOurManagedRemark`；新增共享的默认地域列表供 `REGIONS` 使用；`public-ip.js` 的 `getPublicIp()` 增加可选 `{ endpoint }` 参数，缺省回落到 `IP_ENDPOINT` 环境变量、再回落到内置常量，`@gd/cli` 的现有无参调用不受影响 |
| `@gd/web` | `app/service/aliyun.js` 改为委托 shared，对外行为不变；11 个测试迁出；`config/config.default.js` 的地域列表改为读 `REGIONS`（未设置时取 shared 默认值，即今天的同一份列表） |
| `@gd/scheduler` | 无改动。已验证 `isOurManagedRemark` 的变化不影响其行为（见 §3.1） |
| `@gd/cli` | 无改动 |

最大风险是 §4.1 的提取重构动到了安全敏感的既有代码。缓解手段是迁移过程中保持用例断言不变，只改被调用者的路径——迁移后的用例若全部通过，即证明行为未变。

## 14. 开放项

镜像是否发布到 GHCR，以及对应的 GitHub Actions workflow，不在本次范围内，留待后续 PR。
