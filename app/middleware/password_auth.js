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
