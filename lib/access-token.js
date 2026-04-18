'use strict';

const { sign } = require('jsonwebtoken');

function issueAccessToken({ secret, expiresIn, method, extraClaims = {} }) {
  return sign(
    {
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
  issueAccessToken,
};
