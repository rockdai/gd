#!/usr/bin/env node

'use strict';

const { handleSwasOpen } = require('@gd/shared/src/handler-swas-open');
const { getPublicIp } = require('@gd/shared/src/public-ip');

const DEFAULT_REMARK = 'ecs-dsec-handler';

function usage() {
  return `Usage:
  ecs-dsec-handler [--ip <ip>] [--remark <remark>] [--dry-run]

Examples:
  ecs-dsec-handler
  ecs-dsec-handler --ip 1.2.3.4
  ecs-dsec-handler --remark ecs-dsec-handler
`;
}

function parseArgs(argv) {
  const args = { remark: DEFAULT_REMARK, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--ip') args.ip = argv[++i];
    else if (a === '--remark') args.remark = argv[++i];
    else throw new Error(`Unknown arg: ${a}\n\n${usage()}`);
  }
  return args;
}

(async () => {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(usage());
      process.exit(0);
    }

    const ip = args.ip || await getPublicIp();
    console.log('[ecs-dsec-handler] public ip =', ip);

    const { resolveCredentials } = require('@gd/shared/src/aliyun-conf');
    const { accessKeyId, accessKeySecret, source } = resolveCredentials({ cwd: __dirname });
    if (!accessKeyId || !accessKeySecret) {
      throw new Error('Missing credentials: set env ACCESS_KEY_ID/ACCESS_KEY_SECRET, or create .aliyun.conf (see .aliyun.conf.example)');
    }
    console.log('[ecs-dsec-handler] credential source =', source || '(unknown)');

    const { RuleConfig } = require('@gd/shared/src/rule-config');

    // For now we only implement swas-open, since current config is swas-open.
    for (const conf of RuleConfig) {
      if (conf.product !== 'swas-open') {
        console.log('[ecs-dsec-handler] skip unsupported product:', conf.product);
        continue;
      }
      await handleSwasOpen({
        conf,
        ip,
        remark: args.remark,
        dryRun: args.dryRun,
        credential: { accessKeyId, accessKeySecret },
      });
    }

    console.log('[ecs-dsec-handler] done');
  } catch (err) {
    console.error('[ecs-dsec-handler] ERROR:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
