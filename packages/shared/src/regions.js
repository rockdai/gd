'use strict';

// 扫描实例时覆盖的地域。web 与 job 共用同一份，避免两处维护。
const DEFAULT_REGIONS = [
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
];

function resolveRegions(value = process.env.REGIONS) {
  const list = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_REGIONS;
}

module.exports = { DEFAULT_REGIONS, resolveRegions };
