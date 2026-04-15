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

  // Register JWT auth middleware globally.
  // Paths that do NOT require authentication are listed in skipPaths.
  config.middleware = ['jwtAuth'];
  config.jwtAuth = {
    skipPaths: [
      '/',            // HTML shell (contains login form)
      '/api/login',   // Login endpoint itself
      /^\/public\//,  // Static assets (JS, CSS, manifest, SW)
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

  return config;
};
