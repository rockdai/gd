'use strict';

const { verify } = require('jsonwebtoken');

/**
 * JWT authentication middleware for Egg.js
 *
 * Options (from config.jwtAuth):
 *   - skipPaths: Array of strings or RegExps; requests whose path matches skip auth
 *
 * The JWT secret is read from app.config.jwt.secret so it stays in one place.
 */
module.exports = (options, app) => {
  const skipPaths = options.skipPaths || [];

  return async function jwtAuth(ctx, next) {
    // Allow whitelisted paths through without authentication
    const reqPath = ctx.path;
    const shouldSkip = skipPaths.some(p => {
      if (typeof p === 'string') return reqPath === p;
      if (p instanceof RegExp) return p.test(reqPath);
      return false;
    });

    if (shouldSkip) {
      return await next();
    }

    // Require Authorization: Bearer <token>
    const authHeader = ctx.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { success: false, message: 'Authentication required' };
      return;
    }

    const token = authHeader.substring(7);
    try {
      const decoded = verify(token, app.config.jwt.secret, {
        algorithms: ['HS256'],
      });
      ctx.state.user = decoded;
      await next();
    } catch (err) {
      ctx.logger.debug('[jwtAuth] Token verification failed: %s', err.message);
      ctx.status = 401;
      ctx.body = { success: false, message: 'Invalid or expired token' };
    }
  };
};
