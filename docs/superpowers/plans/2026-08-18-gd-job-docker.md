# gd-job Docker 白名单同步程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个可 `docker compose up -d` 部署在 NAS / Homelab 上的常驻程序，定时把家庭公网 IP 同步到阿里云 ECS / 轻量应用服务器防火墙白名单，并清理自己留下的旧 IP 规则。

**Architecture:** 把 `@gd/web` 中约 240 行阿里云操作逻辑提取到 `@gd/shared/src/machine-firewall.js` 成为无框架依赖的纯函数，web 与新增的 `@gd/job` 共用同一份代码；`@gd/job` 以 `gd-job:<label>` 前缀独占自己的规则，按「源 IP 不等于当前 IP」而非时间判定旧规则。

**Tech Stack:** Node.js 20、npm workspaces、`@alicloud/ecs20140526` 6.1.0、`@alicloud/swas-open20200601` 4.0.0、`egg-bin test`（mocha + `assert`）、Docker。

**Spec:** `docs/superpowers/specs/2026-08-18-gd-job-design.md`

## Global Constraints

- 规则前缀契约：`@gd/job` 只创建、只修改、只删除备注形如 `gd-job:<label>@<时间戳>` 的规则。绝不碰 `gd-web` / `gd-ddns` / `gd-cli` 前缀的规则，也绝不碰任何不符合托管格式的手工规则。
- 端口固定 `1/65535`（`PORT_RANGE`），协议固定 `['TCP','UDP']`（`RULE_PROTOCOLS`），不做成配置项。
- 时间戳格式固定为 `YYYY-MM-DD HH:mm:ss`，一律用 `@gd/shared/src/firewall-rule` 的 `formatDateTime()` 生成，不自行拼接。
- fail-closed：列举规则失败时，既不新增也不删除该机器的任何规则，并把该机器标记为本轮失败。
- 环境变量命名不带模块前缀（无 `GD_JOB_` / `GD_` 前缀），与 `ACCESS_KEY_ID` / `PASSWORD` / `JWT_SECRET` 一致。代码常量 `GD_JOB_RULE_PREFIX` 不在此列，保持模块专属。
- 测试用 `egg-bin test` + Node 内置 `assert`，不引入新框架、不引入 mock 库。SDK 打桩沿用 `packages/web/test/app/service/aliyun.test.js` 现有的 `require.cache` 注入手法。
- 每个 task 结束时 `npm test` 全绿（当前基线 76 passing）。
- 提交走 PR，不直接 push `main`。分支 `feat/gd-job-docker` 已建。

## File Structure

| 文件 | 职责 |
|------|------|
| `packages/shared/src/firewall-rule.js`（改） | 增加 `GD_JOB_RULE_PREFIX` / `buildManagedJobRemark` / `isManagedJobRemark`，`isOurManagedRemark` 纳入 `gd-job` |
| `packages/shared/src/regions.js`（新建） | 共享默认地域列表 + `resolveRegions()` |
| `packages/shared/src/public-ip.js`（改） | `getPublicIp({ endpoint })` 三级回落 |
| `packages/shared/src/machine-firewall.js`（新建） | 列机器、加规则、删规则的纯函数，web 与 job 共用 |
| `packages/web/app/service/aliyun.js`（改） | 变成委托层，只留 Egg 配置读取与响应文案拼装 |
| `packages/web/config/config.default.js`（改） | 地域列表改读 `resolveRegions()` |
| `packages/job/src/config.js`（新建） | 环境变量 → 配置对象 + 校验 |
| `packages/job/src/machines.js`（新建） | allow/deny 筛选、缺失项识别、安全组选取 |
| `packages/job/src/sync.js`（新建） | 单轮同步编排 |
| `packages/job/bin/gd-job.js`（新建） | 入口 + 定时循环 |
| `packages/job/Dockerfile`（新建） | 镜像构建 |
| `packages/job/docker-compose.example.yml`（新建） | 部署示例 |
| `README.md`（改） | 增加 Docker 部署一节 |

---

### Task 1: `@gd/shared` 增加 gd-job 规则前缀与匹配

**Files:**
- Modify: `packages/shared/src/firewall-rule.js`
- Test: `packages/shared/test/firewall-rule.test.js`

**Interfaces:**
- Consumes: 该文件已有的 `hasRemarkPrefix(value, prefix)`、`formatDateTime()`、`parseRuleTimestamp(value)`
- Produces:
  - `GD_JOB_RULE_PREFIX: string`（值 `'gd-job'`）
  - `buildManagedJobRemark(label: string, timestamp?: string) => string`
  - `isManagedJobRemark(value: string, label: string) => boolean`
  - `isOurManagedRemark(value: string) => boolean`（行为扩展：额外接受 `gd-job:` 开头且时间戳合法的备注）

- [ ] **Step 1: 写失败的测试**

在 `packages/shared/test/firewall-rule.test.js` 的 import 解构里加入 `GD_JOB_RULE_PREFIX`、`buildManagedJobRemark`、`isManagedJobRemark`，并在文件末尾 `describe` 内追加：

```js
  it('builds and matches gd-job remarks scoped by label', () => {
    assert.strictEqual(GD_JOB_RULE_PREFIX, 'gd-job');
    assert.strictEqual(
      buildManagedJobRemark('home', '2026-08-18 09:00:00'),
      'gd-job:home@2026-08-18 09:00:00'
    );

    // 认自己的 label
    assert.strictEqual(isManagedJobRemark('gd-job:home@2026-08-18 09:00:00', 'home'), true);

    // 不认别的 label —— 多站点隔离的关键
    assert.strictEqual(isManagedJobRemark('gd-job:office@2026-08-18 09:00:00', 'home'), false);

    // 前缀相同但 label 更长，不能误判
    assert.strictEqual(isManagedJobRemark('gd-job:home2@2026-08-18 09:00:00', 'home'), false);

    // 不认其他模块的规则
    assert.strictEqual(isManagedJobRemark('gd-web@2026-08-18 09:00:00', 'home'), false);
    assert.strictEqual(isManagedJobRemark('gd-cli:home@2026-08-18 09:00:00', 'home'), false);
    assert.strictEqual(isManagedJobRemark('云谷园区', 'home'), false);
  });

  it('treats gd-job remarks as ours in the fail-closed guard', () => {
    assert.strictEqual(isOurManagedRemark('gd-job:home@2026-08-18 09:00:00'), true);

    // 时间戳非法 → 不认，避免误删手工规则
    assert.strictEqual(isOurManagedRemark('gd-job:home@invalid'), false);
    assert.strictEqual(isOurManagedRemark('gd-job:home'), false);

    // 前缀相近但不是我们的
    assert.strictEqual(isOurManagedRemark('gd-jobx:home@2026-08-18 09:00:00'), false);
  });

  it('keeps gd-job rules out of the web expiry sweep', () => {
    // gd-job 规则即使很旧，也不该被 web 的 24h TTL 判定命中
    assert.strictEqual(isExpiredWebRule({
      protocol: 'TCP',
      port: PORT_RANGE,
      remark: 'gd-job:home@2020-01-01 00:00:00',
    }), false);
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @gd/shared
```

预期：FAIL，报 `GD_JOB_RULE_PREFIX` 为 `undefined`（`assert.strictEqual(undefined, 'gd-job')`）。

- [ ] **Step 3: 实现**

在 `packages/shared/src/firewall-rule.js` 的常量区，`GD_CLI_RULE_PREFIX` 那一行之后加入：

```js
const GD_JOB_RULE_PREFIX = 'gd-job';
```

在 `isManagedCliRemark` 函数之后加入：

```js
function buildManagedJobRemark(label, timestamp = formatDateTime()) {
  return `${GD_JOB_RULE_PREFIX}:${label}@${timestamp}`;
}

function isManagedJobRemark(value, label) {
  return hasRemarkPrefix(value, `${GD_JOB_RULE_PREFIX}:${label}`);
}
```

`gd-job` 是新前缀，历史上不存在无前缀的旧格式，因此不设 `isLegacyManagedJobRemark`。

修改 `isOurManagedRemark`，在 return 的布尔表达式中追加一行：

```js
function isOurManagedRemark(value) {
  if (typeof value !== 'string' || !value) return false;
  if (parseRuleTimestamp(value) === null) return false;
  return (
    hasRemarkPrefix(value, GD_WEB_RULE_PREFIX) ||
    value.startsWith(`${GD_DDNS_RULE_PREFIX}:`) ||
    value.startsWith(`${GD_CLI_RULE_PREFIX}:`) ||
    value.startsWith(`${GD_JOB_RULE_PREFIX}:`)
  );
}
```

在 `module.exports` 中加入 `GD_JOB_RULE_PREFIX`、`buildManagedJobRemark`、`isManagedJobRemark`。

- [ ] **Step 4: 运行全部测试**

```bash
npm test
```

预期：PASS。特别确认 `@gd/web` 与 `@gd/scheduler` 的用例全绿——`isOurManagedRemark` 是它们的 fail-closed 守卫，行为扩展后不得影响既有判定。

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/firewall-rule.js packages/shared/test/firewall-rule.test.js
git commit -m "feat(shared): add gd-job rule prefix and label-scoped remark matchers"
```

---

### Task 2: `@gd/shared` 统一地域列表与公网 IP 地址来源

**Files:**
- Create: `packages/shared/src/regions.js`
- Create: `packages/shared/test/regions.test.js`
- Modify: `packages/shared/src/public-ip.js`
- Modify: `packages/web/config/config.default.js:74-85`
- Test: `packages/shared/test/public-ip.test.js`（新建）

**Interfaces:**
- Produces:
  - `DEFAULT_REGIONS: string[]`（十个地域）
  - `resolveRegions(value?: string) => string[]`（`value` 缺省取 `process.env.REGIONS`，再缺省取 `DEFAULT_REGIONS`）
  - `getPublicIp(options?: { endpoint?: string }) => Promise<string>`（`endpoint` 缺省取 `process.env.IP_ENDPOINT`，再缺省取 `IP_ENDPOINT` 常量）

- [ ] **Step 1: 写失败的测试**

新建 `packages/shared/test/regions.test.js`：

```js
'use strict';

const assert = require('assert');
const { DEFAULT_REGIONS, resolveRegions } = require('../src/regions');

describe('regions', () => {
  it('exposes the ten default regions', () => {
    assert.deepStrictEqual(DEFAULT_REGIONS, [
      'cn-hangzhou', 'cn-shanghai', 'cn-beijing', 'cn-shenzhen', 'cn-hongkong',
      'ap-northeast-1', 'ap-southeast-1', 'us-west-1', 'us-east-1', 'eu-central-1',
    ]);
  });

  it('falls back to defaults when unset or blank', () => {
    assert.deepStrictEqual(resolveRegions(undefined), DEFAULT_REGIONS);
    assert.deepStrictEqual(resolveRegions(''), DEFAULT_REGIONS);
    assert.deepStrictEqual(resolveRegions('   '), DEFAULT_REGIONS);
  });

  it('splits on comma and trims blanks', () => {
    assert.deepStrictEqual(resolveRegions('cn-hangzhou,cn-hongkong'), [ 'cn-hangzhou', 'cn-hongkong' ]);
    assert.deepStrictEqual(resolveRegions(' cn-hangzhou , , cn-hongkong '), [ 'cn-hangzhou', 'cn-hongkong' ]);
  });

  it('reads process.env.REGIONS when no argument is given', () => {
    const previous = process.env.REGIONS;
    try {
      process.env.REGIONS = 'us-west-1';
      assert.deepStrictEqual(resolveRegions(), [ 'us-west-1' ]);
      delete process.env.REGIONS;
      assert.deepStrictEqual(resolveRegions(), DEFAULT_REGIONS);
    } finally {
      if (previous === undefined) delete process.env.REGIONS;
      else process.env.REGIONS = previous;
    }
  });
});
```

新建 `packages/shared/test/public-ip.test.js`：

```js
'use strict';

const assert = require('assert');
const { getPublicIp, extractIpv4, IP_ENDPOINT } = require('../src/public-ip');

describe('public-ip', () => {
  it('parses ipv4 out of a noisy response', () => {
    assert.strictEqual(extractIpv4('1.2.3.4%'), '1.2.3.4');
    assert.strictEqual(extractIpv4('\n 140.205.11.246 \n'), '140.205.11.246');
    assert.strictEqual(extractIpv4('999.1.1.1'), null);
    assert.strictEqual(extractIpv4('nope'), null);
  });

  it('requests the built-in endpoint by default', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async url => {
      calls.push(url);
      return { ok: true, async text() { return '1.2.3.4'; } };
    };
    try {
      assert.strictEqual(await getPublicIp(), '1.2.3.4');
      assert.deepStrictEqual(calls, [ IP_ENDPOINT ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('prefers the explicit endpoint, then IP_ENDPOINT env, then the constant', async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const previous = process.env.IP_ENDPOINT;
    global.fetch = async url => {
      calls.push(url);
      return { ok: true, async text() { return '1.2.3.4'; } };
    };
    try {
      process.env.IP_ENDPOINT = 'https://env.example.com';

      await getPublicIp({ endpoint: 'https://arg.example.com' });
      assert.strictEqual(calls[0], 'https://arg.example.com');

      await getPublicIp();
      assert.strictEqual(calls[1], 'https://env.example.com');

      delete process.env.IP_ENDPOINT;
      await getPublicIp();
      assert.strictEqual(calls[2], IP_ENDPOINT);
    } finally {
      global.fetch = originalFetch;
      if (previous === undefined) delete process.env.IP_ENDPOINT;
      else process.env.IP_ENDPOINT = previous;
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @gd/shared
```

预期：FAIL，`Cannot find module '../src/regions'`。

- [ ] **Step 3: 实现**

新建 `packages/shared/src/regions.js`：

```js
'use strict';

// 扫描实例时覆盖的地域。web 与 job 共用同一份，避免两处维护。
const DEFAULT_REGIONS = [
  'cn-hangzhou',
  'cn-shanghai',
  'cn-beijing',
  'cn-shenzhen',
  'cn-hongkong',
  'ap-northeast-1',
  'ap-southeast-1',
  'us-west-1',
  'us-east-1',
  'eu-central-1',
];

function resolveRegions(value = process.env.REGIONS) {
  const list = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_REGIONS;
}

module.exports = { DEFAULT_REGIONS, resolveRegions };
```

改 `packages/shared/src/public-ip.js` 的 `getPublicIp`：

```js
async function getPublicIp({ endpoint } = {}) {
  const target = endpoint || process.env.IP_ENDPOINT || IP_ENDPOINT;
  const resp = await fetch(target, { headers: { accept: 'text/plain' } });
  if (!resp.ok) throw new Error(`Failed to fetch public ip: ${resp.status}`);
  const text = await resp.text();
  const ip = extractIpv4(text);
  if (!ip) throw new Error(`Failed to parse ip from response: ${JSON.stringify(text)}`);
  return ip;
}
```

`@gd/cli` 里 `getPublicIp()` 的无参调用不受影响。

改 `packages/web/config/config.default.js`，在文件顶部 require 区加入：

```js
const { resolveRegions } = require('@gd/shared/src/regions');
```

把 `config.aliyun` 中 `regions:` 那十行字面量替换为：

```js
    // Common regions to scan for instances（默认值在 @gd/shared/src/regions.js，可用 REGIONS 覆盖）
    regions: resolveRegions(),
```

- [ ] **Step 4: 运行全部测试**

```bash
npm test
```

预期：PASS。

- [ ] **Step 5: 人工确认 web 行为未变**

```bash
node -e "
const { resolveRegions } = require('@gd/shared/src/regions');
const before = ['cn-hangzhou','cn-shanghai','cn-beijing','cn-shenzhen','cn-hongkong','ap-northeast-1','ap-southeast-1','us-west-1','us-east-1','eu-central-1'];
console.assert(JSON.stringify(resolveRegions()) === JSON.stringify(before), 'regions changed!');
console.log('✅ 未设置 REGIONS 时与改造前的硬编码列表逐项一致');
"
```

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src/regions.js packages/shared/test/regions.test.js \
        packages/shared/src/public-ip.js packages/shared/test/public-ip.test.js \
        packages/web/config/config.default.js
git commit -m "feat(shared): share region list and allow IP_ENDPOINT override"
```

---

### Task 3: 把阿里云操作逻辑提取到 `@gd/shared/src/machine-firewall.js`

本 task 只新增 shared 侧代码与测试，暂不改动 `packages/web/app/service/aliyun.js`。两份代码短暂并存，Task 4 再删除 web 侧副本——这样任何时刻都不存在无测试覆盖的代码。

**Files:**
- Create: `packages/shared/src/machine-firewall.js`
- Create: `packages/shared/test/machine-firewall.test.js`
- Modify: `packages/shared/package.json`（无需改动依赖，`@alicloud/*` 已在其 dependencies 中，确认即可）

**Interfaces:**
- Consumes: `./firewall-rule` 的 `PORT_RANGE` / `RULE_PROTOCOLS` / `getRuleField` / `findRuleByProtocolPortSource` / `isOurManagedRemark`；`./swas-firewall` 的 `listAllFirewallRules`；`./ecs-firewall` 的 `listSecurityGroupRules`
- Produces:
  - `listMachines({ credential, regions, logger? }) => Promise<Machine[]>`
  - `listMachineRules({ credential, machine }) => Promise<object[]>`
  - `addIpRules({ credential, machine, sourceCidrIp, remark, rules?, logger? }) => Promise<{ status: 'success'|'partial'|'error', message: string, protocols?: { TCP?: 'added'|'exists'|'failed', UDP?: 'added'|'exists'|'failed' } }>`（预检失败 / 不支持的 product 时无 `protocols`）
  - `cleanupRules({ credential, machine, shouldDelete, rules?, logger? }) => Promise<{ deletedCount: number }>`
  - `Machine` 形状：`{ product: 'ecs'|'swas-open', instanceId, instanceName, regionId, publicIpAddress: string[], status, securityGroupIds?: string[], securityGroupId?: string, tags: {key,value}[] }`

- [ ] **Step 1: 写失败的测试**

新建 `packages/shared/test/machine-firewall.test.js`。整体骨架照搬 `packages/web/test/app/service/aliyun.test.js` 的 `require.cache` 打桩手法，把被测目标从 Service 换成纯函数：

```js
'use strict';

const assert = require('assert');
const { PORT_RANGE } = require('../src/firewall-rule');

function loadMachineFirewallWithMocks({ ecsRules = [], swasRules = [], ecsListError = null, swasListError = null } = {}) {
  const modulePath = require.resolve('../src/machine-firewall');
  const ecsSdkPath = require.resolve('@alicloud/ecs20140526');
  const swasSdkPath = require.resolve('@alicloud/swas-open20200601');
  const swasFirewallPath = require.resolve('../src/swas-firewall');
  const ecsFirewallPath = require.resolve('../src/ecs-firewall');

  const previousCache = new Map([
    [ modulePath, require.cache[modulePath] ],
    [ ecsSdkPath, require.cache[ecsSdkPath] ],
    [ swasSdkPath, require.cache[swasSdkPath] ],
    [ swasFirewallPath, require.cache[swasFirewallPath] ],
    [ ecsFirewallPath, require.cache[ecsFirewallPath] ],
  ]);

  const ecsClients = [];
  const swasClients = [];

  class BaseRequest {
    constructor(fields) { Object.assign(this, fields); }
  }

  class FakeECSClient {
    constructor() {
      this.authorizeCalls = [];
      this.revokeCalls = [];
      this.listCalls = [];
      ecsClients.push(this);
    }
    async describeSecurityGroupAttribute(req) {
      this.listCalls.push(req);
      if (ecsListError) throw ecsListError;
      return { body: { permissions: { permission: ecsRules.map(rule => ({ ...rule })) } } };
    }
    async authorizeSecurityGroup(req) { this.authorizeCalls.push(req); return { body: {} }; }
    async revokeSecurityGroup(req) { this.revokeCalls.push(req); return { body: {} }; }
  }

  class FakeSWASClient {
    constructor() {
      this.createCalls = [];
      this.deleteCalls = [];
      swasClients.push(this);
    }
    async createFirewallRules(req) { this.createCalls.push(req); return { body: {} }; }
    async deleteFirewallRules(req) { this.deleteCalls.push(req); return { body: {} }; }
  }

  require.cache[ecsSdkPath] = {
    id: ecsSdkPath, filename: ecsSdkPath, loaded: true,
    exports: {
      default: FakeECSClient,
      DescribeInstancesRequest: BaseRequest,
      // ecs-firewall.js 在模块加载时解构这个类；漏掉它会让 ECS 列举抛 TypeError，
      // 被 fail-closed 吞成 error 状态，用例会以错误的原因失败
      DescribeSecurityGroupAttributeRequest: BaseRequest,
      AuthorizeSecurityGroupRequest: BaseRequest,
      RevokeSecurityGroupRequest: BaseRequest,
    },
  };
  require.cache[swasSdkPath] = {
    id: swasSdkPath, filename: swasSdkPath, loaded: true,
    exports: {
      default: FakeSWASClient,
      ListInstancesRequest: BaseRequest,
      CreateFirewallRulesRequest: BaseRequest,
      DeleteFirewallRulesRequest: BaseRequest,
    },
  };
  require.cache[swasFirewallPath] = {
    id: swasFirewallPath, filename: swasFirewallPath, loaded: true,
    exports: {
      async listAllFirewallRules() {
        if (swasListError) throw swasListError;
        return swasRules.map(rule => ({ ...rule }));
      },
    },
  };

  // 强制 ecs-firewall 与被测模块一起重新加载，确保它们绑定到上面的假 SDK，
  // 不受同一 mocha 进程里其他测试文件加载顺序的影响
  delete require.cache[ecsFirewallPath];
  delete require.cache[modulePath];
  const machineFirewall = require('../src/machine-firewall');

  function restore() {
    for (const [ path, cached ] of previousCache) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  }

  return { machineFirewall, ecsClients, swasClients, restore };
}

const CREDENTIAL = { accessKeyId: 'ak', accessKeySecret: 'sk' };
const ECS_MACHINE = { product: 'ecs', instanceId: 'i-1', regionId: 'cn-hangzhou', securityGroupId: 'sg-1' };
const SWAS_MACHINE = { product: 'swas-open', instanceId: 'swas-1', regionId: 'cn-hangzhou' };

describe('machine-firewall addIpRules', () => {
  it('does not authorize ECS rules when a manual rule already covers the IP', async () => {
    const { machineFirewall, ecsClients, restore } = loadMachineFirewallWithMocks({
      ecsRules: [
        { ipProtocol: 'TCP', portRange: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', description: '云谷园区' },
        { ipProtocol: 'UDP', portRange: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', description: '云谷园区' },
      ],
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: ECS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.deepStrictEqual(result.protocols, { TCP: 'exists', UDP: 'exists' });
      assert.strictEqual(ecsClients[0].authorizeCalls.length, 0);
    } finally { restore(); }
  });

  it('does not create SWAS rules when a manual rule already covers the IP', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: '云谷园区', ruleId: 'm-1' },
        { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: '云谷园区', ruleId: 'm-2' },
      ],
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.strictEqual(swasClients[0].createCalls.length, 0);
    } finally { restore(); }
  });

  it('creates the rule when nothing covers the IP', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'success');
      assert.strictEqual(result.message, 'TCP: added, UDP: added');
      assert.deepStrictEqual(result.protocols, { TCP: 'added', UDP: 'added' });
      assert.strictEqual(swasClients[0].createCalls.length, 2);
      assert.strictEqual(swasClients[0].createCalls[0].firewallRules[0].remark, 'gd-job:home@2026-08-18 09:00:00');
    } finally { restore(); }
  });

  it('fails closed when ECS rule listing throws', async () => {
    const { machineFirewall, ecsClients, restore } = loadMachineFirewallWithMocks({
      ecsListError: new Error('boom'),
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: ECS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'error');
      assert.ok(result.message.includes('refusing to add to keep manual rules safe'));
      assert.strictEqual(ecsClients[0].authorizeCalls.length, 0);
    } finally { restore(); }
  });

  it('fails closed when SWAS rule listing throws', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasListError: new Error('boom'),
    });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
      });
      assert.strictEqual(result.status, 'error');
      assert.ok(result.message.includes('refusing to add to keep manual rules safe'));
      assert.strictEqual(swasClients[0].createCalls.length, 0);
    } finally { restore(); }
  });

  it('reuses caller-supplied rules instead of listing again', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = await machineFirewall.addIpRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00',
        rules: [
          { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'r1' },
          { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'r2' },
        ],
      });
      assert.strictEqual(result.message, 'TCP: already exists, UDP: already exists');
      assert.strictEqual(swasClients[0].createCalls.length, 0);
    } finally { restore(); }
  });

  it('marks partial when one protocol fails', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = machineFirewall.buildProtocolOperationResult(
        [ 'TCP: added', 'UDP: failed (boom)' ],
        { hasSuccess: true, hasFailure: true }
      );
      assert.strictEqual(result.status, 'partial');
      assert.strictEqual(result.message, 'TCP: added, UDP: failed (boom)');
    } finally { restore(); }
  });

  it('marks error when all protocols fail', async () => {
    const { machineFirewall, restore } = loadMachineFirewallWithMocks({ swasRules: [] });
    try {
      const result = machineFirewall.buildProtocolOperationResult(
        [ 'TCP: failed (boom)', 'UDP: failed (boom)' ],
        { hasSuccess: false, hasFailure: true }
      );
      assert.strictEqual(result.status, 'error');
    } finally { restore(); }
  });
});

describe('machine-firewall cleanupRules', () => {
  it('refuses to revoke ECS rules whose descriptions are not managed', async () => {
    const { machineFirewall, ecsClients, restore } = loadMachineFirewallWithMocks({
      ecsRules: [
        { ipProtocol: 'TCP', portRange: PORT_RANGE, sourceCidrIp: '9.9.9.9/32', description: '云谷园区', securityGroupRuleId: 'sgr-1' },
      ],
    });
    try {
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: ECS_MACHINE,
        shouldDelete: () => true, // 谓词说删，外层 isOurManagedRemark 守卫仍必须拦住
      });
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(ecsClients[0].revokeCalls.length, 0);
    } finally { restore(); }
  });

  it('refuses to delete SWAS rules whose remarks are not managed', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '9.9.9.9/32', remark: '云谷园区', ruleId: 'r-1' },
      ],
    });
    try {
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE, shouldDelete: () => true,
      });
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(swasClients[0].deleteCalls.length, 0);
    } finally { restore(); }
  });

  it('deletes managed rules that the predicate selects', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '5.6.7.8/32', remark: 'gd-job:home@2026-08-17 09:00:00', ruleId: 'old-1' },
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 09:00:00', ruleId: 'keep-1' },
      ],
    });
    try {
      const { getRuleField } = require('../src/firewall-rule');
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        shouldDelete: rule => getRuleField(rule, 'sourceCidrIp') !== '1.2.3.4/32',
      });
      assert.strictEqual(result.deletedCount, 1);
      assert.deepStrictEqual(swasClients[0].deleteCalls[0].ruleIds, [ 'old-1' ]);
    } finally { restore(); }
  });

  it('does delete expired gd-web rules (web TTL predicate still works)', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '9.9.9.9/32', remark: 'gd-web@2020-01-01 00:00:00', ruleId: 'stale-1' },
      ],
    });
    try {
      const { isExpiredWebRule, getRuleField } = require('../src/firewall-rule');
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        shouldDelete: rule => isExpiredWebRule({
          protocol: getRuleField(rule, 'ruleProtocol'),
          port: getRuleField(rule, 'port'),
          remark: getRuleField(rule, 'remark'),
        }),
      });
      assert.strictEqual(result.deletedCount, 1);
      assert.deepStrictEqual(swasClients[0].deleteCalls[0].ruleIds, [ 'stale-1' ]);
    } finally { restore(); }
  });

  it('does not delete gd-job rules with a different label', async () => {
    const { machineFirewall, swasClients, restore } = loadMachineFirewallWithMocks({
      swasRules: [
        { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '5.6.7.8/32', remark: 'gd-job:office@2026-08-17 09:00:00', ruleId: 'other-1' },
      ],
    });
    try {
      const { isManagedJobRemark, getRuleField } = require('../src/firewall-rule');
      const result = await machineFirewall.cleanupRules({
        credential: CREDENTIAL, machine: SWAS_MACHINE,
        shouldDelete: rule => isManagedJobRemark(getRuleField(rule, 'remark') || '', 'home'),
      });
      assert.strictEqual(result.deletedCount, 0);
      assert.strictEqual(swasClients[0].deleteCalls.length, 0);
    } finally { restore(); }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @gd/shared
```

预期：FAIL，`Cannot find module '../src/machine-firewall'`。

- [ ] **Step 3: 实现**

新建 `packages/shared/src/machine-firewall.js`。内容是把 `packages/web/app/service/aliyun.js` 中的 `_listEcsInstances` / `_listSwasInstances` / `listMachines` / `_addIpToEcs` / `_addIpToSwas` / `_cleanupExpiredEcsRules` / `_cleanupExpiredSwasRules` / `_buildProtocolOperationResult` 改写为纯函数，`this.logger` 换成注入的 `logger`，硬编码的 `gd-web` 判定换成注入的 `remark` 与 `shouldDelete`：

```js
'use strict';

const {
  default: ECSClient,
  DescribeInstancesRequest,
  AuthorizeSecurityGroupRequest,
  RevokeSecurityGroupRequest,
} = require('@alicloud/ecs20140526');
const {
  default: SWASClient,
  ListInstancesRequest,
  CreateFirewallRulesRequest,
  DeleteFirewallRulesRequest,
} = require('@alicloud/swas-open20200601');
const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  getRuleField,
  isOurManagedRemark,
  findRuleByProtocolPortSource,
} = require('./firewall-rule');
const { listAllFirewallRules } = require('./swas-firewall');
const { listSecurityGroupRules } = require('./ecs-firewall');

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };

// 每个 product 的字段名差异集中在这里，其余逻辑共用
const FIELDS = {
  ecs: { protocol: 'ipProtocol', port: 'portRange', remark: 'description', ruleId: 'securityGroupRuleId' },
  'swas-open': { protocol: 'ruleProtocol', port: 'port', remark: 'remark', ruleId: 'ruleId' },
};

function ecsClient(credential, regionId) {
  return new ECSClient({ endpoint: `ecs.${regionId}.aliyuncs.com`, ...credential });
}

function swasClient(credential, regionId) {
  return new SWASClient({ endpoint: `swas.${regionId}.aliyuncs.com`, regionId, ...credential });
}

async function listEcsInstances({ credential, regionId }) {
  const resp = await ecsClient(credential, regionId)
    .describeInstances(new DescribeInstancesRequest({ regionId, pageSize: 100 }));
  const instances = resp?.body?.instances?.instance || [];
  return instances.map(inst => ({
    product: 'ecs',
    instanceId: inst.instanceId,
    instanceName: inst.instanceName || inst.hostName || inst.instanceId,
    regionId,
    publicIpAddress: inst.publicIpAddress?.ipAddress || [],
    status: inst.status,
    securityGroupIds: inst.securityGroupIds?.securityGroupId || [],
    tags: (inst.tags?.tag || []).map(t => ({ key: t.tagKey, value: t.tagValue })),
  }));
}

async function listSwasInstances({ credential, regionId }) {
  const resp = await swasClient(credential, regionId)
    .listInstances(new ListInstancesRequest({ regionId, pageSize: 100 }));
  const instances = resp?.body?.instances || [];
  return instances.map(inst => ({
    product: 'swas-open',
    instanceId: inst.instanceId,
    instanceName: inst.instanceName || inst.instanceId,
    regionId,
    publicIpAddress: inst.publicIpAddress ? [ inst.publicIpAddress ] : [],
    status: inst.status,
    tags: (inst.tags || []).map(t => ({ key: t.key, value: t.value })),
  }));
}

async function listMachines({ credential, regions, logger = NOOP_LOGGER }) {
  const promises = [];
  for (const regionId of regions) {
    promises.push(listEcsInstances({ credential, regionId }));
    promises.push(listSwasInstances({ credential, regionId }));
  }

  const machines = [];
  const results = await Promise.allSettled(promises);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) machines.push(...result.value);
    else if (result.status === 'rejected') {
      logger.warn('[machine-firewall] Failed to list instances:', result.reason?.message || result.reason);
    }
  }
  return machines;
}

function clientFor(credential, machine) {
  return machine.product === 'ecs'
    ? ecsClient(credential, machine.regionId)
    : swasClient(credential, machine.regionId);
}

// client 可选：addIpRules / cleanupRules 会把自己的 client 传进来，一次操作只建一个 client
async function listMachineRules({ credential, machine, client = clientFor(credential, machine) }) {
  if (machine.product === 'ecs') {
    return listSecurityGroupRules({
      client,
      securityGroupId: machine.securityGroupId,
      regionId: machine.regionId,
    });
  }
  return listAllFirewallRules({
    client,
    instanceId: machine.instanceId,
    regionId: machine.regionId,
  });
}

function buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure }) {
  let status = 'success';
  if (hasFailure && hasSuccess) status = 'partial';
  else if (hasFailure) status = 'error';
  return { status, message: protocolResults.join(', ') };
}

async function addIpRules({ credential, machine, sourceCidrIp, remark, rules = null, logger = NOOP_LOGGER }) {
  const { product, regionId, instanceId, securityGroupId } = machine;
  if (product === 'ecs' && !securityGroupId) {
    return { status: 'error', message: 'securityGroupId is required for ECS' };
  }
  if (!FIELDS[product]) {
    return { status: 'error', message: `Unsupported product: ${product}` };
  }

  const label = product === 'ecs' ? 'ECS' : 'SWAS';
  const client = clientFor(credential, machine);
  let existingRules = rules;
  if (!existingRules) {
    try {
      existingRules = await listMachineRules({ credential, machine, client });
    } catch (err) {
      logger.error(`[machine-firewall] Failed to list ${label} rules for pre-check on ${instanceId}:`, err.message || err);
      return {
        status: 'error',
        message: `Failed to list ${label} rules: ${err.message || err}; refusing to add to keep manual rules safe`,
      };
    }
  }

  const fields = FIELDS[product];
  const protocolResults = [];
  // 按协议记录结果：'added' | 'exists' | 'failed'。job 用它区分"已存在的是不是自己的规则"
  const protocols = {};
  let hasSuccess = false;
  let hasFailure = false;

  for (const protocol of RULE_PROTOCOLS) {
    const existing = findRuleByProtocolPortSource({
      rules: existingRules,
      protocol,
      sourceCidrIp,
      protocolField: fields.protocol,
      portField: fields.port,
    });

    if (existing) {
      protocolResults.push(`${protocol}: already exists`);
      protocols[protocol] = 'exists';
      hasSuccess = true;
      continue;
    }

    try {
      if (product === 'ecs') {
        await client.authorizeSecurityGroup(new AuthorizeSecurityGroupRequest({
          regionId, securityGroupId,
          ipProtocol: protocol, portRange: PORT_RANGE, sourceCidrIp,
          description: remark,
        }));
      } else {
        await client.createFirewallRules(new CreateFirewallRulesRequest({
          instanceId, regionId,
          firewallRules: [{ port: PORT_RANGE, ruleProtocol: protocol, sourceCidrIp, remark }],
        }));
      }
      protocolResults.push(`${protocol}: added`);
      protocols[protocol] = 'added';
      hasSuccess = true;
    } catch (err) {
      const message = err.message || '';
      if (message.includes('AuthorizationAlreadyExist') ||
          message.includes('RuleDuplicate') ||
          message.includes('FirewallRuleAlreadyExist')) {
        protocolResults.push(`${protocol}: already exists`);
        protocols[protocol] = 'exists';
        hasSuccess = true;
        continue;
      }
      protocolResults.push(`${protocol}: failed (${message})`);
      protocols[protocol] = 'failed';
      hasFailure = true;
    }
  }

  return { ...buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure }), protocols };
}

async function cleanupRules({ credential, machine, shouldDelete, rules = null, logger = NOOP_LOGGER }) {
  const { product, regionId, instanceId, securityGroupId } = machine;
  if (product === 'ecs' && !securityGroupId) return { deletedCount: 0 };
  if (!FIELDS[product]) return { deletedCount: 0 };

  const fields = FIELDS[product];
  const client = clientFor(credential, machine);
  const existingRules = rules || await listMachineRules({ credential, machine, client });

  // isOurManagedRemark 是 fail-closed 外层守卫：谓词再宽也不会碰到手工规则
  const staleRules = existingRules.filter(rule => {
    const remark = getRuleField(rule, fields.remark);
    if (!isOurManagedRemark(remark)) return false;
    return shouldDelete(rule);
  });
  const staleRuleIds = staleRules.map(rule => getRuleField(rule, fields.ruleId)).filter(Boolean);
  if (staleRuleIds.length === 0) return { deletedCount: 0 };

  logger.info(`[machine-firewall] Cleaning up ${staleRuleIds.length} rule(s) on ${instanceId || securityGroupId}: ${staleRules.map(r => getRuleField(r, fields.remark)).join(', ')}`);

  if (product === 'ecs') {
    await client.revokeSecurityGroup(new RevokeSecurityGroupRequest({
      regionId, securityGroupId, securityGroupRuleId: staleRuleIds,
    }));
  } else {
    await client.deleteFirewallRules(new DeleteFirewallRulesRequest({
      instanceId, regionId, ruleIds: staleRuleIds,
    }));
  }
  return { deletedCount: staleRuleIds.length };
}

module.exports = {
  listMachines,
  listEcsInstances,
  listSwasInstances,
  listMachineRules,
  addIpRules,
  cleanupRules,
  buildProtocolOperationResult,
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w @gd/shared
```

预期：PASS，新增 13 个用例。

- [ ] **Step 5: 运行全部测试**

```bash
npm test
```

预期：PASS。此时 web 仍用自己那份代码，测试数应为 76 + 新增。

- [ ] **Step 6: 提交**

```bash
git add packages/shared/src/machine-firewall.js packages/shared/test/machine-firewall.test.js
git commit -m "feat(shared): extract machine firewall operations into framework-free module"
```

---

### Task 4: `@gd/web` 改为委托 shared

**Files:**
- Modify: `packages/web/app/service/aliyun.js`
- Modify: `packages/web/test/app/service/aliyun.test.js`

**Interfaces:**
- Consumes: Task 3 的 `listMachines` / `addIpRules` / `cleanupRules`
- Produces: `AliyunService` 对外方法签名与返回值完全不变——`listMachines()`、`addIpToWhitelist(ip, machines)`、`_tryCleanupExpiredWebRules(credential, machine)`、`_appendCleanupMessage(message, cleanup)`

- [ ] **Step 1: 先确认现有行为基线**

```bash
npm test -w @gd/web 2>&1 | tail -5
```

记下通过数（应为 45）。本 task 结束时，扣除迁走的 11 个用例后应为 34。

- [ ] **Step 2: 改写 service**

把 `packages/web/app/service/aliyun.js` 替换为：

```js
'use strict';

const { Service } = require('egg');
const { resolveCredentials } = require('@gd/shared/src/aliyun-conf');
const {
  GD_WEB_RULE_PREFIX,
  toSourceCidrIp,
  formatDateTime,
  getRuleField,
  isExpiredWebRule,
} = require('@gd/shared/src/firewall-rule');
const {
  listMachines,
  addIpRules,
  cleanupRules,
} = require('@gd/shared/src/machine-firewall');

// 不同 product 的协议/端口/备注字段名，用于构造 TTL 判定谓词
const EXPIRY_FIELDS = {
  ecs: { protocol: 'ipProtocol', port: 'portRange', remark: 'description' },
  'swas-open': { protocol: 'ruleProtocol', port: 'port', remark: 'remark' },
};

class AliyunService extends Service {

  /**
   * Resolve AK/SK from config, env, or .aliyun.conf
   */
  getCredential() {
    const { accessKeyId, accessKeySecret } = this.config.aliyun;
    if (accessKeyId && accessKeySecret) {
      return { accessKeyId, accessKeySecret };
    }
    const cred = resolveCredentials({ cwd: this.app.baseDir });
    if (!cred.accessKeyId || !cred.accessKeySecret) {
      throw new Error('Missing Alibaba Cloud credentials. Set ACCESS_KEY_ID/ACCESS_KEY_SECRET env vars or create .aliyun.conf');
    }
    return { accessKeyId: cred.accessKeyId, accessKeySecret: cred.accessKeySecret };
  }

  /**
   * List all user machines across regions (ECS + SWAS)
   */
  async listMachines() {
    return listMachines({
      credential: this.getCredential(),
      regions: this.config.aliyun.regions || [],
      logger: this.logger,
    });
  }

  /**
   * Add an IP to the whitelist of selected machines
   */
  async addIpToWhitelist(ip, machines) {
    const credential = this.getCredential();
    const sourceCidrIp = toSourceCidrIp(ip);
    const remark = `${GD_WEB_RULE_PREFIX}@${formatDateTime()}`;
    const results = [];

    for (const machine of machines) {
      if (!EXPIRY_FIELDS[machine.product]) {
        results.push({ ...machine, status: 'skipped', message: `Unsupported product: ${machine.product}` });
        continue;
      }
      try {
        // web 是先清后加，且两步各自列举规则。绝不能像 job 那样把一份列举结果传给 addIpRules 的 rules 参数：
        // 清理若删掉了一条与当前 IP 相同的过期 gd-web 规则，过期的列举结果仍会让预检误判"已存在"而不再新增，
        // 该 IP 就会失去访问。
        const cleanup = await this._tryCleanupExpiredWebRules(credential, machine);
        const result = await addIpRules({ credential, machine, sourceCidrIp, remark, logger: this.logger });
        result.message = this._appendCleanupMessage(result.message, cleanup);
        results.push({ ...machine, ...result });
      } catch (err) {
        this.logger.error(`[aliyun] Failed to add IP for ${machine.product}/${machine.instanceId}:`, err);
        results.push({ ...machine, status: 'error', message: err.message });
      }
    }

    return results;
  }

  async _cleanupExpiredWebRules(credential, machine) {
    const fields = EXPIRY_FIELDS[machine.product];
    if (!fields) return { deletedCount: 0 };

    return cleanupRules({
      credential,
      machine,
      logger: this.logger,
      shouldDelete: rule => isExpiredWebRule({
        protocol: getRuleField(rule, fields.protocol),
        port: getRuleField(rule, fields.port),
        remark: getRuleField(rule, fields.remark),
      }),
    });
  }

  async _tryCleanupExpiredWebRules(credential, machine) {
    try {
      return await this._cleanupExpiredWebRules(credential, machine);
    } catch (err) {
      this.logger.warn(`[aliyun] Failed to cleanup expired web rules for ${machine.product}/${machine.instanceId}:`, err);
      return { deletedCount: 0, failed: true };
    }
  }

  _appendCleanupMessage(message, cleanup = {}) {
    const messageParts = [ message ];
    if (cleanup.deletedCount) {
      messageParts.push(`cleaned ${cleanup.deletedCount} expired ${GD_WEB_RULE_PREFIX} rule(s)`);
    }
    if (cleanup.failed) {
      messageParts.push('cleanup failed');
    }
    return messageParts.join('; ');
  }
}

module.exports = AliyunService;
```

- [ ] **Step 3: 删除迁走的测试**

在 `packages/web/test/app/service/aliyun.test.js` 中删除以下 11 个用例及其不再被引用的 `loadAliyunServiceWithMocks` 辅助函数（这些行为已由 `packages/shared/test/machine-firewall.test.js` 覆盖）：

- `describe('AliyunService manual rule protection')` 整块（9 个用例）
- `describe('AliyunService cleanup handling')` 中的 `marks protocol results as partial when only some protocols succeed`
- 同 describe 中的 `marks protocol results as error when all protocols fail`

保留：
- `treats cleanup errors as best-effort failures`（`_tryCleanupExpiredWebRules` 的降级语义）
- `appends cleanup outcome to the result message`（`_appendCleanupMessage` 文案）

同时删除文件顶部不再被引用的 `const { PORT_RANGE } = require('@gd/shared/src/firewall-rule');`。

保留的第一个用例需改写为不依赖 SDK 打桩：

```js
  it('treats cleanup errors as best-effort failures', async () => {
    const warnings = [];
    const cleanup = await AliyunService.prototype._tryCleanupExpiredWebRules.call({
      logger: { warn: (...args) => warnings.push(args) },
      async _cleanupExpiredWebRules() { throw new Error('boom'); },
    }, {}, { product: 'swas-open', instanceId: 'swas-1' });

    assert.deepStrictEqual(cleanup, { deletedCount: 0, failed: true });
    assert.strictEqual(warnings.length, 1);
  });
```

- [ ] **Step 4: 运行 web 测试**

```bash
npm test -w @gd/web 2>&1 | tail -5
```

预期：PASS，34 passing。

- [ ] **Step 5: 运行全部测试**

```bash
npm test
```

预期：PASS，且总数不低于 Task 3 结束时。

- [ ] **Step 6: 提交**

```bash
git add packages/web/app/service/aliyun.js packages/web/test/app/service/aliyun.test.js
git commit -m "refactor(web): delegate aliyun firewall operations to @gd/shared"
```

---

### Task 5: `@gd/job` 包骨架与配置解析

**Files:**
- Create: `packages/job/package.json`
- Create: `packages/job/src/config.js`
- Create: `packages/job/test/config.test.js`

根 `package.json` 的 `workspaces` 是 glob `["packages/*"]`，新建 `packages/job/` 后跑一次 `npm install` 即自动纳入，无需改动根清单。

**Interfaces:**
- Produces:
  - `parseInterval(value?: string) => number`（秒；非法值抛 `Error`）
  - `parseList(value?: string) => string[]`
  - `loadConfig(env?: object) => { credential: { accessKeyId, accessKeySecret }, allow: string[], deny: string[], intervalSeconds: number, regions: string[], label: string, ipEndpoint: string|undefined }`（缺 AK/SK 抛 `Error`）

- [ ] **Step 1: 写失败的测试**

新建 `packages/job/test/config.test.js`：

```js
'use strict';

const assert = require('assert');
const { loadConfig, parseInterval, parseList } = require('../src/config');
const { DEFAULT_REGIONS } = require('@gd/shared/src/regions');

const BASE_ENV = { ACCESS_KEY_ID: 'ak', ACCESS_KEY_SECRET: 'sk' };

describe('job config parseInterval', () => {
  it('accepts bare seconds, s, m and h suffixes', () => {
    assert.strictEqual(parseInterval('300'), 300);
    assert.strictEqual(parseInterval('30s'), 30);
    assert.strictEqual(parseInterval('5m'), 300);
    assert.strictEqual(parseInterval('2h'), 7200);
    assert.strictEqual(parseInterval('5M'), 300);
  });

  it('defaults to five minutes when unset', () => {
    assert.strictEqual(parseInterval(undefined), 300);
    assert.strictEqual(parseInterval(''), 300);
    assert.strictEqual(parseInterval('  '), 300);
  });

  it('rejects values that are not a positive duration', () => {
    assert.throws(() => parseInterval('0'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('-5m'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('abc'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('5d'), /Invalid SYNC_INTERVAL/);
    assert.throws(() => parseInterval('5 m'), /Invalid SYNC_INTERVAL/);
  });
});

describe('job config parseList', () => {
  it('splits on comma and drops blanks', () => {
    assert.deepStrictEqual(parseList('a,b'), [ 'a', 'b' ]);
    assert.deepStrictEqual(parseList(' a , , b '), [ 'a', 'b' ]);
    assert.deepStrictEqual(parseList(undefined), []);
    assert.deepStrictEqual(parseList(''), []);
  });
});

describe('job config loadConfig', () => {
  it('requires credentials', () => {
    assert.throws(() => loadConfig({}), /ACCESS_KEY_ID/);
    assert.throws(() => loadConfig({ ACCESS_KEY_ID: 'ak' }), /ACCESS_KEY_SECRET/);
  });

  it('applies documented defaults', () => {
    const config = loadConfig(BASE_ENV);
    assert.deepStrictEqual(config.credential, { accessKeyId: 'ak', accessKeySecret: 'sk' });
    assert.deepStrictEqual(config.allow, []);
    assert.deepStrictEqual(config.deny, []);
    assert.strictEqual(config.intervalSeconds, 300);
    assert.deepStrictEqual(config.regions, DEFAULT_REGIONS);
    assert.strictEqual(config.label, 'default');
    assert.strictEqual(config.ipEndpoint, undefined);
  });

  it('reads every documented variable', () => {
    const config = loadConfig({
      ...BASE_ENV,
      MACHINE_ALLOW: 'nas-hk, i-abc',
      MACHINE_DENY: 'prod-1',
      SYNC_INTERVAL: '30s',
      REGIONS: 'cn-hangzhou,cn-hongkong',
      RULE_LABEL: 'home',
      IP_ENDPOINT: 'https://ip.example.com',
    });
    assert.deepStrictEqual(config.allow, [ 'nas-hk', 'i-abc' ]);
    assert.deepStrictEqual(config.deny, [ 'prod-1' ]);
    assert.strictEqual(config.intervalSeconds, 30);
    assert.deepStrictEqual(config.regions, [ 'cn-hangzhou', 'cn-hongkong' ]);
    assert.strictEqual(config.label, 'home');
    assert.strictEqual(config.ipEndpoint, 'https://ip.example.com');
  });

  it('rejects a label containing the remark separators', () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, RULE_LABEL: 'a@b' }), /RULE_LABEL/);
    assert.throws(() => loadConfig({ ...BASE_ENV, RULE_LABEL: 'a:b' }), /RULE_LABEL/);
    assert.throws(() => loadConfig({ ...BASE_ENV, RULE_LABEL: '' }), /RULE_LABEL/);
  });
});
```

`RULE_LABEL` 不允许含 `@` 或 `:`：备注格式是 `gd-job:<label>@<时间戳>`，label 里混入分隔符会让 `parseRuleTimestamp` 与 `isManagedJobRemark` 的解析产生歧义。

- [ ] **Step 2: 运行测试确认失败**

```bash
npm install
npm test -w @gd/job
```

预期：FAIL，`Cannot find module '../src/config'`。

- [ ] **Step 3: 实现**

新建 `packages/job/package.json`：

```json
{
  "name": "@gd/job",
  "version": "1.0.0",
  "private": true,
  "bin": {
    "gd-job": "bin/gd-job.js"
  },
  "scripts": {
    "start": "node bin/gd-job.js",
    "test": "egg-bin test"
  },
  "dependencies": {
    "@gd/shared": "*"
  }
}
```

新建 `packages/job/src/config.js`：

```js
'use strict';

const { resolveRegions } = require('@gd/shared/src/regions');

const DEFAULT_INTERVAL_SECONDS = 300;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600 };

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseInterval(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_INTERVAL_SECONDS;

  const matched = raw.match(/^(\d+)([smh])?$/i);
  if (!matched) throw new Error(`Invalid SYNC_INTERVAL: ${value}`);

  const amount = Number(matched[1]);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Invalid SYNC_INTERVAL: ${value}`);

  return amount * UNIT_SECONDS[(matched[2] || 's').toLowerCase()];
}

function loadConfig(env = process.env) {
  const accessKeyId = (env.ACCESS_KEY_ID || '').trim();
  const accessKeySecret = (env.ACCESS_KEY_SECRET || '').trim();
  if (!accessKeyId) throw new Error('ACCESS_KEY_ID is required');
  if (!accessKeySecret) throw new Error('ACCESS_KEY_SECRET is required');

  const label = (env.RULE_LABEL || 'default').trim();
  // 备注格式为 gd-job:<label>@<时间戳>，label 含分隔符会让解析产生歧义
  if (!label || label.includes(':') || label.includes('@')) {
    throw new Error(`Invalid RULE_LABEL: ${env.RULE_LABEL} (must be non-empty and contain neither ":" nor "@")`);
  }

  return {
    credential: { accessKeyId, accessKeySecret },
    allow: parseList(env.MACHINE_ALLOW),
    deny: parseList(env.MACHINE_DENY),
    intervalSeconds: parseInterval(env.SYNC_INTERVAL),
    regions: resolveRegions(env.REGIONS),
    label,
    ipEndpoint: env.IP_ENDPOINT || undefined,
  };
}

module.exports = { loadConfig, parseInterval, parseList, DEFAULT_INTERVAL_SECONDS };
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w @gd/job
```

预期：PASS，8 passing。

- [ ] **Step 5: 确认 workspace 生效**

```bash
ls -l node_modules/@gd/job && npm test
```

预期：`node_modules/@gd/job` 是指向 `packages/job` 的 symlink；`npm test` 四个 workspace 全绿。

- [ ] **Step 6: 提交**

```bash
git add packages/job/package.json packages/job/src/config.js packages/job/test/config.test.js package-lock.json
git commit -m "feat(job): add @gd/job package skeleton and env config parsing"
```

---

### Task 6: 机器筛选

**Files:**
- Create: `packages/job/src/machines.js`
- Create: `packages/job/test/machines.test.js`

**Interfaces:**
- Consumes: Task 3 的 `Machine` 形状
- Produces:
  - `matchesEntry(machine, entry) => boolean`
  - `selectMachines(machines, { allow, deny }) => Machine[]`
  - `findMissingEntries(machines, entries) => string[]`
  - `primarySecurityGroupId(machine) => string|undefined`
  - `withSecurityGroup(machine) => Machine`（ECS 补 `securityGroupId` 字段，SWAS 原样返回）

- [ ] **Step 1: 写失败的测试**

新建 `packages/job/test/machines.test.js`：

```js
'use strict';

const assert = require('assert');
const {
  matchesEntry,
  selectMachines,
  findMissingEntries,
  primarySecurityGroupId,
  withSecurityGroup,
} = require('../src/machines');

const MACHINES = [
  { product: 'ecs', instanceId: 'i-1', instanceName: 'nas-hk', regionId: 'cn-hongkong', securityGroupIds: [ 'sg-b', 'sg-a' ] },
  { product: 'swas-open', instanceId: 'swas-1', instanceName: 'blog', regionId: 'cn-hangzhou' },
  { product: 'swas-open', instanceId: 'swas-2', instanceName: 'prod', regionId: 'us-west-1' },
];

describe('job machines matching', () => {
  it('matches by instanceId or instanceName', () => {
    assert.strictEqual(matchesEntry(MACHINES[0], 'i-1'), true);
    assert.strictEqual(matchesEntry(MACHINES[0], 'nas-hk'), true);
    assert.strictEqual(matchesEntry(MACHINES[0], 'nope'), false);
  });
});

describe('job machines selection', () => {
  it('returns everything when both lists are empty', () => {
    assert.deepStrictEqual(selectMachines(MACHINES, { allow: [], deny: [] }), MACHINES);
  });

  it('keeps only allow entries when allow is set', () => {
    const selected = selectMachines(MACHINES, { allow: [ 'nas-hk', 'swas-2' ], deny: [] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1', 'swas-2' ]);
  });

  it('drops deny entries when only deny is set', () => {
    const selected = selectMachines(MACHINES, { allow: [], deny: [ 'prod' ] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1', 'swas-1' ]);
  });

  it('applies allow first, then removes deny from that subset', () => {
    const selected = selectMachines(MACHINES, { allow: [ 'nas-hk', 'blog' ], deny: [ 'blog' ] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1' ]);
  });

  it('silently skips entries that match no machine', () => {
    const selected = selectMachines(MACHINES, { allow: [ 'nas-hk', 'released-box' ], deny: [] });
    assert.deepStrictEqual(selected.map(m => m.instanceId), [ 'i-1' ]);
    assert.deepStrictEqual(findMissingEntries(MACHINES, [ 'nas-hk', 'released-box' ]), [ 'released-box' ]);
    assert.deepStrictEqual(findMissingEntries(MACHINES, []), []);
  });
});

describe('job machines security group selection', () => {
  it('picks the first security group after sorting, so the choice is deterministic', () => {
    assert.strictEqual(primarySecurityGroupId(MACHINES[0]), 'sg-a');
    // 阿里云返回顺序颠倒也选中同一个
    assert.strictEqual(primarySecurityGroupId({ securityGroupIds: [ 'sg-a', 'sg-b' ] }), 'sg-a');
    assert.strictEqual(primarySecurityGroupId({ securityGroupIds: [] }), undefined);
    assert.strictEqual(primarySecurityGroupId({}), undefined);
  });

  it('attaches securityGroupId for ECS and leaves SWAS untouched', () => {
    assert.strictEqual(withSecurityGroup(MACHINES[0]).securityGroupId, 'sg-a');
    assert.strictEqual(withSecurityGroup(MACHINES[1]).securityGroupId, undefined);
    assert.strictEqual(withSecurityGroup(MACHINES[1]), MACHINES[1]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @gd/job
```

预期：FAIL，`Cannot find module '../src/machines'`。

- [ ] **Step 3: 实现**

新建 `packages/job/src/machines.js`：

```js
'use strict';

function matchesEntry(machine, entry) {
  return entry === machine.instanceId || entry === machine.instanceName;
}

function selectMachines(machines, { allow = [], deny = [] } = {}) {
  let selected = machines;
  if (allow.length > 0) selected = selected.filter(m => allow.some(entry => matchesEntry(m, entry)));
  if (deny.length > 0) selected = selected.filter(m => !deny.some(entry => matchesEntry(m, entry)));
  return selected;
}

// 名单里写了但一台都没匹配上的条目：已释放、不在配置的地域、或名字写错
function findMissingEntries(machines, entries) {
  return entries.filter(entry => !machines.some(m => matchesEntry(m, entry)));
}

// 排序后取第一个：阿里云未承诺 DescribeInstances 的安全组顺序稳定，
// 不排序的话两轮之间顺序一变，旧 IP 规则会残留在另一个安全组里无人清理。
function primarySecurityGroupId(machine) {
  return [ ...(machine.securityGroupIds || []) ].sort()[0];
}

function withSecurityGroup(machine) {
  if (machine.product !== 'ecs') return machine;
  return { ...machine, securityGroupId: primarySecurityGroupId(machine) };
}

module.exports = {
  matchesEntry,
  selectMachines,
  findMissingEntries,
  primarySecurityGroupId,
  withSecurityGroup,
};
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w @gd/job
```

预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/job/src/machines.js packages/job/test/machines.test.js
git commit -m "feat(job): add machine allow/deny selection and deterministic security group pick"
```

---

### Task 7: 单轮同步

**Files:**
- Create: `packages/job/src/sync.js`
- Create: `packages/job/test/sync.test.js`

**Interfaces:**
- Consumes: Task 1 的 `buildManagedJobRemark` / `isManagedJobRemark`；Task 3 的 `listMachines` / `listMachineRules` / `addIpRules`（含 `protocols` 返回）/ `cleanupRules`；Task 6 的 `selectMachines` / `findMissingEntries` / `withSecurityGroup`
- Produces:
  - `buildStaleRulePredicate({ label, sourceCidrIp, product }) => (rule) => boolean`
  - `runOnce({ config, deps, logger }) => Promise<{ ip: string|null, ok: boolean, targets: number, added: number, deleted: number, failures: number }>`
    - `added` / `deleted` 是**规则**条数（不是机器数），用于判断本轮有没有真的写过东西
    - `ok` = 无失败
  - `deps` 用于注入，缺省取真实实现：`{ getPublicIp, listMachines, listMachineRules, addIpRules, cleanupRules }`
  - 无状态：`runOnce` 不接收也不返回任何跨轮状态，每轮都是一次完整对账（spec §5.0 / §9）

- [ ] **Step 1: 写失败的测试**

新建 `packages/job/test/sync.test.js`：

```js
'use strict';

const assert = require('assert');
const { runOnce, buildStaleRulePredicate } = require('../src/sync');
const { PORT_RANGE } = require('@gd/shared/src/firewall-rule');

const SILENT = { info() {}, warn() {}, error() {} };

const CONFIG = {
  credential: { accessKeyId: 'ak', accessKeySecret: 'sk' },
  allow: [], deny: [],
  regions: [ 'cn-hangzhou' ],
  label: 'home',
  ipEndpoint: undefined,
};

const SWAS = { product: 'swas-open', instanceId: 'swas-1', instanceName: 'blog', regionId: 'cn-hangzhou' };

const ADDED_BOTH = { status: 'success', message: 'TCP: added, UDP: added', protocols: { TCP: 'added', UDP: 'added' } };
const EXISTS_BOTH = { status: 'success', message: 'TCP: already exists, UDP: already exists', protocols: { TCP: 'exists', UDP: 'exists' } };

const OWN_RULES = [
  { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'own-tcp' },
  { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-job:home@2026-08-18 08:00:00', ruleId: 'own-udp' },
];
const FOREIGN_RULES = [
  { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-web@2026-08-18 08:00:00', ruleId: 'web-tcp' },
  { ruleProtocol: 'UDP', port: PORT_RANGE, sourceCidrIp: '1.2.3.4/32', remark: 'gd-web@2026-08-18 08:00:00', ruleId: 'web-udp' },
];

function makeDeps(overrides = {}) {
  return {
    async getPublicIp() { return '1.2.3.4'; },
    async listMachines() { return [ SWAS ]; },
    async listMachineRules() { return []; },
    async addIpRules() { return ADDED_BOTH; },
    async cleanupRules() { return { deletedCount: 0 }; },
    ...overrides,
  };
}

function captureLogger() {
  const lines = { info: [], warn: [], error: [] };
  return {
    lines,
    logger: {
      info: (...a) => lines.info.push(a.join(' ')),
      warn: (...a) => lines.warn.push(a.join(' ')),
      error: (...a) => lines.error.push(a.join(' ')),
    },
  };
}

describe('job sync buildStaleRulePredicate', () => {
  it('selects own-label rules whose source IP differs from the current one', () => {
    const predicate = buildStaleRulePredicate({ label: 'home', sourceCidrIp: '1.2.3.4/32', product: 'swas-open' });
    const rule = (remark, sourceCidrIp) => ({ ruleProtocol: 'TCP', port: PORT_RANGE, remark, sourceCidrIp });

    // 旧 IP 的自有规则 → 删
    assert.strictEqual(predicate(rule('gd-job:home@2026-08-17 09:00:00', '5.6.7.8/32')), true);
    // 当前 IP 的自有规则 → 留，哪怕时间戳很旧（DDNS 语义，不看时间）
    assert.strictEqual(predicate(rule('gd-job:home@2020-01-01 00:00:00', '1.2.3.4/32')), false);
    // 别的 label → 不碰
    assert.strictEqual(predicate(rule('gd-job:office@2026-08-17 09:00:00', '5.6.7.8/32')), false);
    // 别的模块 → 不碰
    assert.strictEqual(predicate(rule('gd-web@2026-08-17 09:00:00', '5.6.7.8/32')), false);
    assert.strictEqual(predicate(rule('gd-ddns:x.dev@2026-08-17 09:00:00', '5.6.7.8/32')), false);
    // 手工规则 → 不碰
    assert.strictEqual(predicate(rule('云谷园区', '5.6.7.8/32')), false);
  });

  it('ignores rules whose protocol or port is not the managed shape', () => {
    // 与 web 的 isExpiredWebRule 一致：只认 TCP/UDP + 1/65535 的规则
    const predicate = buildStaleRulePredicate({ label: 'home', sourceCidrIp: '1.2.3.4/32', product: 'swas-open' });
    assert.strictEqual(predicate({ ruleProtocol: 'TCP', port: '22/22', remark: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), false);
    assert.strictEqual(predicate({ ruleProtocol: 'ICMP', port: PORT_RANGE, remark: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), false);
    assert.strictEqual(predicate({ ruleProtocol: 'tcp', port: PORT_RANGE, remark: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), true);
  });

  it('reads the description field for ECS rules', () => {
    const predicate = buildStaleRulePredicate({ label: 'home', sourceCidrIp: '1.2.3.4/32', product: 'ecs' });
    assert.strictEqual(predicate({ ipProtocol: 'TCP', portRange: PORT_RANGE, description: 'gd-job:home@2026-08-17 09:00:00', sourceCidrIp: '5.6.7.8/32' }), true);
  });
});

describe('job sync runOnce', () => {
  it('adds then cleans', async () => {
    const order = [];
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async addIpRules() { order.push('add'); return ADDED_BOTH; },
        async cleanupRules() { order.push('cleanup'); return { deletedCount: 1 }; },
      }),
    });
    // 先加后清：先删会留出一段谁都连不上的窗口
    assert.deepStrictEqual(order, [ 'add', 'cleanup' ]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.added, 2);
    assert.strictEqual(result.deleted, 1);
  });

  it('passes one rule listing to both add and cleanup', async () => {
    let listCalls = 0;
    const seen = [];
    const rules = [ { ruleProtocol: 'TCP', port: PORT_RANGE, sourceCidrIp: '5.6.7.8/32', remark: 'gd-job:home@2026-08-17 09:00:00', ruleId: 'old' } ];
    await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { listCalls += 1; return rules; },
        async addIpRules(args) { seen.push(args.rules); return ADDED_BOTH; },
        async cleanupRules(args) { seen.push(args.rules); return { deletedCount: 1 }; },
      }),
    });
    assert.strictEqual(listCalls, 1);
    assert.strictEqual(seen[0], rules);
    assert.strictEqual(seen[1], rules);
  });

  it('is idempotent: a repeated round with everything in place performs no writes', async () => {
    let created = 0;
    let deleted = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { return OWN_RULES; },
        async addIpRules() { created += 1; return EXISTS_BOTH; },
        async cleanupRules() { deleted += 1; return { deletedCount: 0 }; },
      }),
    });
    // addIpRules / cleanupRules 被调用（它们内部靠预检决定不写），但结果里没有任何写入
    assert.strictEqual(created, 1);
    assert.strictEqual(deleted, 1);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.added, 0);
    assert.strictEqual(result.deleted, 0);
  });

  it('heals on the next round once a foreign rule covering the IP disappears', async () => {
    // 场景：用户此前在家用 Web 加过白名单，gd-web 规则覆盖了家里 IP。
    // 本轮预检"已存在"，不写；24h 后 web 把它清掉，下一轮 gd-job 自动补上自己的规则。
    // 不需要任何状态或特殊逻辑，每轮全量对账天然覆盖。
    const first = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { return FOREIGN_RULES; },
        async addIpRules() { return EXISTS_BOTH; },
      }),
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.added, 0);

    const second = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({ async listMachineRules() { return []; } }),
    });
    assert.strictEqual(second.added, 2);
  });

  it('keeps stale rules when only some protocols were added', async () => {
    let cleaned = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async addIpRules() { return { status: 'partial', message: 'TCP: added, UDP: failed (boom)', protocols: { TCP: 'added', UDP: 'failed' } }; },
        async cleanupRules() { cleaned += 1; return { deletedCount: 1 }; },
      }),
    });
    // 新访问没完全到位前不撤旧访问；下一轮补齐 UDP 后再清
    assert.strictEqual(cleaned, 0);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failures, 1);
  });

  it('reports failure when any machine fails', async () => {
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({ async addIpRules() { return { status: 'error', message: 'boom' }; } }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failures, 1);
  });

  it('fails closed for a machine whose rule listing throws', async () => {
    let added = 0;
    let cleaned = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachineRules() { throw new Error('boom'); },
        async addIpRules() { added += 1; return ADDED_BOTH; },
        async cleanupRules() { cleaned += 1; return { deletedCount: 0 }; },
      }),
    });
    assert.strictEqual(added, 0);
    assert.strictEqual(cleaned, 0);
    assert.strictEqual(result.ok, false);
  });

  it('skips the round when fetching the public IP fails', async () => {
    let listed = 0;
    const result = await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async getPublicIp() { throw new Error('offline'); },
        async listMachines() { listed += 1; return [ SWAS ]; },
      }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.ip, null);
    assert.strictEqual(listed, 0);
  });

  it('logs missing allow entries without failing the round', async () => {
    const { lines, logger } = captureLogger();
    const result = await runOnce({
      config: { ...CONFIG, allow: [ 'blog', 'released-box' ] },
      logger,
      deps: makeDeps(),
    });
    assert.strictEqual(result.ok, true);
    assert.ok(lines.info.some(line => line.includes('released-box')));
  });

  it('uses the ECS security group chosen by sorting', async () => {
    const machines = [ { product: 'ecs', instanceId: 'i-1', instanceName: 'nas', regionId: 'cn-hangzhou', securityGroupIds: [ 'sg-b', 'sg-a' ] } ];
    let seenGroup;
    await runOnce({
      config: CONFIG, logger: SILENT,
      deps: makeDeps({
        async listMachines() { return machines; },
        async addIpRules(args) { seenGroup = args.machine.securityGroupId; return ADDED_BOTH; },
      }),
    });
    assert.strictEqual(seenGroup, 'sg-a');
  });

  it('prints only the round summary when nothing was written and nothing failed', async () => {
    const { lines, logger } = captureLogger();
    await runOnce({
      config: CONFIG, logger,
      deps: makeDeps({
        async listMachineRules() { return OWN_RULES; },
        async addIpRules() { return EXISTS_BOTH; },
      }),
    });
    // 一行摘要，不带机器级细节 —— 每 5 分钟一轮，安静的轮次不该刷屏
    assert.strictEqual(lines.info.length, 1);
    assert.ok(lines.info[0].includes('1.2.3.4'));
    assert.ok(lines.info[0].includes('0 added'));
    assert.strictEqual(lines.warn.length, 0);
    assert.strictEqual(lines.error.length, 0);
  });

  it('prints machine detail when something was written', async () => {
    const { lines, logger } = captureLogger();
    await runOnce({
      config: CONFIG, logger,
      deps: makeDeps({ async cleanupRules() { return { deletedCount: 1 }; } }),
    });
    assert.ok(lines.info.some(line => line.includes('swas-open/blog') && line.includes('TCP: added')));
    assert.ok(lines.info.some(line => line.includes('swas-open/blog') && line.includes('cleaned 1')));
    assert.ok(lines.info.some(line => line.includes('2 added') && line.includes('1 removed')));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -w @gd/job
```

预期：FAIL，`Cannot find module '../src/sync'`。

- [ ] **Step 3: 实现**

新建 `packages/job/src/sync.js`：

```js
'use strict';

const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  toSourceCidrIp,
  normalizeIpForCompare,
  normalizeProtocol,
  getRuleField,
  buildManagedJobRemark,
  isManagedJobRemark,
} = require('@gd/shared/src/firewall-rule');
const machineFirewall = require('@gd/shared/src/machine-firewall');
const { getPublicIp } = require('@gd/shared/src/public-ip');
const { selectMachines, findMissingEntries, withSecurityGroup } = require('./machines');

// 两种 product 的规则字段名差异
const RULE_FIELDS = {
  ecs: { protocol: 'ipProtocol', port: 'portRange', remark: 'description' },
  'swas-open': { protocol: 'ruleProtocol', port: 'port', remark: 'remark' },
};

const DEFAULT_DEPS = {
  getPublicIp,
  listMachines: machineFirewall.listMachines,
  listMachineRules: machineFirewall.listMachineRules,
  addIpRules: machineFirewall.addIpRules,
  cleanupRules: machineFirewall.cleanupRules,
};

/**
 * 「过期规则」= 自己 label 名下、但源 IP 不是当前公网 IP 的规则。
 * 与时间无关：IP 没变时规则就该一直留着，按 TTL 删会制造无意义的抖动。
 */
function buildStaleRulePredicate({ label, sourceCidrIp, product }) {
  const fields = RULE_FIELDS[product];
  const currentIp = normalizeIpForCompare(sourceCidrIp);
  return rule => {
    // 与 web 的 isExpiredWebRule 同构：协议、端口、备注前缀三者都要命中，再看 IP
    if (!RULE_PROTOCOLS.includes(normalizeProtocol(getRuleField(rule, fields.protocol)))) return false;
    if (getRuleField(rule, fields.port) !== PORT_RANGE) return false;
    const remark = getRuleField(rule, fields.remark) || '';
    if (!isManagedJobRemark(remark, label)) return false;
    return normalizeIpForCompare(getRuleField(rule, 'sourceCidrIp')) !== currentIp;
  };
}

function countAdded(added) {
  return Object.values(added.protocols || {}).filter(outcome => outcome === 'added').length;
}

/**
 * 一轮完整对账。无状态：不记上一轮的任何东西，看到什么修什么（spec §5.0）。
 */
async function runOnce({ config, deps = DEFAULT_DEPS, logger = console }) {
  const summary = { ip: null, ok: false, targets: 0, added: 0, deleted: 0, failures: 0 };

  let ip;
  try {
    ip = await deps.getPublicIp({ endpoint: config.ipEndpoint });
  } catch (err) {
    logger.warn(`[gd-job] failed to fetch public ip, skipping this round: ${err.message || err}`);
    return summary;
  }
  summary.ip = ip;

  const sourceCidrIp = toSourceCidrIp(ip);
  const remark = buildManagedJobRemark(config.label);
  const { credential } = config;

  const machines = await deps.listMachines({ credential, regions: config.regions, logger });
  for (const missing of findMissingEntries(machines, [ ...config.allow, ...config.deny ])) {
    logger.info(`[gd-job] configured machine not found, skipping: ${missing}`);
  }

  const targets = selectMachines(machines, config).map(withSecurityGroup);
  summary.targets = targets.length;

  for (const machine of targets) {
    const name = `${machine.product}/${machine.instanceName || machine.instanceId}`;

    let rules;
    try {
      // 一次列举供新增与清理共用，同时也是 fail-closed 的判定点
      rules = await deps.listMachineRules({ credential, machine });
    } catch (err) {
      logger.error(`[gd-job] ${name}: failed to list rules, skipping to keep manual rules safe: ${err.message || err}`);
      summary.failures += 1;
      continue;
    }

    // 先加后清：先删会留出一段新旧 IP 都不通的窗口
    const added = await deps.addIpRules({ credential, machine, sourceCidrIp, remark, rules, logger });
    if (added.status === 'error') {
      logger.error(`[gd-job] ${name}: ${added.message}`);
      summary.failures += 1;
      continue;
    }
    if (added.status === 'partial') {
      // 新 IP 只有一个协议放通了，旧规则先留着：新访问没完全到位前不撤旧访问。下一轮补齐后再清。
      logger.warn(`[gd-job] ${name}: ${added.message}; keeping stale rules until all protocols succeed`);
      summary.failures += 1;
      summary.added += countAdded(added);
      continue;
    }
    const addedCount = countAdded(added);
    summary.added += addedCount;
    // 安静的轮次不刷屏：只有真的写了才打机器级细节
    if (addedCount > 0) logger.info(`[gd-job] ${name}: ${added.message}`);

    try {
      const cleaned = await deps.cleanupRules({
        credential, machine, rules, logger,
        shouldDelete: buildStaleRulePredicate({ label: config.label, sourceCidrIp, product: machine.product }),
      });
      summary.deleted += cleaned.deletedCount;
      if (cleaned.deletedCount > 0) {
        logger.info(`[gd-job] ${name}: cleaned ${cleaned.deletedCount} stale rule(s)`);
      }
    } catch (err) {
      logger.error(`[gd-job] ${name}: cleanup failed: ${err.message || err}`);
      summary.failures += 1;
    }
  }

  summary.ok = summary.failures === 0;
  logger.info(`[gd-job] ${ip} → ${summary.targets} machine(s): ${summary.added} added, ${summary.deleted} removed, ${summary.failures} failed`);
  return summary;
}

module.exports = { runOnce, buildStaleRulePredicate, DEFAULT_DEPS };
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -w @gd/job
```

预期：PASS。

- [ ] **Step 5: 运行全部测试**

```bash
npm test
```

预期：PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/job/src/sync.js packages/job/test/sync.test.js
git commit -m "feat(job): add stateless single-round sync with add-then-clean and IP-based staleness"
```

---

### Task 8: 入口与定时循环

**Files:**
- Create: `packages/job/bin/gd-job.js`

**Interfaces:**
- Consumes: Task 5 的 `loadConfig`，Task 7 的 `runOnce`

- [ ] **Step 1: 实现**

新建 `packages/job/bin/gd-job.js`：

```js
#!/usr/bin/env node

'use strict';

const { loadConfig } = require('../src/config');
const { runOnce } = require('../src/sync');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[gd-job] invalid configuration: ${err.message}`);
    process.exit(1);
  }

  console.log(`[gd-job] started: label=${config.label} interval=${config.intervalSeconds}s regions=${config.regions.join(',')}`);
  if (config.allow.length) console.log(`[gd-job] allow: ${config.allow.join(', ')}`);
  if (config.deny.length) console.log(`[gd-job] deny: ${config.deny.join(', ')}`);

  // 容器里 Node 是 PID 1，内核不给 PID 1 施加默认信号处置——不注册 handler 的话
  // `docker stop` 发的 SIGTERM 会被无视，10 秒后被 SIGKILL。
  // 直接退出是安全的：每次 API 调用都是原子的，程序无状态，中途打断的一轮下次启动会完整重做。
  for (const signal of [ 'SIGINT', 'SIGTERM' ]) {
    process.on(signal, () => {
      console.log(`[gd-job] received ${signal}, exiting`);
      process.exit(0);
    });
  }

  // 启动即同步一次，不等第一个间隔：NAS 重启后要尽快恢复访问
  for (;;) {
    try {
      await runOnce({ config, logger: console });
    } catch (err) {
      // 兜底：任何未预期的异常都不该让容器退出，下一轮继续重试
      console.error('[gd-job] unexpected error in sync round:', err);
    }
    await sleep(config.intervalSeconds * 1000);
  }
}

main();
```

- [ ] **Step 2: 加可执行位**

```bash
chmod +x packages/job/bin/gd-job.js
```

- [ ] **Step 3: 验证配置校验会拦住空配置**

```bash
node packages/job/bin/gd-job.js; echo "exit=$?"
```

预期：打印 `[gd-job] invalid configuration: ACCESS_KEY_ID is required`，`exit=1`。

- [ ] **Step 4: 验证循环能起来并优雅退出**

用假的 AK/SK 和一个不存在的 IP 源，确认程序不会因为取 IP 失败而退出：

```bash
ACCESS_KEY_ID=fake ACCESS_KEY_SECRET=fake SYNC_INTERVAL=60s \
IP_ENDPOINT=http://127.0.0.1:9 \
timeout 5 node packages/job/bin/gd-job.js; echo "exit=$?"
```

预期：打印 `[gd-job] started: ...` 和一行 `failed to fetch public ip`，然后进程一直活着，直到 5 秒后 `timeout` 发出 SIGTERM，程序打印 `received SIGTERM, exiting` 并以 0 退出（`exit=0`）。

这一步同时验证两件事：取 IP 失败不会让进程退出；SIGTERM 能立刻结束进程（`docker stop` 依赖这一点）。若看到 `exit=124`，说明 SIGTERM handler 没生效。

- [ ] **Step 5: 提交**

```bash
git add packages/job/bin/gd-job.js
git commit -m "feat(job): add entrypoint with immediate first run and graceful shutdown"
```

---

### Task 9: Docker 交付物

**Files:**
- Create: `packages/job/Dockerfile`
- Create: `packages/job/docker-compose.example.yml`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: Task 5–8 的 `@gd/job` 包

- [ ] **Step 1: 写 Dockerfile**

新建 `packages/job/Dockerfile`（构建上下文是仓库根目录，因为要装 workspace 依赖）：

```dockerfile
# 构建上下文为仓库根目录：
#   docker build -f packages/job/Dockerfile -t gd-job .
FROM node:20-alpine

WORKDIR /app

# 先只拷贝清单，让依赖层能被缓存。
# 五个 workspace 的 package.json 一个都不能少，也不要加 --workspace 过滤：
# npm 10 在这两种情况下装出来的树都是坏的（@alicloud/credentials 链上的 debug 会丢，
# require('@alicloud/ecs20140526') 直接 Cannot find module 'debug'）。已在 npm 10.9.4 上实测。
# 全量 --omit=dev 只多装 egg 相关约 3.6MB，不值得为此冒险。
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY packages/cli/package.json ./packages/cli/
COPY packages/job/package.json ./packages/job/

RUN npm ci --omit=dev

# 只拷 job 真正会 require 到的两个包的源码；web / scheduler / cli 只留上面的清单
COPY packages/shared ./packages/shared
COPY packages/job ./packages/job

CMD ["node", "packages/job/bin/gd-job.js"]
```

`npm ci` 时 `packages/job/bin/gd-job.js` 尚未拷入，npm 对缺失的 bin 目标是容忍的（根清单的 `bin/ecs-dsec-handler.js` 同样缺失，实测通过），不必调整 COPY 顺序去迁就它。

- [ ] **Step 2: 写 .dockerignore**

新建仓库根目录的 `.dockerignore`：

```
node_modules
**/node_modules
.git
.aliyun.conf
run
docs
.github
```

`.aliyun.conf` 必须排除：那是本地凭据文件，绝不能进镜像。

- [ ] **Step 3: 写 compose 示例**

新建 `packages/job/docker-compose.example.yml`：

```yaml
services:
  gd-job:
    build:
      context: ../..
      dockerfile: packages/job/Dockerfile
    image: gd-job
    container_name: gd-job
    restart: unless-stopped
    # 每轮打一行摘要（默认 5 分钟一轮），做个轮转免得日志无限长
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    environment:
      # 必填：建议用最小权限的 RAM 子账号
      ACCESS_KEY_ID: "your-access-key-id"
      ACCESS_KEY_SECRET: "your-access-key-secret"

      # 容器默认 UTC，不设的话规则备注里的时间会差 8 小时
      TZ: "Asia/Shanghai"

      # 只扫有机器的地域，默认十个地域每轮要发 20 次 API 调用
      REGIONS: "cn-hangzhou,cn-hongkong"

      # 多站点部署时给每个位置一个独立 label，否则两边会互删对方的规则
      RULE_LABEL: "home"

      # 可选：只操作这些机器（填实例 ID 或实例名皆可）
      # MACHINE_ALLOW: "nas-hk,i-bp1xxxxxxxxxxxxxxxx"

      # 可选：不操作这些机器
      # MACHINE_DENY: "prod-db"

      # 可选：默认 5m
      # SYNC_INTERVAL: "5m"

      # 可选：默认 https://get-ip.rockdai.com
      # IP_ENDPOINT: "https://get-ip.rockdai.com"
```

- [ ] **Step 4: 无 Docker 环境下的等价验证（必做）**

开发机上未必装了 Docker（当前这台 Mac 就没有）。先在临时目录里逐条模拟 Dockerfile 的 COPY 与 RUN，把依赖安装这一最容易出错的环节验证掉：

```bash
S=$(mktemp -d)
cp package.json package-lock.json "$S/"
for p in shared web scheduler cli job; do mkdir -p "$S/packages/$p" && cp "packages/$p/package.json" "$S/packages/$p/"; done
(cd "$S" && npm ci --omit=dev --no-audit --no-fund 2>&1 | grep -E "added|ERR")
cp -R packages/shared/. "$S/packages/shared/" && cp -R packages/job/. "$S/packages/job/"
(cd "$S" && node -e "require('./packages/job/src/sync'); console.log('✅ 依赖树完整，@gd/shared 与 @alicloud/* 可加载')")
(cd "$S" && node packages/job/bin/gd-job.js; echo "exit=$?")
rm -rf "$S"
```

预期：`added 4xx packages`；`✅ 依赖树完整…`；最后一条打印 `invalid configuration: ACCESS_KEY_ID is required` 且 `exit=1`。若出现 `Cannot find module 'debug'`，说明 Dockerfile 的 COPY 清单或 `npm ci` 参数被改动过，回到 Step 1 对照。

- [ ] **Step 5: 构建镜像（有 Docker 的机器上）**

```bash
docker build -f packages/job/Dockerfile -t gd-job .
```

预期：构建成功。**若本机没有 Docker，把 Step 5–7 记入 PR 描述的「合并前待验证」清单，在 NAS 或任何有 Docker 的机器上补跑一次再合并。**

- [ ] **Step 6: 验证镜像能起来且配置校验生效**

```bash
docker run --rm gd-job; echo "exit=$?"
```

预期：打印 `[gd-job] invalid configuration: ACCESS_KEY_ID is required`，`exit=1`。

再验证依赖解析正常：

```bash
docker run --rm -e ACCESS_KEY_ID=fake -e ACCESS_KEY_SECRET=fake \
  -e IP_ENDPOINT=http://127.0.0.1:9 gd-job \
  node -e "require('/app/packages/job/src/sync'); console.log('✅ @gd/shared 在镜像内可解析')"
```

预期：打印成功信息，无 `Cannot find module`。

再验证 `TZ` 在 alpine 镜像里生效（规则备注的时间戳依赖它；Node 自带 ICU 时区数据，不需要装 tzdata，此步是确认而非修复）：

```bash
docker run --rm -e TZ=Asia/Shanghai gd-job \
  node -e "const d=new Date('2026-08-18T00:00:00Z'); console.log(d.getHours()===8 ? '✅ TZ 生效，UTC 0 点显示为 8 点' : '❌ TZ 未生效: '+d.getHours())"
```

- [ ] **Step 7: 确认凭据文件没进镜像**

```bash
docker run --rm gd-job sh -c "ls -a /app | grep aliyun || echo '✅ 镜像内无 .aliyun.conf'"
```

预期：`✅ 镜像内无 .aliyun.conf`。

- [ ] **Step 8: 提交**

```bash
git add packages/job/Dockerfile packages/job/docker-compose.example.yml .dockerignore
git commit -m "build(job): add Dockerfile and compose example"
```

---

### Task 10: 文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新功能列表**

在 README「## 功能」一节的第 3 项之后追加：

```markdown
### 4) Docker 定时同步（NAS / Homelab）

`@gd/job`：部署在自己的 NAS / Homelab 上常驻运行，定时获取当前家庭网络的公网 IP，
自动同步到阿里云 ECS / 轻量应用服务器白名单，并清理自己留下的旧 IP 规则。
```

- [ ] **Step 2: 更新规则前缀说明**

把 README 中现有的这句：

> 定时任务只会修改/清理 `gd-ddns:` 开头的规则，Web 只会清理 `gd-web` 开头的过期规则，CLI 只会修改 `gd-cli:` 开头的规则；三者不会互相认领或删除规则。

替换为：

```markdown
每个模块只认自己前缀的规则，互不认领、互不删除，也不会碰用户手工维护的规则：

| 模块 | 前缀 | 清理范围 |
|------|------|----------|
| 定时任务 | `gd-ddns:` | 同名规则中的重复项 |
| Web | `gd-web` | 超过 24 小时的过期规则 |
| CLI | `gd-cli:` | 只修改，不清理 |
| Docker 同步 | `gd-job:<label>` | 自己 label 名下、源 IP 已不是当前公网 IP 的规则 |
```

- [ ] **Step 3: 新增部署一节**

在「## 部署到函数计算 FC」一节之后插入：

````markdown
## Docker 部署（NAS / Homelab）

```bash
cp packages/job/docker-compose.example.yml docker-compose.yml
# 编辑 docker-compose.yml 填入 AK/SK 和地域
docker compose up -d
docker compose logs -f gd-job
```

或直接用 docker：

```bash
docker build -f packages/job/Dockerfile -t gd-job .
docker run -d --name gd-job --restart unless-stopped \
  -e ACCESS_KEY_ID=xxx -e ACCESS_KEY_SECRET=yyy \
  -e TZ=Asia/Shanghai -e REGIONS=cn-hangzhou,cn-hongkong \
  -e RULE_LABEL=home \
  gd-job
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
````

- [ ] **Step 4: 更新项目结构**

在 README「## 项目结构」的 `packages/` 树中，`scheduler/` 条目之后加入：

```
│   ├── job/                # @gd/job —— Docker 定时同步（NAS / Homelab）
│   │   ├── src/{config,machines,sync}.js
│   │   ├── bin/gd-job.js
│   │   ├── Dockerfile
│   │   └── docker-compose.example.yml
```

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs: document gd-job Docker deployment"
```

---

### Task 11: 收尾验证与 PR

- [ ] **Step 1: 全量测试**

```bash
npm test 2>&1 | grep -E "passing|failing"
```

预期：四个 workspace 全绿，无 failing。

- [ ] **Step 2: 确认既有模块入口未被破坏**

```bash
node -e "
require('./index.js');
require('./config.js');
require('./packages/web/app/service/aliyun.js');
console.log('✅ scheduler / config / web service 均可加载');
"
```

- [ ] **Step 3: 确认规则前缀隔离**

```bash
node -e "
const f = require('@gd/shared/src/firewall-rule');
const ts = '@2026-08-18 09:00:00';
// 四个模块的备注互相不认领
console.assert(!f.isManagedJobRemark('gd-web' + ts, 'home'), 'job 认领了 web 规则');
console.assert(!f.isManagedJobRemark('gd-ddns:x.dev' + ts, 'home'), 'job 认领了 ddns 规则');
console.assert(!f.isManagedJobRemark('gd-cli:x' + ts, 'home'), 'job 认领了 cli 规则');
console.assert(!f.isExpiredWebRule({ protocol: 'TCP', port: f.PORT_RANGE, remark: 'gd-job:home@2020-01-01 00:00:00' }), 'web 会清掉 job 规则');
console.assert(!f.isManagedDdnsRemark('gd-job:home' + ts, 'home'), 'ddns 认领了 job 规则');
console.assert(f.isOurManagedRemark('gd-job:home' + ts), 'job 规则未被守卫承认');
console.log('✅ 四个模块的规则前缀互不认领');
"
```

- [ ] **Step 4: 提 PR**

```bash
git push -u origin feat/gd-job-docker
gh pr create --title "feat: add @gd/job — Docker whitelist sync for NAS / Homelab" --body "$(cat <<'EOF'
## 新增能力

`@gd/job`：可 `docker compose up -d` 部署在 NAS / Homelab 的常驻程序，定时把家庭公网 IP
同步到阿里云 ECS / 轻量应用服务器白名单，并清理自己留下的旧 IP 规则。

- Spec: `docs/superpowers/specs/2026-08-18-gd-job-design.md`
- Plan: `docs/superpowers/plans/2026-08-18-gd-job-docker.md`

## 规则前缀契约

新增 `gd-job:<label>` 前缀，与 `gd-web` / `gd-ddns` / `gd-cli` 并列，互不认领：

- web 的 24h TTL 清理要求 `gd-web` 前缀，扫不到 gd-job 规则
- scheduler 的 staleRules 来自 `isManagedDdnsRemark` 过滤后的集合，扫不到 gd-job 规则
- gd-job 的清理要求 `isManagedJobRemark(remark, label)`，且外层仍有 `isOurManagedRemark` fail-closed 守卫

`RULE_LABEL` 让同账号下多站点部署（家里 / 公司）各认各的规则，不会互删。

## 「过期规则」的定义

gd-job 按**源 IP 不等于当前公网 IP** 判定，与时间无关。照搬 web 的 24h TTL 会与
「IP 未变则不重复操作」直接冲突——IP 一天没变就会把当前生效的规则删掉且不重建。
清理的机制（只认自己前缀、fail-closed、批量删）仍与 web 一致。

## 每轮全量对账，不做「IP 没变就跳过」

原需求里的「IP 未变则不重复添加」由预检幂等天然满足（规则已存在就不调创建接口，零写操作）。
不再额外记住上一轮 IP：那只省几十次免费只读调用，却让程序在 IP 不变期间对新机器、
手删规则、外来规则消失等一切变化失明。与 `@gd/scheduler` 每 5 分钟无条件全量执行是同一模式。
详见 spec §5.0。

## 重构范围

把 `packages/web/app/service/aliyun.js` 约 240 行阿里云操作逻辑提取到
`@gd/shared/src/machine-firewall.js`，web 变为委托层，job 复用同一份代码。
11 个安全相关用例随之迁入 `packages/shared/test/machine-firewall.test.js`，
迁移后同时保护 web 和 job 两个消费方。web 对外行为不变。

`REGIONS` 与 `IP_ENDPOINT` 统一为项目级环境变量：地域列表从 web 的 config 下沉到
`@gd/shared`，web 未设置时取值与改造前逐项一致。

## 配置项

| 变量 | 默认值 |
|------|--------|
| `ACCESS_KEY_ID` / `ACCESS_KEY_SECRET` | 必填 |
| `MACHINE_ALLOW` / `MACHINE_DENY` | 空（都为空则处理所有机器） |
| `SYNC_INTERVAL` | `5m` |
| `REGIONS` | 十个常用地域 |
| `RULE_LABEL` | `default` |
| `IP_ENDPOINT` | `https://get-ip.rockdai.com` |
| `TZ` | 容器默认 UTC，建议 `Asia/Shanghai` |

## 合并后的人工验证

本次改动了 web 的核心服务文件。虽然对外行为不变且测试全绿，但测试覆盖不到浏览器那一层，
**建议合并后在 https://gd.rockdai.com 手动点一次「添加白名单」确认**。

## 合并前待验证

- [ ] 在有 Docker 的机器上执行 `docker build -f packages/job/Dockerfile -t gd-job .` 并跑通 plan Task 9 Step 6–7（本地开发机无 Docker，只做了 npm ci 的等价模拟）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 执行者须知

- 每个 task 结束时 `npm test` 必须全绿再进下一个。
- Task 3 和 Task 4 是本计划唯一触碰安全敏感既有代码的部分。Task 4 改完 `packages/web/app/service/aliyun.js` 后，若有任何一个既有用例失败，不要改测试去迁就实现——那是行为已经变了的信号，回到实现里找原因。
- 不要给 `cleanupRules` 的 `isOurManagedRemark` 外层守卫加任何绕过分支，它是防止误删用户手工规则的最后一道防线。
