# Security Policy

gd 会直接修改阿里云 ECS 安全组 / 轻量应用服务器防火墙规则。如果你发现：

- 能让 gd 删除或改写**不是**它自己创建的规则（remark 不以 `gd-web:` / `gd-ddns:` / `gd-cli:` / `gd-job:` 开头）
- 能绕过 Web / OpenAPI 鉴权
- 凭据（AK/SK、密码、JWT、Passkey）泄露到日志、响应或镜像里

请**不要**公开提 issue，直接发邮件到 <me@rockdai.com>，或用 GitHub 的 [私密漏洞报告](https://github.com/rockdai/gd/security/advisories/new)。我会尽快回复并在修复后致谢。

## 使用建议

- 给 gd 的 AK 用独立 RAM 用户、只授它实际调用的动作，别用主账号 AK：
  - ECS：`DescribeInstances`、`DescribeSecurityGroupAttribute`、`AuthorizeSecurityGroup`、`RevokeSecurityGroup`、`ModifySecurityGroupRule`
  - 轻量应用服务器（swas-open）：`ListInstances`、`ListFirewallRules`、`CreateFirewallRules`、`DeleteFirewallRules`、`ModifyFirewallRule`
- 只在受信任的网络暴露 Web 服务；OpenAPI 密码用足够长的随机串
