'use strict';

const { Service } = require('egg');
const {
  default: ECSClient,
  DescribeInstancesRequest,
  DescribeSecurityGroupAttributeRequest,
  AuthorizeSecurityGroupRequest,
  RevokeSecurityGroupRequest,
} = require('@alicloud/ecs20140526');
const {
  default: SWASClient,
  ListInstancesRequest,
  CreateFirewallRulesRequest,
  DeleteFirewallRulesRequest,
} = require('@alicloud/swas-open20200601');
const { resolveCredentials } = require('../../lib/aliyun-conf');
const {
  PORT_RANGE,
  RULE_PROTOCOLS,
  GD_WEB_RULE_PREFIX,
  toSourceCidrIp,
  normalizeIpForCompare,
  normalizeProtocol,
  formatDateTime,
  getRuleField,
  isExpiredWebRule,
  isOurManagedRemark,
} = require('../../lib/firewall-rule');
const { listAllFirewallRules } = require('../../lib/swas-firewall');

class AliyunService extends Service {

  /**
   * Resolve AK/SK from config, env, or .aliyun.conf
   */
  getCredential() {
    const { accessKeyId, accessKeySecret } = this.config.aliyun;
    if (accessKeyId && accessKeySecret) {
      return { accessKeyId, accessKeySecret };
    }
    // fallback to env / .aliyun.conf
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
    const credential = this.getCredential();
    const regions = this.config.aliyun.regions || [];
    const machines = [];

    // Fetch ECS instances and SWAS instances in parallel across all regions
    const promises = [];
    for (const regionId of regions) {
      promises.push(this._listEcsInstances(credential, regionId));
      promises.push(this._listSwasInstances(credential, regionId));
    }

    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        machines.push(...result.value);
      } else if (result.status === 'rejected') {
        this.logger.warn('[aliyun] Failed to list instances:', result.reason?.message || result.reason);
      }
    }

    return machines;
  }

  /**
   * List ECS instances in a specific region
   */
  async _listEcsInstances(credential, regionId) {
    const client = new ECSClient({
      endpoint: `ecs.${regionId}.aliyuncs.com`,
      ...credential,
    });

    const req = new DescribeInstancesRequest({
      regionId,
      pageSize: 100,
    });

    const resp = await client.describeInstances(req);
    const instances = resp?.body?.instances?.instance || [];

    return instances.map(inst => ({
      product: 'ecs',
      instanceId: inst.instanceId,
      instanceName: inst.instanceName || inst.hostName || inst.instanceId,
      regionId,
      publicIpAddress: inst.publicIpAddress?.ipAddress || [],
      status: inst.status,
      securityGroupIds: inst.securityGroupIds?.securityGroupId || [],
      tags: (inst.tags?.tag || []).map(t => ({ key: t.tagKey, value: t.tagValue })),
    }));
  }

  /**
   * List SWAS lightweight server instances in a specific region
   */
  async _listSwasInstances(credential, regionId) {
    const client = new SWASClient({
      endpoint: `swas.${regionId}.aliyuncs.com`,
      regionId,
      ...credential,
    });

    const req = new ListInstancesRequest({
      regionId,
      pageSize: 100,
    });

    const resp = await client.listInstances(req);
    const instances = resp?.body?.instances || [];

    return instances.map(inst => ({
      product: 'swas-open',
      instanceId: inst.instanceId,
      instanceName: inst.instanceName || inst.instanceId,
      regionId,
      publicIpAddress: inst.publicIpAddress ? [ inst.publicIpAddress ] : [],
      status: inst.status,
      tags: (inst.tags || []).map(t => ({ key: t.key, value: t.value })),
    }));
  }

  /**
   * Add an IP to the whitelist of selected machines
   * @param {string} ip - IPv4 address
   * @param {Array} machines - Array of { product, instanceId, regionId, securityGroupId? }
   */
  async addIpToWhitelist(ip, machines) {
    const credential = this.getCredential();
    const sourceCidrIp = toSourceCidrIp(ip);
    const description = `${GD_WEB_RULE_PREFIX}@${formatDateTime()}`;
    const results = [];

    for (const machine of machines) {
      try {
        if (machine.product === 'ecs') {
          const cleanup = await this._tryCleanupExpiredWebRules(credential, machine);
          const result = await this._addIpToEcs(credential, machine, sourceCidrIp, description);
          result.message = this._appendCleanupMessage(result.message, cleanup);
          results.push({ ...machine, ...result });
        } else if (machine.product === 'swas-open') {
          const cleanup = await this._tryCleanupExpiredWebRules(credential, machine);
          const result = await this._addIpToSwas(credential, machine, sourceCidrIp, description);
          result.message = this._appendCleanupMessage(result.message, cleanup);
          results.push({ ...machine, ...result });
        } else {
          results.push({ ...machine, status: 'skipped', message: `Unsupported product: ${machine.product}` });
        }
      } catch (err) {
        this.logger.error(`[aliyun] Failed to add IP for ${machine.product}/${machine.instanceId}:`, err);
        results.push({ ...machine, status: 'error', message: err.message });
      }
    }

    return results;
  }

  /**
   * Add IP to ECS security group
   *
   * Pre-checks for existing rules covering the same protocol+port+source before
   * calling AuthorizeSecurityGroup. This protects manually-maintained rules from
   * being touched by any potential upsert behavior in the underlying API.
   */
  async _addIpToEcs(credential, machine, sourceCidrIp, description) {
    const { regionId, securityGroupId } = machine;
    if (!securityGroupId) {
      return { status: 'error', message: 'securityGroupId is required for ECS' };
    }

    const client = new ECSClient({
      endpoint: `ecs.${regionId}.aliyuncs.com`,
      ...credential,
    });
    const protocolResults = [];
    let hasSuccess = false;
    let hasFailure = false;

    let existingRules = [];
    try {
      existingRules = await this._listEcsRules(client, securityGroupId, regionId);
    } catch (err) {
      this.logger.warn(`[aliyun] Failed to list ECS rules for pre-check on ${machine.instanceId}:`, err.message || err);
    }
    const sourceCidrIpNorm = normalizeIpForCompare(sourceCidrIp);

    for (const protocol of RULE_PROTOCOLS) {
      const existing = existingRules.find(rule => (
        normalizeProtocol(getRuleField(rule, 'ipProtocol')) === protocol &&
        getRuleField(rule, 'portRange') === PORT_RANGE &&
        normalizeIpForCompare(getRuleField(rule, 'sourceCidrIp')) === sourceCidrIpNorm
      ));

      if (existing) {
        protocolResults.push(`${protocol}: already exists`);
        hasSuccess = true;
        continue;
      }

      const req = new AuthorizeSecurityGroupRequest({
        regionId,
        securityGroupId,
        ipProtocol: protocol,
        portRange: PORT_RANGE,
        sourceCidrIp,
        description,
      });

      try {
        await client.authorizeSecurityGroup(req);
        protocolResults.push(`${protocol}: added`);
        hasSuccess = true;
      } catch (err) {
        if (err.message && (err.message.includes('AuthorizationAlreadyExist') || err.message.includes('RuleDuplicate'))) {
          protocolResults.push(`${protocol}: already exists`);
          hasSuccess = true;
          continue;
        }
        protocolResults.push(`${protocol}: failed (${err.message})`);
        hasFailure = true;
      }
    }

    return this._buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure });
  }

  async _listEcsRules(client, securityGroupId, regionId) {
    const listReq = new DescribeSecurityGroupAttributeRequest({
      regionId,
      securityGroupId,
      direction: 'ingress',
      maxResults: 1000,
    });
    const listResp = await client.describeSecurityGroupAttribute(listReq);
    return listResp?.body?.permissions?.permission || [];
  }

  /**
   * Add IP to SWAS firewall
   *
   * Pre-checks for existing rules covering the same protocol+port+source before
   * calling CreateFirewallRules. This protects manually-maintained rules from
   * being touched by any potential upsert behavior in the underlying API.
   */
  async _addIpToSwas(credential, machine, sourceCidrIp, description) {
    const { regionId, instanceId } = machine;

    const client = new SWASClient({
      endpoint: `swas.${regionId}.aliyuncs.com`,
      regionId,
      ...credential,
    });
    const protocolResults = [];
    let hasSuccess = false;
    let hasFailure = false;

    let existingRules = [];
    try {
      existingRules = await listAllFirewallRules({ client, instanceId, regionId });
    } catch (err) {
      this.logger.warn(`[aliyun] Failed to list SWAS rules for pre-check on ${instanceId}:`, err.message || err);
    }
    const sourceCidrIpNorm = normalizeIpForCompare(sourceCidrIp);

    for (const protocol of RULE_PROTOCOLS) {
      const existing = existingRules.find(rule => (
        normalizeProtocol(getRuleField(rule, 'ruleProtocol')) === protocol &&
        getRuleField(rule, 'port') === PORT_RANGE &&
        normalizeIpForCompare(getRuleField(rule, 'sourceCidrIp')) === sourceCidrIpNorm
      ));

      if (existing) {
        protocolResults.push(`${protocol}: already exists`);
        hasSuccess = true;
        continue;
      }

      const req = new CreateFirewallRulesRequest({
        instanceId,
        regionId,
        firewallRules: [{
          port: PORT_RANGE,
          ruleProtocol: protocol,
          sourceCidrIp,
          remark: description,
        }],
      });

      try {
        await client.createFirewallRules(req);
        protocolResults.push(`${protocol}: added`);
        hasSuccess = true;
      } catch (err) {
        if (err.message && err.message.includes('FirewallRuleAlreadyExist')) {
          protocolResults.push(`${protocol}: already exists`);
          hasSuccess = true;
          continue;
        }
        protocolResults.push(`${protocol}: failed (${err.message})`);
        hasFailure = true;
      }
    }

    return this._buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure });
  }

  async _cleanupExpiredWebRules(credential, machine) {
    if (machine.product === 'ecs') {
      return await this._cleanupExpiredEcsRules(credential, machine);
    }
    if (machine.product === 'swas-open') {
      return await this._cleanupExpiredSwasRules(credential, machine);
    }
    return { deletedCount: 0 };
  }

  async _cleanupExpiredEcsRules(credential, machine) {
    const { regionId, securityGroupId } = machine;
    if (!securityGroupId) return { deletedCount: 0 };

    const client = new ECSClient({
      endpoint: `ecs.${regionId}.aliyuncs.com`,
      ...credential,
    });

    const rules = await this._listEcsRules(client, securityGroupId, regionId);
    const staleRules = rules.filter(rule => {
      const remark = getRuleField(rule, 'description');
      if (!isOurManagedRemark(remark)) return false;
      return isExpiredWebRule({
        protocol: getRuleField(rule, 'ipProtocol'),
        port: getRuleField(rule, 'portRange'),
        remark,
      });
    });
    const staleRuleIds = staleRules
      .map(rule => getRuleField(rule, 'securityGroupRuleId'))
      .filter(Boolean);

    if (staleRuleIds.length === 0) return { deletedCount: 0 };

    this.logger.info(`[aliyun] Cleaning up ${staleRuleIds.length} expired ECS rule(s) for ${machine.instanceId || securityGroupId}: ${staleRules.map(r => getRuleField(r, 'description')).join(', ')}`);

    const deleteReq = new RevokeSecurityGroupRequest({
      regionId,
      securityGroupId,
      securityGroupRuleId: staleRuleIds,
    });
    await client.revokeSecurityGroup(deleteReq);
    return { deletedCount: staleRuleIds.length };
  }

  async _cleanupExpiredSwasRules(credential, machine) {
    const { regionId, instanceId } = machine;
    const client = new SWASClient({
      endpoint: `swas.${regionId}.aliyuncs.com`,
      regionId,
      ...credential,
    });

    const rules = await listAllFirewallRules({
      client,
      instanceId,
      regionId,
    });
    const staleRules = rules.filter(rule => {
      const remark = getRuleField(rule, 'remark');
      if (!isOurManagedRemark(remark)) return false;
      return isExpiredWebRule({
        protocol: getRuleField(rule, 'ruleProtocol'),
        port: getRuleField(rule, 'port'),
        remark,
      });
    });
    const staleRuleIds = staleRules
      .map(rule => getRuleField(rule, 'ruleId'))
      .filter(Boolean);

    if (staleRuleIds.length === 0) return { deletedCount: 0 };

    this.logger.info(`[aliyun] Cleaning up ${staleRuleIds.length} expired SWAS rule(s) for ${instanceId}: ${staleRules.map(r => getRuleField(r, 'remark')).join(', ')}`);

    const deleteReq = new DeleteFirewallRulesRequest({
      instanceId,
      regionId,
      ruleIds: staleRuleIds,
    });
    await client.deleteFirewallRules(deleteReq);
    return { deletedCount: staleRuleIds.length };
  }

  async _tryCleanupExpiredWebRules(credential, machine) {
    try {
      return await this._cleanupExpiredWebRules(credential, machine);
    } catch (err) {
      this.logger.warn(`[aliyun] Failed to cleanup expired web rules for ${machine.product}/${machine.instanceId}:`, err);
      return {
        deletedCount: 0,
        failed: true,
      };
    }
  }

  _buildProtocolOperationResult(protocolResults, { hasSuccess, hasFailure }) {
    let status = 'success';
    if (hasFailure && hasSuccess) {
      status = 'partial';
    } else if (hasFailure) {
      status = 'error';
    }

    return {
      status,
      message: protocolResults.join(', '),
    };
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
