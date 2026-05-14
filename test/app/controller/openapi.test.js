'use strict';

const assert = require('assert');

const OpenapiController = require('../../../app/controller/openapi');

function noopLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function createCtx({ body = {}, addIpToWhitelist = async () => [] } = {}) {
  return {
    app: { config: {} },
    request: { body },
    service: {
      aliyun: { addIpToWhitelist },
    },
    getLogger: noopLogger,
    logger: noopLogger(),
    status: 200,
    body: null,
  };
}

describe('controller/openapi addWhitelist', () => {
  const VALID_SWAS_BODY = Object.freeze({
    ip: '1.2.3.4',
    product: 'swas-open',
    instanceId: 'i-test',
    regionId: 'cn-hangzhou',
  });

  it('returns 200 with the flattened machine result on success', async () => {
    const calls = [];
    const ctx = createCtx({
      body: { ...VALID_SWAS_BODY },
      addIpToWhitelist: async (ip, machines) => {
        calls.push({ ip, machines });
        return [{
          ...machines[0],
          status: 'success',
          message: 'TCP: added, UDP: added',
        }];
      },
    });
    const ctrl = new OpenapiController(ctx);

    await ctrl.addWhitelist();

    assert.strictEqual(ctx.status, 200);
    assert.deepStrictEqual(ctx.body, {
      success: true,
      status: 'success',
      message: 'TCP: added, UDP: added',
      machine: { product: 'swas-open', instanceId: 'i-test', regionId: 'cn-hangzhou' },
    });
    assert.deepStrictEqual(calls, [{
      ip: '1.2.3.4',
      machines: [{ product: 'swas-open', instanceId: 'i-test', regionId: 'cn-hangzhou' }],
    }]);
  });

  it('returns 400 when required fields are missing', async () => {
    const ctx = createCtx({ body: { ip: '1.2.3.4' } });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /required/);
  });

  it('returns 400 for invalid IPv4', async () => {
    const ctx = createCtx({
      body: {
        ip: 'not-an-ip',
        product: 'swas-open',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /IPv4/);
  });

  it('returns 400 for unsupported product', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'gcp',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /Unsupported product/);
  });

  it('returns 400 when product=ecs but securityGroupId is missing', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'ecs',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /securityGroupId/);
  });

  it('passes securityGroupId through for product=ecs and includes it in machine response', async () => {
    const calls = [];
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 'ecs',
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
        securityGroupId: 'sg-test',
      },
      addIpToWhitelist: async (ip, machines) => {
        calls.push(machines[0]);
        return [{ status: 'success', message: 'TCP: added, UDP: added' }];
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 200);
    assert.deepStrictEqual(calls[0], {
      product: 'ecs',
      instanceId: 'i-test',
      regionId: 'cn-hangzhou',
      securityGroupId: 'sg-test',
    });
    assert.strictEqual(ctx.body.machine.securityGroupId, 'sg-test');
  });

  it('returns 502 when service result.status is "error"', async () => {
    const ctx = createCtx({
      body: { ...VALID_SWAS_BODY },
      addIpToWhitelist: async () => [{
        status: 'error',
        message: 'Failed to list ECS rules: AccessDenied',
      }],
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 502);
    assert.strictEqual(ctx.body.success, false);
    assert.strictEqual(ctx.body.status, 'error');
    assert.match(ctx.body.message, /AccessDenied/);
  });

  it('returns 200 with status="partial" when service is partial', async () => {
    const ctx = createCtx({
      body: { ...VALID_SWAS_BODY },
      addIpToWhitelist: async () => [{
        status: 'partial',
        message: 'TCP: added, UDP: failed (...)',
      }],
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 200);
    assert.strictEqual(ctx.body.success, true);
    assert.strictEqual(ctx.body.status, 'partial');
  });

  it('returns 500 when service throws', async () => {
    const ctx = createCtx({
      body: { ...VALID_SWAS_BODY },
      addIpToWhitelist: async () => { throw new Error('boom'); },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 500);
    assert.strictEqual(ctx.body.success, false);
    assert.match(ctx.body.message, /boom/);
  });

  it('returns 502 when service returns an empty array', async () => {
    const ctx = createCtx({
      body: { ...VALID_SWAS_BODY },
      addIpToWhitelist: async () => [],
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 502);
    assert.strictEqual(ctx.body.status, 'error');
  });

  it('returns "Unsupported product" (not "required") when product is numeric 0', async () => {
    const ctx = createCtx({
      body: {
        ip: '1.2.3.4',
        product: 0,
        instanceId: 'i-test',
        regionId: 'cn-hangzhou',
      },
    });
    const ctrl = new OpenapiController(ctx);
    await ctrl.addWhitelist();
    assert.strictEqual(ctx.status, 400);
    assert.match(ctx.body.message, /Unsupported product/);
  });
});
