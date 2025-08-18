'use strict';

const DOMAIN = exports.DOMAIN = {
  XFYJ: 'xfyj.limengna.com',
  XFYJ_BK: 'fn.rockdai.top',
};

exports.RuleConfig = [{
  product: 'ecs',
  groupId: 'sg-bp15zc9odnod2fdkyid4',
  regionId: 'cn-hangzhou',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'sgr-bp1h6rk3pgct6dzmdfiw' },
    { name: DOMAIN.XFYJ_BK, id: 'sgr-bp1fvr0ojwfsynjdk423' },
  ],
}, {
  product: 'swas-open',
  instanceId: '5c7bfc974c694ee498de6bbb7c8e5bab',
  regionId: 'cn-hangzhou',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'de66f0d108914ffa90cc5ee4b07ae178' },
    { name: DOMAIN.XFYJ_BK, id: '48dc7007353e490baf79e1104e566dc0' },
  ],
}, {
  product: 'swas-open',
  instanceId: '1b78d63a2d844ac1b108630558af0aa0',
  regionId: 'ap-northeast-1',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'cc75fecab9b74db0be1548f0f2207b99' },
    { name: DOMAIN.XFYJ_BK, id: 'c6023c53805b4a4d9feab50aa497dac5' },
  ],
}, {
  product: 'swas-open',
  instanceId: '8cddeed727534e3fbfcdc426c2eeb5a2',
  regionId: 'cn-hangzhou',
  ruleList: [
    { name: DOMAIN.XFYJ, id: 'c97e325c56df4f2ba3df36553185e79e' },
    { name: DOMAIN.XFYJ_BK, id: '09dcbccdf474475daa7a7b39fbd64b07' },
  ],
}, {
  product: 'swas-open',
  instanceId: '9389372a50d043f4b05048967e0a4f40',
  regionId: 'us-west-1',
  ruleList: [
    { name: DOMAIN.XFYJ, id: '7ea5c24bb3c148c0b67b9719873c6dec' },
    { name: DOMAIN.XFYJ_BK, id: 'ec66ce20a3af441082fa4cf1323d9d40' },
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
