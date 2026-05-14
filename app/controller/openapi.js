'use strict';

const { Controller } = require('egg');
const { isValidIpv4 } = require('../../lib/ip');

const SUPPORTED_PRODUCTS = new Set([ 'ecs', 'swas-open' ]);

class OpenapiController extends Controller {
  /**
   * POST /openapi/whitelist
   * Body (JSON or form-encoded):
   *   { ip, product, instanceId, regionId, securityGroupId? }
   */
  async addWhitelist() {
    const { ctx } = this;
    const body = ctx.request.body || {};

    const ip = String(body.ip || '').trim();
    const product = String(body.product || '').trim();
    const instanceId = String(body.instanceId || '').trim();
    const regionId = String(body.regionId || '').trim();
    const securityGroupId = body.securityGroupId
      ? String(body.securityGroupId).trim()
      : '';

    if (!ip || !product || !instanceId || !regionId) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'ip, product, instanceId, regionId are required' };
      return;
    }
    if (!isValidIpv4(ip)) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'Invalid IPv4 address' };
      return;
    }
    if (!SUPPORTED_PRODUCTS.has(product)) {
      ctx.status = 400;
      ctx.body = { success: false, message: `Unsupported product: ${product}` };
      return;
    }
    if (product === 'ecs' && !securityGroupId) {
      ctx.status = 400;
      ctx.body = { success: false, message: 'securityGroupId is required for ECS' };
      return;
    }

    const machine = { product, instanceId, regionId };
    if (securityGroupId) machine.securityGroupId = securityGroupId;

    try {
      const results = await ctx.service.aliyun.addIpToWhitelist(ip, [ machine ]);
      const result = (results && results[0]) || { status: 'error', message: 'no result returned' };

      if (result.status === 'error') {
        ctx.status = 502;
        ctx.body = { success: false, status: 'error', message: result.message, machine };
        return;
      }

      ctx.status = 200;
      ctx.body = {
        success: true,
        status: result.status,
        message: result.message,
        machine,
      };
    } catch (err) {
      ctx.logger.error('[openapi/whitelist] Failed to add whitelist:', err);
      ctx.status = 500;
      ctx.body = { success: false, message: err.message };
    }
  }
}

module.exports = OpenapiController;
