'use strict';

const { Controller } = require('egg');

class ApiController extends Controller {
  /**
   * GET /api/ip
   * Return the caller's public IP, fetched from get-ip.rockdai.com
   */
  async ip() {
    const { ctx } = this;
    try {
      const ip = await ctx.service.aliyun.getPublicIp();
      ctx.body = { success: true, ip };
    } catch (err) {
      ctx.logger.error('[api/ip] Failed to get public IP:', err);
      ctx.status = 500;
      ctx.body = { success: false, message: err.message };
    }
  }

  /**
   * GET /api/machines
   * List all user machines (ECS instances + SWAS lightweight servers)
   */
  async machines() {
    const { ctx } = this;
    try {
      const machines = await ctx.service.aliyun.listMachines();
      ctx.body = { success: true, machines };
    } catch (err) {
      ctx.logger.error('[api/machines] Failed to list machines:', err);
      ctx.status = 500;
      ctx.body = { success: false, message: err.message };
    }
  }

  /**
   * POST /api/whitelist
   * Add an IP to selected machines' whitelist
   * Body: { ip: string, machines: Array<{ product, instanceId, regionId, securityGroupId? }> }
   */
  async addWhitelist() {
    const { ctx } = this;
    const { ip, machines } = ctx.request.body;

    if (!ip || !Array.isArray(machines) || machines.length === 0) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'ip and machines[] are required' };
      return;
    }

    // Basic IPv4 validation
    const ipv4Regex = /^\d{1,3}(\.\d{1,3}){3}$/;
    if (!ipv4Regex.test(ip)) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'Invalid IPv4 address' };
      return;
    }

    try {
      const results = await ctx.service.aliyun.addIpToWhitelist(ip, machines);
      ctx.body = { success: true, results };
    } catch (err) {
      ctx.logger.error('[api/whitelist] Failed to add whitelist:', err);
      ctx.status = 500;
      ctx.body = { success: false, message: err.message };
    }
  }
}

module.exports = ApiController;
