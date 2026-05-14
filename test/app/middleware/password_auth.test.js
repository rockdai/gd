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

  it('returns 500 when PASSWORD env var is not set', async () => {
    delete process.env.PASSWORD;
    const middleware = buildMiddleware();
    const ctx = createCtx({ token: 'anything' });
    await middleware(ctx, async () => {});
    assert.strictEqual(ctx.status, 500);
    assert.strictEqual(ctx.body.success, false);
    assert.match(ctx.body.message, /PASSWORD/);
  });
});
