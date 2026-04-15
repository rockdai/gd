'use strict';

const path = require('path');

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
  const config = {};

  // use appInfo.name as cookie sign key
  config.keys = appInfo.name + '_1713168000000';

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
