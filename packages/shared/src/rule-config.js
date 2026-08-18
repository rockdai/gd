'use strict';

const DOMAIN = exports.DOMAIN = {
  XFYJ: 'xfyj.keydiary.dev',
  XFYJ_BK: 'xfyj2.keydiary.dev',
};

exports.RuleConfig = [{
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
  instanceId: '9389372a50d043f4b05048967e0a4f40',
  regionId: 'us-west-1',
  ruleList: [
    { name: DOMAIN.XFYJ, id: '7ea5c24bb3c148c0b67b9719873c6dec' },
    { name: DOMAIN.XFYJ_BK, id: 'ec66ce20a3af441082fa4cf1323d9d40' },
  ],
}, {
  // i-bp1hrakbpd2a3kmmrxb9
  product: 'ecs',
  groupId: 'sg-bp16x7uldelv1s1tqisl',
  regionId: 'cn-hangzhou',
  ruleList: [
    { name: DOMAIN.XFYJ },
    { name: DOMAIN.XFYJ_BK },
  ],
}, {
  // i-6we5bo95gjitc6gjbvrd (z.keydiary.dev)
  product: 'ecs',
  groupId: 'sg-6we8w7b53xb740p9vypz',
  regionId: 'ap-northeast-1',
  ruleList: [
    { name: DOMAIN.XFYJ },
    { name: DOMAIN.XFYJ_BK },
  ],
}, {
  // a.keydiary.dev
  product: 'swas-open',
  instanceId: '0e86734f0efc44c38d510c56358bad5e',
  regionId: 'cn-hongkong',
  ruleList: [
    { name: DOMAIN.XFYJ, id: '351ba5164d41414e9dcc8ca00840f8b6' },
    { name: DOMAIN.XFYJ_BK },
  ],
}, {
  // b.keydiary.dev
  product: 'swas-open',
  instanceId: '316697f46fad405193bdd6e134e5b64e',
  regionId: 'cn-hongkong',
  ruleList: [
    { name: DOMAIN.XFYJ, id: '64415df03cd94c0f9385f4106960b584' },
    { name: DOMAIN.XFYJ_BK },
  ],
}];
