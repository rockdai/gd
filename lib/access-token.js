'use strict';

const { sign } = require('jsonwebtoken');

const ACCESS_TOKEN_PURPOSE = 'access';

function issueAccessToken({ secret, expiresIn, method, extraClaims = {} }) {
  return sign(
    {
      purpose: ACCESS_TOKEN_PURPOSE,
      sub: 'admin',
      authMethod: method,
      ...extraClaims,
    },
    secret,
    {
      algorithm: 'HS256',
      expiresIn,
    }
  );
}

module.exports = {
  ACCESS_TOKEN_PURPOSE,
  issueAccessToken,
};
