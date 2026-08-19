'use strict';

const { Controller } = require('egg');
const { issueAccessToken } = require('../../lib/access-token');

class PasskeyController extends Controller {
  async status() {
    const { ctx } = this;
    // 这是登录页的引导端点：passkey 配置坏了（如 PASSKEY_CREDENTIALS_JSON 粘贴错）
    // 只应表现为"passkey 不可用"，不能拖垮整个响应——否则前端拿不到 ipEndpoint，
    // 也没法提示密码登录仍然可用
    let passkeyStatus;
    try {
      passkeyStatus = ctx.service.passkey.getPublicStatus();
    } catch (err) {
      ctx.logger.error('[passkey/status] passkey config is broken, reporting passkey as unavailable:', err);
      passkeyStatus = {
        passkeyConfigured: false,
        passkeyEnrollmentEnabled: false,
        passkeyReady: false,
        approvedCredentialCount: 0,
      };
    }
    ctx.body = {
      success: true,
      ...passkeyStatus,
      ipEndpoint: this.config.ipEndpoint,
    };
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
