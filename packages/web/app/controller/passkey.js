'use strict';

const { Controller } = require('egg');
const { issueAccessToken } = require('../../lib/access-token');

class PasskeyController extends Controller {
  async status() {
    const { ctx } = this;
    try {
      ctx.body = {
        success: true,
        ...ctx.service.passkey.getPublicStatus(),
        ipEndpoint: this.config.ipEndpoint,
      };
    } catch (err) {
      this.handleError('passkey/status', err);
    }
  }

  async authOptions() {
    const { ctx } = this;
    try {
      const result = await ctx.service.passkey.generateAuthenticationOptions();
      ctx.body = { success: true, ...result };
    } catch (err) {
      this.handleError('passkey/auth-options', err);
    }
  }

  async verifyAuth() {
    const { ctx, app } = this;
    try {
      const { credential, flowToken } = ctx.request.body || {};
      const result = await ctx.service.passkey.verifyAuthentication({
        response: credential,
        flowToken,
      });

      ctx.body = {
        success: true,
        token: issueAccessToken({
          secret: app.config.jwt.secret,
          expiresIn: app.config.jwt.expiresIn,
          method: 'passkey',
        }),
      };
    } catch (err) {
      this.handleError('passkey/verify-auth', err);
    }
  }

  async registerOptions() {
    const { ctx } = this;
    try {
      const result = await ctx.service.passkey.generateRegistrationOptions();
      ctx.body = { success: true, ...result };
    } catch (err) {
      this.handleError('passkey/register-options', err);
    }
  }

  async verifyRegistration() {
    const { ctx } = this;
    try {
      const { credential, flowToken } = ctx.request.body || {};
      const result = await ctx.service.passkey.verifyRegistration({
        response: credential,
        flowToken,
      });

      ctx.body = {
        success: true,
        ...result,
      };
    } catch (err) {
      this.handleError('passkey/verify-registration', err);
    }
  }

  handleError(scope, err) {
    const { ctx } = this;
    const status = err.status || 500;
    const message = err.publicMessage || 'Internal server error';

    if (status >= 500) {
      ctx.logger.error('[%s] %s', scope, err.stack || err.message);
    } else {
      ctx.logger.warn('[%s] %s', scope, err.message);
    }

    ctx.status = status;
    ctx.body = {
      success: false,
      message,
    };
  }
}

module.exports = PasskeyController;
