'use strict';

const assert = require('assert');
const { sign } = require('jsonwebtoken');

const jwtAuth = require('../../../app/middleware/jwt_auth');
const { ACCESS_TOKEN_PURPOSE } = require('../../../lib/access-token');

function createCtx(token) {
  return {
    path: '/api/machines',
    state: {},
    status: 200,
    body: null,
    logger: {
      debug() {},
    },
    get(name) {
      if (name.toLowerCase() === 'authorization' && token) {
        return `Bearer ${token}`;
      }
      return '';
    },
  };
}

describe('jwtAuth middleware', () => {
  it('accepts a valid access token', async () => {
    const secret = 'jwt-secret';
    const middleware = jwtAuth({ skipPaths: [] }, { config: { jwt: { secret } } });
    const token = sign(
      {
        purpose: ACCESS_TOKEN_PURPOSE,
        sub: 'admin',
        authMethod: 'password',
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '1h',
      }
    );

    const ctx = createCtx(token);
    let nextCalled = false;

    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(ctx.state.user.sub, 'admin');
  });

  it('rejects a non-access token even if it is signed with the JWT secret', async () => {
    const secret = 'jwt-secret';
    const middleware = jwtAuth({ skipPaths: [] }, { config: { jwt: { secret } } });
    const token = sign(
      {
        purpose: 'gd-passkey-flow',
        action: 'auth',
        challenge: 'abc',
      },
      secret,
      {
        algorithm: 'HS256',
        expiresIn: '1h',
      }
    );

    const ctx = createCtx(token);
    let nextCalled = false;

    await middleware(ctx, async () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(ctx.status, 401);
    assert.deepStrictEqual(ctx.body, {
      success: false,
      message: 'Invalid or expired token',
    });
  });
});
