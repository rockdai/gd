# 构建上下文为仓库根目录：
#   docker build -f packages/job/Dockerfile -t gd-job .
FROM node:20-alpine

WORKDIR /app

# 先只拷贝清单，让依赖层能被缓存。
# 五个 workspace 的 package.json 一个都不能少，也不要加 --workspace 过滤：
# npm 10 在这两种情况下装出来的树都是坏的（@alicloud/credentials 链上的 debug 会丢，
# require('@alicloud/ecs20140526') 直接 Cannot find module 'debug'）。已在 npm 10.9.4 上实测。
# 全量 --omit=dev 只多装 egg 相关约 3.6MB，不值得为此冒险。
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/web/package.json ./packages/web/
COPY packages/scheduler/package.json ./packages/scheduler/
COPY packages/cli/package.json ./packages/cli/
COPY packages/job/package.json ./packages/job/

RUN npm ci --omit=dev

# 只拷 job 真正会 require 到的两个包的源码；web / scheduler / cli 只留上面的清单
COPY packages/shared ./packages/shared
COPY packages/job ./packages/job

CMD ["node", "packages/job/bin/gd-job.js"]
