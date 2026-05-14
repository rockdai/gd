'use strict';

const path = require('path');
const crypto = require('crypto');

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
  const config = {};

  // use env var or appInfo.name as cookie sign key
  config.keys = process.env.EGG_KEYS || (appInfo.name + '_' + Date.now());

  // close CSRF for API usage
  config.security = {
    csrf: {
      enable: false,
    },
  };

  // static file serving
  config.static = {
    prefix: '/public/',
    dir: path.join(appInfo.baseDir, 'app/public'),
  };

  // ---- JWT authentication ----
  // Secret: use JWT_SECRET env var for token persistence across restarts,
  // otherwise generate a random secret (tokens invalidated on restart).
  config.jwt = {
    secret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    expiresIn: '24h',
  };

  config.passkey = {
    enabled: process.env.PASSKEY_ENABLED !== 'false',
    rpName: process.env.PASSKEY_RP_NAME || 'GD',
    rpID: process.env.PASSKEY_RP_ID || 'gd.rockdai.com',
    origin: process.env.PASSKEY_ORIGIN || 'https://gd.rockdai.com',
    userName: process.env.PASSKEY_USER_NAME || 'admin',
    userDisplayName: process.env.PASSKEY_USER_DISPLAY_NAME || 'GD Admin',
    userID: process.env.PASSKEY_USER_ID || 'gd-admin',
    credentialsJson: process.env.PASSKEY_CREDENTIALS_JSON || '[]',
    enrollmentEnabled: process.env.PASSKEY_ENROLLMENT_ENABLED !== 'false',
    challengeExpiresInSec: Math.max(60, Number(process.env.PASSKEY_CHALLENGE_TTL_SEC || 300) || 300),
    flowTokenSecret: process.env.PASSKEY_FLOW_TOKEN_SECRET || crypto
      .createHash('sha256')
      .update(`gd-passkey-flow:${config.jwt.secret}`)
      .digest('hex'),
    counterStoreFile: process.env.PASSKEY_COUNTERS_FILE || path.join(appInfo.baseDir, 'run', 'passkey-counters.json'),
  };

  // Register JWT auth middleware globally.
  // Paths that do NOT require authentication are listed in skipPaths.
  config.middleware = ['jwtAuth'];
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

  // aliyun credentials – read from env or .aliyun.conf
  config.aliyun = {
    accessKeyId: process.env.ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ACCESS_KEY_SECRET || '',
    // Common regions to scan for instances
    regions: [
      'cn-hangzhou',
      'cn-shanghai',
      'cn-beijing',
      'cn-shenzhen',
      'cn-hongkong',
      'ap-northeast-1',
      'ap-southeast-1',
      'us-west-1',
      'us-east-1',
      'eu-central-1',
    ],
  };

  // AMap Web Service API key for server-side IP geolocation lookup.
  // Keep this in the backend environment so it never reaches the browser.
  config.amap = {
    webServiceKey: process.env.AMAP_WEB_SERVICE_KEY || '',
    ipLocationEndpoint: 'https://restapi.amap.com/v3/ip',
    requestTimeout: 5000,
  };

  return config;
};
