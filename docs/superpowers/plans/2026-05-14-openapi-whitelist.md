# OpenAPI Whitelist Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /openapi/whitelist` to gd-web that accepts `Authorization: Bearer <PASSWORD>` and creates a single whitelist rule by reusing the existing `addIpToWhitelist` service.

**Architecture:** Two new files (`app/middleware/password_auth.js`, `app/controller/openapi.js`) plus three small modifications (`app/router.js`, `config/config.default.js`, `README.md`). The middleware does header validation + per-IP rate limiting; the controller does body validation, calls the existing aliyun service, and flattens the per-machine result. JWT middleware is bypassed for `/openapi/*` via `skipPaths`.

**Tech Stack:** Egg.js 3, `crypto.timingSafeEqual` + HMAC-SHA256 for password compare, Node `node:net` for IPv4 validation (already in `lib/ip.js`). No egg-mock — tests use the existing project pattern: direct module loading + hand-rolled `ctx` fakes (mirrors `test/app/middleware/jwt_auth.test.js` and `test/app/service/aliyun.test.js`).

**Working branch:** Continue on `feat/openapi-whitelist-spec` (the spec lives there).

---

## File Structure

**Create:**
- `app/middleware/password_auth.js` — header-based PASSWORD auth + module-level per-IP rate limit
- `app/controller/openapi.js` — `OpenapiController` with `addWhitelist`
- `test/app/middleware/password_auth.test.js` — unit tests with a manual `ctx` mock (same pattern as `test/app/middleware/jwt_auth.test.js`)
- `test/app/controller/openapi.test.js` — controller tests via direct instantiation with a minimal `ctx` fake (no egg-mock)

**Modify:**
- `app/router.js` — register `POST /openapi/whitelist` with route-scoped `passwordAuth`
- `config/config.default.js` — append `/^\/openapi\//` to `jwtAuth.skipPaths`
- `README.md` — add row to API table; add short paragraph under "认证方式"

---

## Task 1: Scaffold middleware test file (red — no impl yet)

**Files:**
- Test: `test/app/middleware/password_auth.test.js` (create)

- [ ] **Step 1: Create the test file with one failing case**

Create `test/app/middleware/password_auth.test.js`:

```js
'use strict';

const assert = require('assert');

const passwordAuth = require('../../../app/middleware/password_auth');

function createCtx({ token, ip = '1.1.1.1' } = {}) {
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  return {
    ip,
    state: {},
    status: 200,
    body: null,
    logger,
    get(name) {
      if (name.toLowerCase() === 'authorization') {
        return token === undefined ? '' : `Bearer ${token}`;
      }
      return '';
    },
  };
}

function buildMiddleware() {
  return passwordAuth({}, { logger: { error() {} } });
}

describe('passwordAuth middleware', () => {
  beforeEach(() => {
    process.env.PASSWORD = 'correct-horse';
    if (passwordAuth.__test_only__) {
      passwordAuth.__test_only__.failedAttempts.clear();
    }
  });

  afterEach(() => {
    delete process.env.PASSWORD;
  });

  it('passes a request with the correct bearer password', async () => {
    const middleware = buildMiddleware();
    const ctx = createCtx({ token: 'correct-horse' });
    let nextCalled = false;
    await middleware(ctx, async () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(ctx.status, 200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module does not exist yet)**

Run: `npx egg-bin test test/app/middleware/password_auth.test.js`
Expected: FAIL — `Cannot find module '../../../app/middleware/password_auth'`

---

## Task 2: Implement password_auth — happy path

**Files:**
- Create: `app/middleware/password_auth.js`

- [ ] **Step 1: Implement the minimal middleware to pass Task 1's test**

Create `app/middleware/password_auth.js`:

```js
'use strict';

const crypto = require('crypto');

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;
const HMAC_SALT = 'gd-openapi-auth';

const failedAttempts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ ip, attempts ] of failedAttempts) {
    const recent = attempts.filter(t => now - t < WINDOW_MS);
    if (recent.length === 0) {
      failedAttempts.delete(ip);
    } else {
      failedAttempts.set(ip, recent);
    }
  }
}, 5 * 60 * 1000).unref();

function pruneAttempts(ip) {
  const now = Date.now();
  const attempts = (failedAttempts.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (attempts.length === 0) {
    failedAttempts.delete(ip);
  } else {
    failedAttempts.set(ip, attempts);
  }
  return attempts;
}

function isRateLimited(ip) {
  return pruneAttempts(ip).length >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const attempts = pruneAttempts(ip);
  attempts.push(Date.now());
  failedAttempts.set(ip, attempts);
}

function clearFailures(ip) {
  failedAttempts.delete(ip);
}

function digest(value) {
  return crypto.createHmac('sha256', HMAC_SALT).update(value).digest();
}

module.exports = () => {
  return async function passwordAuth(ctx, next) {
    const configuredPassword = process.env.PASSWORD;
    if (!configuredPassword) {
      ctx.logger.error('[passwordAuth] PASSWORD env var is not set');
      ctx.status = 500;
      ctx.body = { success: false, message: 'Server not configured: PASSWORD env var is not set' };
      return;
    }

    const clientIp = ctx.ip;

    if (isRateLimited(clientIp)) {
      ctx.status = 429;
      ctx.body = { success: false, message: 'Too many bad attempts; try again later' };
      return;
    }

    const authHeader = ctx.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.logger.debug('[passwordAuth] missing or malformed Authorization header from %s', clientIp);
      ctx.status = 401;
      ctx.body = { success: false, message: 'Authentication required' };
      return;
    }

    const token = authHeader.substring(7);
    const isValid = crypto.timingSafeEqual(digest(token), digest(configuredPassword));

    if (!isValid) {
      recordFailure(clientIp);
      ctx.logger.debug('[passwordAuth] bad token from %s', clientIp);
      ctx.status = 401;
      ctx.body = { success: false, message: 'Authentication required' };
      return;
    }

    clearFailures(clientIp);
    await next();
  };
};

module.exports.__test_only__ = {
  failedAttempts,
  MAX_ATTEMPTS,
  WINDOW_MS,
};
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx egg-bin test test/app/middleware/password_auth.test.js`
Expected: PASS — 1 passing.

---

## Task 3: Add tests for missing/malformed header → 401, no counter increment

**Files:**
- Test: `test/app/middleware/password_auth.test.js` (modify)

- [ ] **Step 1: Append failing tests**

Add the following inside the `describe('passwordAuth middleware', ...)` block, after the existing `it`:

```js
  it('returns 401 when Authorization header is missing', async () => {
    const middleware = buildMiddleware();
    const ctx = createCtx();
    let nextCalled = false;
    await middleware(ctx, async () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(ctx.status, 401);
    assert.deepStrictEqual(ctx.body, { success: false, message: 'Authentication required' });
    assert.strictEqual(passwordAuth.__test_only__.failedAttempts.size, 0);
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const middleware = buildMiddleware();
    const ctx = {
      ip: '1.1.1.1', state: {}, status: 200, body: null,
      logger: { debug() {}, error() {} },
      get(name) {
        return name.toLowerCase() === 'authorization' ? 'Basic abc' : '';
      },
    };
    let nextCalled = false;
    await middleware(ctx, async () => { nextCalled = true; });
    assert.strictEqual(nextCalled, false);
    assert.strictEqual(ctx.status, 401);
    assert.strictEqual(passwordAuth.__test_only__.failedAttempts.size, 0);
  });
```

- [ ] **Step 2: Run tests — expect them to PASS already**

Run: `npx egg-bin test test/app/middleware/password_auth.test.js`
Expected: PASS — 3 passing. (The Task 2 implementation already covers this.)

---

## Task 4: Add tests for wrong password → 401 + counter increment, and 5 strikes → 429

**Files:**
- Test: `test/app/middleware/password_auth.test.js` (modify)

- [ ] **Step 1: Append failing tests**

Add inside the same `describe`:

```js
  it('returns 401 and increments counter when token is wrong', async () => {
    const middleware = buildMiddleware();
    const ctx = createCtx({ token: 'wrong' });
    await middleware(ctx, async () => {});
    assert.strictEqual(ctx.status, 401);
    assert.strictEqual(passwordAuth.__test_only__.failedAttempts.get('1.1.1.1').length, 1);
  });

  it('clears the failure counter on a successful auth', async () => {
    const middleware = buildMiddleware();
    await middleware(createCtx({ token: 'wrong' }), async () => {});
    await middleware(createCtx({ token: 'correct-horse' }), async () => {});
    assert.strictEqual(passwordAuth.__test_only__.failedAttempts.has('1.1.1.1'), false);
  });

  it('returns 429 after MAX_ATTEMPTS bad-token requests within window', async () => {
    const middleware = buildMiddleware();
    for (let i = 0; i < 5; i++) {
      const ctx = createCtx({ token: 'wrong' });
      await middleware(ctx, async () => {});
      assert.strictEqual(ctx.status, 401);
    }
    const ctx = createCtx({ token: 'correct-horse' });
    let nextCalled = false;
    await middleware(ctx, async () => { nextCalled = true; });
    assert.strictEqual(ctx.status, 429);
    assert.strictEqual(nextCalled, false);
  });
```

- [ ] **Step 2: Run tests — expect them to PASS**

Run: `npx egg-bin test test/app/middleware/password_auth.test.js`
Expected: PASS — 6 passing.

Note: the 429 test confirms that rate-limit gates BEFORE token compare, so even a request with the *correct* password gets rejected once the IP is locked out.

---

## Task 5: Add test for missing PASSWORD → 500

**Files:**
- Test: `test/app/middleware/password_auth.test.js` (modify)

- [ ] **Step 1: Append test**

Add inside the same `describe`:

```js
  it('returns 500 when PASSWORD env var is not set', async () => {
    delete process.env.PASSWORD;
    const middleware = buildMiddleware();
    const ctx = createCtx({ token: 'anything' });
    await middleware(ctx, async () => {});
    assert.strictEqual(ctx.status, 500);
    assert.strictEqual(ctx.body.success, false);
    assert.match(ctx.body.message, /PASSWORD/);
  });
```

- [ ] **Step 2: Run tests**

Run: `npx egg-bin test test/app/middleware/password_auth.test.js`
Expected: PASS — 7 passing.

- [ ] **Step 3: Commit middleware + tests**

```bash
git add app/middleware/password_auth.js test/app/middleware/password_auth.test.js
git commit -m "$(cat <<'EOF'
feat: add passwordAuth middleware for /openapi routes

Bearer-token auth against PASSWORD env var, with HMAC + timingSafeEqual
compare and per-IP rate limit on bad-token attempts (mirrors
/api/login). Missing/malformed headers do not count toward the limit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire JWT skipPaths so /openapi is not double-gated

**Files:**
- Modify: `config/config.default.js`

- [ ] **Step 1: Append regex to skipPaths**

In `config/config.default.js`, find this block:

```js
  config.jwtAuth = {
    skipPaths: [
      '/',            // HTML shell (contains login form)
      '/api/login',   // Login endpoint itself
      '/api/auth/status',
      '/api/passkey/auth/options',
      '/api/passkey/auth/verify',
      /^\/public\//,  // Static assets (JS, CSS, manifest, SW)
    ],
  };
```

Change it to:

```js
  config.jwtAuth = {
    skipPaths: [
      '/',            // HTML shell (contains login form)
      '/api/login',   // Login endpoint itself
      '/api/auth/status',
      '/api/passkey/auth/options',
      '/api/passkey/auth/verify',
      /^\/public\//,  // Static assets (JS, CSS, manifest, SW)
      /^\/openapi\//, // OpenAPI uses its own passwordAuth middleware
    ],
  };
```

- [ ] **Step 2: Visual verification — open the file and confirm the regex is exactly `/^\/openapi\//`**

(no test runs at this step — config is exercised by Task 11's local smoke test)

---

## Task 7: Scaffold controller test file with one happy-path failing test

**Files:**
- Test: `test/app/controller/openapi.test.js` (create)

**Why this style:** the project has no `egg-mock` dependency and the existing tests instantiate units directly. We do the same here: build a minimal `ctx` that satisfies `egg.Controller`'s constructor (`ctx.app.config`, `ctx.getLogger()`) plus the fields our handler reads (`ctx.request.body`, `ctx.service.aliyun.addIpToWhitelist`).

- [ ] **Step 1: Create the test file**

Create `test/app/controller/openapi.test.js`:

```js
'use strict';

const assert = require('assert');

const OpenapiController = require('../../../app/controller/openapi');

function noopLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function createCtx({ body = {}, addIpToWhitelist = async () => [] } = {}) {
  return {
    app: { config: {} },
    request: { body },
    service: {
      aliyun: { addIpToWhitelist },
    },
    getLogger: noopLogger,
    logger: noopLogger(),
    status: 200,
    body: null,
  };
}

describe('controller/openapi addWhitelist', () => {
  it('returns 200 with the flattened machine result on success', async () => {
    const calls = [];
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      addIpToWhitelist: async (ip, machines) => {
        calls.push({ ip, machines });
        return [{
          ...machines[0],
          status: 'success',
          message: 'TCP: added, UDP: added',
        }];
      },
    });
    const ctrl = new OpenapiController(ctx);

    await ctrl.addWhitelist();

    assert.strictEqual(ctx.status, 200);
    assert.deepStrictEqual(ctx.body, {
      success: true,
      status: 'success',
      message: 'TCP: added, UDP: added',
      machine: { product: 'swas-open', instanceId: 'i-test', regionId: 'cn-hangzhou' },
    });
    assert.deepStrictEqual(calls, [{
      ip: '1.2.3.4',
      machines: [{ product: 'swas-open', instanceId: 'i-test', regionId: 'cn-hangzhou' }],
    }]);
  });
});
```

- [ ] **Step 2: Run the test — expect failure (controller does not exist)**

Run: `npx egg-bin test test/app/controller/openapi.test.js`
Expected: FAIL — `Cannot find module '.../app/controller/openapi'`.

---

## Task 8: Implement OpenapiController + wire router

**Files:**
- Create: `app/controller/openapi.js`
- Modify: `app/router.js`

- [ ] **Step 1: Create the controller**

Create `app/controller/openapi.js`:

```js
'use strict';

const { Controller } = require('egg');
const { isValidIpv4 } = require('../../lib/ip');

const SUPPORTED_PRODUCTS = new Set([ 'ecs', 'swas-open' ]);

class OpenapiController extends Controller {
  /**
   * POST /openapi/whitelist
   * Body (JSON or form-encoded):
   *   { ip, product, instanceId, regionId, securityGroupId? }
   */
  async addWhitelist() {
    const { ctx } = this;
    const body = ctx.request.body || {};

    const ip = String(body.ip || '').trim();
    const product = String(body.product || '').trim();
    const instanceId = String(body.instanceId || '').trim();
    const regionId = String(body.regionId || '').trim();
    const securityGroupId = body.securityGroupId
      ? String(body.securityGroupId).trim()
      : '';

    if (!ip || !product || !instanceId || !regionId) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'ip, product, instanceId, regionId are required' };
      return;
    }
    if (!isValidIpv4(ip)) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'Invalid IPv4 address' };
      return;
    }
    if (!SUPPORTED_PRODUCTS.has(product)) {
      ctx.status = 400;
      ctx.body = { success: false, message: `Unsupported product: ${product}` };
      return;
    }
    if (product === 'ecs' && !securityGroupId) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'securityGroupId is required for ECS' };
      return;
    }

    const machine = { product, instanceId, regionId };
    if (securityGroupId) machine.securityGroupId = securityGroupId;

    try {
      const results = await ctx.service.aliyun.addIpToWhitelist(ip, [ machine ]);
      const result = (results && results[0]) || { status: 'error', message: 'no result returned' };

      if (result.status === 'error') {
        ctx.status = 502;
        ctx.body = { success: false, status: 'error', message: result.message, machine };
        return;
      }

      ctx.status = 200;
      ctx.body = {
        success: true,
        status: result.status,
        message: result.message,
        machine,
      };
    } catch (err) {
      ctx.logger.error('[openapi/whitelist] Failed to add whitelist:', err);
      ctx.status = 500;
      ctx.body = { success: false, message: err.message };
    }
  }
}

module.exports = OpenapiController;
```

- [ ] **Step 2: Wire the router**

In `app/router.js`, replace the entire file contents with:

```js
'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  // PWA entry
  router.get('/', controller.home.index);

  // Authentication
  router.post('/api/login', controller.auth.login);
  router.get('/api/auth/status', controller.passkey.status);
  router.post('/api/passkey/auth/options', controller.passkey.authOptions);
  router.post('/api/passkey/auth/verify', controller.passkey.verifyAuth);
  router.post('/api/passkey/register/options', controller.passkey.registerOptions);
  router.post('/api/passkey/register/verify', controller.passkey.verifyRegistration);

  // Protected API routes (JWT required – enforced by jwtAuth middleware)
  router.get('/api/machines', controller.api.machines);
  router.get('/api/ip-location', controller.api.ipLocation);
  router.post('/api/whitelist', controller.api.addWhitelist);

  // OpenAPI routes (header-based PASSWORD auth, not JWT)
  const passwordAuth = app.middleware.passwordAuth({}, app);
  router.post('/openapi/whitelist', passwordAuth, controller.openapi.addWhitelist);
};
```

- [ ] **Step 3: Run the controller test**

Run: `npx egg-bin test test/app/controller/openapi.test.js`
Expected: PASS — 1 passing.

---

## Task 9: Add controller tests for validation, error mapping

**Files:**
- Test: `test/app/controller/openapi.test.js` (modify)

Note: route-level wiring (auth middleware, body parser for form-encoded, skipPaths) is NOT covered by these unit tests. It is covered by the manual smoke test in Task 11's PR test plan.

- [ ] **Step 1: Append validation tests**

Append inside the existing `describe('controller/openapi addWhitelist', ...)`:

```js
  it('returns 400 when required fields are missing', async () => {
    const ctx = createCtx({ body: { ip: '1.2.3.4' } });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /required/);
  });

  it('returns 400 for invalid IPv4', async () => {
    const ctx = createCtx({
      body: {
        ip: 'not-an-ip',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /IPv4/);
  });

  it('returns 400 for unsupported product', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'gcp',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /Unsupported product/);
  });

  it('returns 400 when product=ecs but securityGroupId is missing', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'ecs',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /securityGroupId/);
  });

  it('passes securityGroupId through for product=ecs and includes it in machine response', async () => {
    const calls = [];
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'ecs',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
        securityGroupId: 'sg-test',
      },
      addIpToWhitelist: async (ip, machines) => {
        calls.push(machines[0]);
        return [{ status: 'success', message: 'TCP: added, UDP: added' }];
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 200);
    assert.deepStrictEqual(calls[0], {
      product: 'ecs',
      instanceId: 'i-test',
      regionId: 'cn-hangzhou',
      securityGroupId: 'sg-test',
    });
    assert.strictEqual(ctx.body.machine.securityGroupId, 'sg-test');
  });

  it('returns 502 when service result.status is "error"', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      addIpToWhitelist: async () => [{
        status: 'error',
        message: 'Failed to list ECS rules: AccessDenied',
      }],
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 502);
    assert.strictEqual(ctx.body.success, false);
    assert.strictEqual(ctx.body.status, 'error');
    assert.match(ctx.body.message, /AccessDenied/);
  });

  it('returns 200 with status="partial" when service is partial', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      addIpToWhitelist: async () => [{
        status: 'partial',
        message: 'TCP: added, UDP: failed (...)',
      }],
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 200);
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(ctx.body.status, 'partial');
  });

  it('returns 500 when service throws', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      addIpToWhitelist: async () => { throw new Error('boom'); },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 500);
    assert.strictEqual(ctx.body.success, false);
    assert.match(ctx.body.message, /boom/);
  });

  it('returns 502 when service returns an empty array', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
      addIpToWhitelist: async () => [],
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 502);
    assert.strictEqual(ctx.body.status, 'error');
  });
```

- [ ] **Step 2: Run all controller tests**

Run: `npx egg-bin test test/app/controller/openapi.test.js`
Expected: PASS — 9 passing.

- [ ] **Step 3: Commit controller, router, config**

```bash
git add app/controller/openapi.js app/router.js config/config.default.js test/app/controller/openapi.test.js
git commit -m "$(cat <<'EOF'
feat: add POST /openapi/whitelist endpoint

Reuses addIpToWhitelist service for a single machine. Validates body,
maps service result.status='error' to 502, thrown errors to 500. Route
mounts passwordAuth middleware locally; jwtAuth.skipPaths exempts
/openapi/* so the global JWT gate does not double-process.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the new endpoint to the API table**

Find the API table line:

```
| POST | `/api/whitelist` | 添加 IP 到指定机器白名单 |
```

Add the following line directly after it:

```
| POST | `/openapi/whitelist` | 创建一条白名单规则（OpenAPI，header 鉴权，单机器） |
```

- [ ] **Step 2: Add a paragraph under "认证方式"**

In the `## 认证方式` section, find this paragraph:

```
在此基础上，你还可以额外启用 Face ID / Passkey。它是附加登录方式，不会替代或关闭默认密码登录。
```

Insert directly **after** that paragraph (paste these literal lines, including the inner triple-backtick code block):

````markdown
### OpenAPI 鉴权

`/openapi/*` 路由用 `Authorization: Bearer <PASSWORD>` 直接鉴权，不走 JWT。同 IP 1 分钟内 5 次错误密码会被限流到 429。示例：

```bash
curl -X POST https://gd.rockdai.com/openapi/whitelist \
  -H "Authorization: Bearer $PASSWORD" \
  -d ip=1.2.3.4 -d product=swas-open -d instanceId=i-xxx -d regionId=cn-hangzhou
```
````

- [ ] **Step 3: Visual sanity check**

Open `README.md` and confirm the table row was inserted in the right place and the new section sits under "认证方式".

- [ ] **Step 4: Commit README**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document /openapi/whitelist endpoint and bearer auth

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Run the full test suite, push, open PR

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: PASS — all existing tests + the new middleware (7) and controller (9) tests.

If any pre-existing test fails, do NOT mark it as expected — investigate. The new code only touches new files plus a single regex append in `config.default.js` and a router addition; nothing should break upstream.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/openapi-whitelist-spec
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Add /openapi/whitelist (header-auth single-rule create)" --body "$(cat <<'EOF'
## Summary
- New `POST /openapi/whitelist` endpoint authenticated via `Authorization: Bearer <PASSWORD>`
- Reuses `addIpToWhitelist` service and `gd-web:` rule prefix; no business-logic forks
- New `passwordAuth` middleware mirrors `/api/login` rate-limit semantics; JWT path untouched

## Test plan
- [ ] `npm test` — all suites pass
- [ ] Local smoke: `npm run dev` then `curl -X POST http://127.0.0.1:7001/openapi/whitelist -H "Authorization: Bearer $PASSWORD" -d ip=1.2.3.4 -d product=swas-open -d instanceId=i-test -d regionId=cn-hangzhou` — confirms route mounted, passwordAuth middleware running, form-encoded parsing
- [ ] Local smoke (JSON): same as above with `-H "Content-Type: application/json" -d '{...}'`
- [ ] Local smoke: wrong PASSWORD → 401, then 5 wrong → 429
- [ ] Local smoke: missing `Authorization` header → 401 (no rate-limit hit)
- [ ] Local smoke: confirm JWT-protected `/api/whitelist` still requires `Authorization: Bearer <JWT>` (skipPaths regex shouldn't bleed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (for the implementer)

- `app.middleware.passwordAuth({}, app)` is invoked once per app boot (router.js runs at startup). The rate-limit Map lives at module scope so all requests share it. Multiple Egg workers each have their own Map — this matches `/api/login`'s behavior.
- HMAC salt is `'gd-openapi-auth'`, distinct from `auth.js`'s `'gd-auth-compare'`. This isolation is defense-in-depth, not a security requirement.
- `crypto.timingSafeEqual` requires equal-length buffers; HMAC-SHA256 always returns 32 bytes, so this is always safe.
- The controller calls `addIpToWhitelist(ip, [machine])` which already does protocol expansion (TCP+UDP), `gd-web:` remark, and 24h cleanup. We do not duplicate any of that.
- Rate-limit cleanup interval is `unref()`'d so it won't keep the FC worker alive past natural exit.
- Tests clear `failedAttempts` between runs to avoid order-dependence.
