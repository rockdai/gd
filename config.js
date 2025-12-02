'use strict';

const DOMAIN = exports.DOMAIN = {
  XFYJ: 'xfyj.limengna.com',
};

exports.RuleConfig = [{
  product: 'swas-open',
  instanceId: '5c7bfc974c694ee498de6bbb7c8e5bab',
  regionId: 'cn-hangzhou',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'de66f0d108914ffa90cc5ee4b07ae178' },
  ],
}, {
  product: 'swas-open',
  instanceId: '1b78d63a2d844ac1b108630558af0aa0',
  regionId: 'ap-northeast-1',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'cc75fecab9b74db0be1548f0f2207b99' },
  ],
}, {
  product: 'swas-open',
  instanceId: '9389372a50d043f4b05048967e0a4f40',
  regionId: 'us-west-1',
  ruleList: [
    { name: DOMAIN.XFYJ, id: '7ea5c24bb3c148c0b67b9719873c6dec' },
  ],
}, {
  // a.keydiary.dev
  product: 'swas-open',
  instanceId: '49526f1e25d646fd92006a212f7e4b6a',
  regionId: 'cn-hongkong',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'c4bcb8dc7a914fe1bacc1e7d6392d09c' },
  ],
}, {
  // hk2.keydiary.dev
  product: 'swas-open',
  instanceId: '93ec79b37aa64740be313a4b4cbaec32',
  regionId: 'cn-hongkong',
  ruleList: [
    { name: DOMAIN.XFYJ, id: '4e15e44f668446c694fb8a4b5132744e' },
  ],
}];
