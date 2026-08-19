'use strict';

const assert = require('assert');

const PasskeyController = require('../../../app/controller/passkey');

describe('controller/passkey status', () => {
  it('exposes the configured IP endpoint alongside the passkey status', async () => {
    const ctx = {
      app: { config: { ipEndpoint: 'https://ip.example.com' } },
      service: { passkey: { getPublicStatus: () => ({ passkeyReady: false, passkeyConfigured: false }) } },
      body: null,
    };
    await new PasskeyController(ctx).status();
    assert.deepStrictEqual(ctx.body, {
      success: true,
      passkeyReady: false,
      passkeyConfigured: false,
      ipEndpoint: 'https://ip.example.com',
    });
  });

  it('still returns success + ipEndpoint when the passkey config is broken', async () => {
    const errors = [];
    const ctx = {
      app: { config: { ipEndpoint: 'https://ip.example.com' } },
      logger: { error: (...args) => errors.push(args) },
      service: { passkey: { getPublicStatus: () => { throw new Error('PASSKEY_CREDENTIALS_JSON is not valid JSON'); } } },
      body: null,
    };
    await new PasskeyController(ctx).status();
    assert.deepStrictEqual(ctx.body, {
      success: true,
      passkeyConfigured: false,
      passkeyEnrollmentEnabled: false,
      passkeyReady: false,
      approvedCredentialCount: 0,
      ipEndpoint: 'https://ip.example.com',
    });
    assert.strictEqual(errors.length, 1);
  });
});
