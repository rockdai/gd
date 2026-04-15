'use strict';

const { Controller } = require('egg');
const { sign } = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * In-memory rate limiter for login attempts.
 * Key: client IP → Array of timestamps (within the last WINDOW_MS).
 */
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000; // 1 minute

// Periodically purge stale entries so the Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempts] of loginAttempts) {
    const recent = attempts.filter(t => now - t < WINDOW_MS);
    if (recent.length === 0) {
      loginAttempts.delete(ip);
    } else {
      loginAttempts.set(ip, recent);
    }
  }
}, 5 * 60 * 1000).unref(); // every 5 min, unref so it won't keep the process alive

class AuthController extends Controller {
  /**
   * POST /api/login
   * Body: { password: string }
   * Returns: { success: true, token: string } or 4xx error
   */
  async login() {
    const { ctx, app } = this;
    const { password } = ctx.request.body;

    // --- rate-limit check ---
    const clientIp = ctx.ip;
    const now = Date.now();
    const attempts = (loginAttempts.get(clientIp) || []).filter(t => now - t < WINDOW_MS);

    if (attempts.length >= MAX_ATTEMPTS) {
      ctx.status = 429;
      ctx.body = { success: false, message: '登录尝试过于频繁，请稍后再试' };
      return;
    }

    // --- PASSWORD env var guard ---
    const configuredPassword = process.env.PASSWORD;
    if (!configuredPassword) {
      ctx.logger.error('[auth] PASSWORD env var is not set – login is impossible');
      ctx.status = 500;
      ctx.body = { success: false, message: 'Server not configured: PASSWORD env var is not set' };
      return;
    }

    if (!password || typeof password !== 'string') {
      ctx.status = 400;
      ctx.body = { success: false, message: '请输入密码' };
      return;
    }

    // --- timing-safe comparison ---
    // HMAC normalises both values to a fixed-length digest so that
    // crypto.timingSafeEqual can be used regardless of input lengths.
    // This is a runtime comparison – the password is NOT stored.
    const hmac = str => crypto.createHmac('sha256', 'gd-auth-compare').update(str).digest();
    const isValid = crypto.timingSafeEqual(hmac(password), hmac(configuredPassword));

    if (!isValid) {
      attempts.push(now);
      loginAttempts.set(clientIp, attempts);
      ctx.status = 401;
      ctx.body = { success: false, message: '密码错误' };
      return;
    }

    // --- success: issue JWT ---
    loginAttempts.delete(clientIp); // clear on success

    const jwtSecret = app.config.jwt.secret;
    const token = sign(
      { iat: Math.floor(now / 1000) },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn: app.config.jwt.expiresIn || '24h',
      }
    );

    ctx.body = { success: true, token };
  }
}

module.exports = AuthController;
