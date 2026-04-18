'use strict';

const assert = require('assert');
const { verify } = require('jsonwebtoken');

const { issueAccessToken } = require('../../lib/access-token');

describe('lib/access-token', () => {
  it('issues an HS256 access token with the auth method claim', () => {
    const token = issueAccessToken({
      secret: 'test-secret',
      expiresIn: '1h',
      method: 'passkey',
      extraClaims: { scope: 'admin' },
    });

    const payload = verify(token, 'test-secret', { algorithms: [ 'HS256' ] });
    assert.strictEqual(payload.sub, 'admin');
    assert.strictEqual(payload.authMethod, 'passkey');
    assert.strictEqual(payload.scope, 'admin');
  });
});
