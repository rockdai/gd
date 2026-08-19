# Contributing

- 任何改动都走 PR：新建分支 → push → 提 PR → CI 通过 + 评审后合并；不要直接 push `main`
- 提交前 `npm ci && npm test`（Node 20 / 22 / 24 都会在 CI 跑）
- 涉及规则读写的改动，请保持「只动 `gd-*` 前缀规则」这条契约不变，并补测试
- 不要提交任何凭据、实例 ID、安全组 ID（`.aliyun.conf`、`rule-config.json`、`docker-compose.yml` 已在 `.gitignore`）
