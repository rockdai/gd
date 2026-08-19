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
});
