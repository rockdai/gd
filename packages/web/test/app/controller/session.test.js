'use strict';

const assert = require('assert');
const path = require('path');
const configure = require('../../../config/config.default');
const configureRoutes = require('../../../app/router');
const jwtAuth = require('../../../app/middleware/jwt_auth');
const PasskeyController = require('../../../app/controller/passkey');
const HomeController = require('../../../app/controller/home');
const { issueAccessToken } = require('../../../lib/access-token');

describe('lightweight session bootstrap', () => {
  const config = configure({ name: 'gd-test', baseDir: path.resolve(__dirname, '../../..') });
  const routes = new Map();
  configureRoutes({
    router: { get: (url, handler) => routes.set(url, handler), post() {} },
    controller: {
      home: { index() {}, serviceWorker: HomeController.prototype.serviceWorker },
      auth: { login() {} }, passkey: { status: PasskeyController.prototype.status },
      api: {}, openapi: {},
    },
    middleware: { passwordAuth() {} },
  });

  function context(token) {
    const headers = {};
    return {
      app: { config, baseDir: path.resolve(__dirname, '../../..') },
      path: '/api/auth/session', state: {},
      get: () => token ? `Bearer ${token}` : '',
      set: (name, value) => { headers[name] = value; }, headers,
      logger: { debug() {}, error() {} },
      service: {
        passkey: { getPublicStatus: () => ({ passkeyReady: false }) },
        get aliyun() { throw new Error('Session verification must not query cloud instances'); },
      },
    };
  }

  it('returns bootstrap config for a valid JWT without a cloud API request', async () => {
    const token = issueAccessToken({ secret: config.jwt.secret, expiresIn: '1h', method: 'password' });
    const ctx = context(token);
    await jwtAuth(config.jwtAuth, ctx.app)(ctx, () => routes.get(ctx.path).call(new PasskeyController(ctx)));
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(ctx.body.ipEndpoint, config.ipEndpoint);
    assert.strictEqual(ctx.headers['cache-control'], 'no-store');
  });

  it('requires a valid access token on the session route', async () => {
    for (const token of [ '', 'invalid', issueAccessToken({ secret: config.jwt.secret, expiresIn: -1, method: 'password' }) ]) {
      const ctx = context(token);
      await jwtAuth(config.jwtAuth, ctx.app)(ctx, () => assert.fail('Unauthenticated session reached controller'));
      assert.strictEqual(ctx.status, 401);
    }
  });

  it('serves the root worker without authentication and with revalidation headers', async () => {
    const ctx = context('');
    ctx.path = '/sw.js';
    await jwtAuth(config.jwtAuth, ctx.app)(ctx, () => routes.get(ctx.path).call(new HomeController(ctx)));
    assert.strictEqual(ctx.headers['cache-control'], 'no-cache');
    assert.match(ctx.headers['content-type'], /javascript/);
    assert.match(ctx.body, /gd-whitelist-v4/);
  });
});
