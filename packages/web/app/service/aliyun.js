'use strict';

const { Service } = require('egg');
const { resolveCredentials } = require('@gd/shared/src/aliyun-conf');
const {
  GD_WEB_RULE_PREFIX,
  toSourceCidrIp,
  formatDateTime,
  getRuleField,
  isExpiredWebRule,
} = require('@gd/shared/src/firewall-rule');
const {
  listMachines,
  addIpRules,
  cleanupRules,
} = require('@gd/shared/src/machine-firewall');

// 不同 product 的协议/端口/备注字段名，用于构造 TTL 判定谓词
const EXPIRY_FIELDS = {
  ecs: { protocol: 'ipProtocol', port: 'portRange', remark: 'description' },
  'swas-open': { protocol: 'ruleProtocol', port: 'port', remark: 'remark' },
};

class AliyunService extends Service {

  /**
   * Resolve AK/SK from config, env, or .aliyun.conf
   */
  getCredential() {
    const { accessKeyId, accessKeySecret } = this.config.aliyun;
    if (accessKeyId && accessKeySecret) {
      return { accessKeyId, accessKeySecret };
    }
    const cred = resolveCredentials({ cwd: this.app.baseDir });
    if (!cred.accessKeyId || !cred.accessKeySecret) {
      throw new Error('Missing Alibaba Cloud credentials. Set ACCESS_KEY_ID/ACCESS_KEY_SECRET env vars or create .aliyun.conf');
    }
    return { accessKeyId: cred.accessKeyId, accessKeySecret: cred.accessKeySecret };
  }

  /**
   * List all user machines across regions (ECS + SWAS)
   */
  async listMachines() {
    return listMachines({
      credential: this.getCredential(),
      regions: this.config.aliyun.regions || [],
      logger: this.logger,
    });
  }

  /**
   * Add an IP to the whitelist of selected machines
   */
  async addIpToWhitelist(ip, machines) {
    const credential = this.getCredential();
    const sourceCidrIp = toSourceCidrIp(ip);
    const remark = `${GD_WEB_RULE_PREFIX}@${formatDateTime()}`;
    const results = [];

    for (const machine of machines) {
      if (!EXPIRY_FIELDS[machine.product]) {
        results.push({ ...machine, status: 'skipped', message: `Unsupported product: ${machine.product}` });
        continue;
      }
      try {
        // web 是先清后加，且两步各自列举规则。绝不能像 job 那样把一份列举结果传给 addIpRules 的 rules 参数：
        // 清理若删掉了一条与当前 IP 相同的过期 gd-web 规则，过期的列举结果仍会让预检误判"已存在"而不再新增，
        // 该 IP 就会失去访问。
        const cleanup = await this._tryCleanupExpiredWebRules(credential, machine);
        const result = await addIpRules({ credential, machine, sourceCidrIp, remark, logger: this.logger });
        result.message = this._appendCleanupMessage(result.message, cleanup);
        results.push({ ...machine, ...result });
      } catch (err) {
        this.logger.error(`[aliyun] Failed to add IP for ${machine.product}/${machine.instanceId}:`, err);
        results.push({ ...machine, status: 'error', message: err.message });
      }
    }

    return results;
  }

  async _cleanupExpiredWebRules(credential, machine) {
    const fields = EXPIRY_FIELDS[machine.product];
    if (!fields) return { deletedCount: 0 };

    return cleanupRules({
      credential,
      machine,
      logger: this.logger,
      shouldDelete: rule => isExpiredWebRule({
        protocol: getRuleField(rule, fields.protocol),
        port: getRuleField(rule, fields.port),
        remark: getRuleField(rule, fields.remark),
      }),
    });
  }

  async _tryCleanupExpiredWebRules(credential, machine) {
    try {
      return await this._cleanupExpiredWebRules(credential, machine);
    } catch (err) {
      this.logger.warn(`[aliyun] Failed to cleanup expired web rules for ${machine.product}/${machine.instanceId}:`, err);
      return { deletedCount: 0, failed: true };
    }
  }

  _appendCleanupMessage(message, cleanup = {}) {
    const messageParts = [ message ];
    if (cleanup.deletedCount) {
      messageParts.push(`cleaned ${cleanup.deletedCount} expired ${GD_WEB_RULE_PREFIX} rule(s)`);
    }
    if (cleanup.failed) {
      messageParts.push('cleanup failed');
    }
    return messageParts.join('; ');
  }
}

module.exports = AliyunService;
