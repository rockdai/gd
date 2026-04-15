'use strict';

const { Service } = require('egg');
const { default: ECSClient, DescribeInstancesRequest, DescribeSecurityGroupsRequest, AuthorizeSecurityGroupRequest } = require('@alicloud/ecs20140526');
const { default: SWASClient, ListInstancesRequest, ListFirewallRulesRequest, CreateFirewallRulesRequest } = require('@alicloud/swas-open20200601');
const { resolveCredentials } = require('../../lib/aliyun-conf');

const IP_ENDPOINT = 'https://get-ip.rockdai.com';
const PORT_RANGE = '1/65535';

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
   * Fetch the caller's public IP from get-ip.rockdai.com
   */
  async getPublicIp() {
    const resp = await fetch(IP_ENDPOINT, { headers: { accept: 'text/plain' } });
    if (!resp.ok) throw new Error(`Failed to fetch public ip: ${resp.status}`);
    const text = await resp.text();
    const m = String(text).match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (!m) throw new Error(`Failed to parse ip from response: ${JSON.stringify(text)}`);
    return m[1];
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
    }));
  }

  /**
   * Add an IP to the whitelist of selected machines
   * @param {string} ip - IPv4 address
   * @param {Array} machines - Array of { product, instanceId, regionId, securityGroupId? }
   */
  async addIpToWhitelist(ip, machines) {
    const credential = this.getCredential();
    const sourceCidrIp = ip.includes('/') ? ip : `${ip}/32`;
    const remark = `gd-web@${this._formatDateTime()}`;
    const results = [];

    for (const machine of machines) {
      try {
        if (machine.product === 'ecs') {
          const result = await this._addIpToEcs(credential, machine, sourceCidrIp, remark);
          results.push({ ...machine, ...result });
        } else if (machine.product === 'swas-open') {
          const result = await this._addIpToSwas(credential, machine, sourceCidrIp, remark);
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

    const req = new AuthorizeSecurityGroupRequest({
      regionId,
      securityGroupId,
      ipProtocol: 'TCP',
      portRange: PORT_RANGE,
      sourceCidrIp,
      description,
    });

    try {
      await client.authorizeSecurityGroup(req);
      return { status: 'success', message: 'Rule added' };
    } catch (err) {
      if (err.message && err.message.includes('AuthorizationAlreadyExist')) {
        return { status: 'success', message: 'Rule already exists' };
      }
      throw err;
    }
  }

  /**
   * Add IP to SWAS firewall
   */
  async _addIpToSwas(credential, machine, sourceCidrIp, remark) {
    const { regionId, instanceId } = machine;

    const client = new SWASClient({
      endpoint: `swas.${regionId}.aliyuncs.com`,
      regionId,
      ...credential,
    });

    const req = new CreateFirewallRulesRequest({
      instanceId,
      regionId,
      firewallRules: [{
        port: PORT_RANGE,
        ruleProtocol: 'TCP',
        sourceCidrIp,
        remark,
      }],
    });

    try {
      await client.createFirewallRules(req);
      return { status: 'success', message: 'Firewall rule added' };
    } catch (err) {
      if (err.message && err.message.includes('FirewallRuleAlreadyExist')) {
        return { status: 'success', message: 'Firewall rule already exists' };
      }
      throw err;
    }
  }

  _formatDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}

module.exports = AliyunService;
