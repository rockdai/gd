#!/usr/bin/env node

'use strict';

const { loadConfig } = require('../src/config');
const { runOnce } = require('../src/sync');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[gd-job] invalid configuration: ${err.message}`);
    process.exit(1);
  }

  console.log(`[gd-job] started: label=${config.label} interval=${config.intervalSeconds}s regions=${config.regions.join(',')}`);
  if (config.allow.length) console.log(`[gd-job] allow: ${config.allow.join(', ')}`);
  if (config.deny.length) console.log(`[gd-job] deny: ${config.deny.join(', ')}`);

  // 容器里 Node 是 PID 1，内核不给 PID 1 施加默认信号处置——不注册 handler 的话
  // `docker stop` 发的 SIGTERM 会被无视，10 秒后被 SIGKILL。
  // 直接退出是安全的：每次 API 调用都是原子的，程序无状态，中途打断的一轮下次启动会完整重做。
  for (const signal of [ 'SIGINT', 'SIGTERM' ]) {
    process.on(signal, () => {
      console.log(`[gd-job] received ${signal}, exiting`);
      process.exit(0);
    });
  }

  // 启动即同步一次，不等第一个间隔：NAS 重启后要尽快恢复访问
  for (;;) {
    try {
      await runOnce({ config, logger: console });
    } catch (err) {
      // 兜底：任何未预期的异常都不该让容器退出，下一轮继续重试
      console.error('[gd-job] unexpected error in sync round:', err);
    }
    await sleep(config.intervalSeconds * 1000);
  }
}

main();
