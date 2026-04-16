'use strict';

const { Controller } = require('egg');

function isValidIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

class ApiController extends Controller {
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
   * GET /api/ip-location?ip=1.2.3.4
   * Resolve an IPv4 address to province/city through the server-side AMap API.
   */
  async ipLocation() {
    const { ctx } = this;
    const ip = String(ctx.query.ip || '').trim();

    if (!ip) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'ip is required' };
      return;
    }

    if (!isValidIpv4(ip)) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'Invalid IPv4 address' };
      return;
    }

    try {
      const result = await ctx.service.ipLocation.lookup(ip);
      ctx.body = { success: true, ...result };
    } catch (err) {
      ctx.logger.error('[api/ip-location] Failed to resolve ip location:', err);
      ctx.status = err.message.includes('Missing AMap Web Service key') ? 500 : 502;
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
    if (!isValidIpv4(ip)) {
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
