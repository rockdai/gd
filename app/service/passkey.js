'use strict';

const { Service } = require('egg');
const { sign, verify } = require('jsonwebtoken');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} = require('@simplewebauthn/server');
const {
  buildCredentialEntryFromRegistrationInfo,
  mergeCredentialEntries,
  parseCredentialEntries,
  serializeCredentialEntries,
  toVerificationCredential,
} = require('../../lib/passkey');

const FLOW_PURPOSE = 'gd-passkey-flow';
const FLOW_ACTION_AUTH = 'auth';
const FLOW_ACTION_REGISTER = 'register';

class PasskeyService extends Service {
  getConfig() {
    const passkey = this.app.config.passkey;
    const credentials = parseCredentialEntries(passkey.credentialsJson);
    const rpID = String(passkey.rpID || '').trim();
    const origin = String(passkey.origin || '').trim();
    const enabled = passkey.enabled !== false;
    const ready = enabled && !!rpID && !!origin;

    return {
      ...passkey,
      credentials,
      enabled,
      origin,
      ready,
      rpID,
    };
  }

  getPublicStatus() {
    const config = this.getConfig();

    return {
      passkeyConfigured: config.credentials.length > 0,
      passkeyEnrollmentEnabled: config.ready && config.enrollmentEnabled !== false,
      passkeyReady: config.ready,
      approvedCredentialCount: config.credentials.length,
    };
  }

  async generateAuthenticationOptions() {
    const config = this.getConfig();
    this.assertPasskeyReady(config);

    if (config.credentials.length === 0) {
      throw this.createPublicError(403, '服务端尚未批准任何可用的 Face ID / Passkey 凭证');
    }

    const optionsJSON = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: config.credentials.map(credential => ({
        id: credential.id,
        transports: credential.transports,
      })),
      userVerification: 'required',
    });

    return {
      flowToken: this.issueFlowToken({
        action: FLOW_ACTION_AUTH,
        challenge: optionsJSON.challenge,
      }),
      optionsJSON,
    };
  }

  async verifyAuthentication({ response, flowToken }) {
    const config = this.getConfig();
    this.assertPasskeyReady(config);

    if (config.credentials.length === 0) {
      throw this.createPublicError(403, '服务端尚未批准任何可用的 Face ID / Passkey 凭证');
    }

    const payload = this.verifyFlowToken(flowToken, FLOW_ACTION_AUTH);
    const credentialId = String(response && response.id || '').trim();
    if (!credentialId) {
      throw this.createPublicError(400, '缺少 passkey 凭证 ID');
    }

    const approvedCredential = config.credentials.find(item => item.id === credentialId);
    if (!approvedCredential) {
      throw this.createPublicError(401, '当前设备未获准登录');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: payload.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        credential: toVerificationCredential(approvedCredential),
      });
    } catch (err) {
      this.ctx.logger.warn('[passkey/auth] Verification failed: %s', err.message);
      throw this.createPublicError(401, 'Face ID / Passkey 验证失败');
    }

    if (!verification.verified) {
      throw this.createPublicError(401, 'Face ID / Passkey 验证失败');
    }

    const newCounter = verification.authenticationInfo && verification.authenticationInfo.newCounter;
    const updatedCredentialsJson = Number.isInteger(newCounter) && newCounter !== approvedCredential.counter
      ? serializeCredentialEntries(mergeCredentialEntries(config.credentials, {
        ...approvedCredential,
        counter: newCounter,
      }))
      : null;

    return {
      credentialId,
      updatedCredentialsJson,
    };
  }

  async generateRegistrationOptions() {
    const config = this.getConfig();
    this.assertPasskeyReady(config);

    if (config.enrollmentEnabled === false) {
      throw this.createPublicError(403, '当前服务已禁用新增 Face ID / Passkey 绑定');
    }

    const optionsJSON = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userName: config.userName,
      userDisplayName: config.userDisplayName,
      userID: Buffer.from(config.userID, 'utf8'),
      attestationType: 'none',
      excludeCredentials: config.credentials.map(credential => ({
        id: credential.id,
        transports: credential.transports,
      })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });

    return {
      flowToken: this.issueFlowToken({
        action: FLOW_ACTION_REGISTER,
        challenge: optionsJSON.challenge,
      }),
      optionsJSON,
    };
  }

  async verifyRegistration({ response, flowToken }) {
    const config = this.getConfig();
    this.assertPasskeyReady(config);

    if (config.enrollmentEnabled === false) {
      throw this.createPublicError(403, '当前服务已禁用新增 Face ID / Passkey 绑定');
    }

    const payload = this.verifyFlowToken(flowToken, FLOW_ACTION_REGISTER);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: payload.challenge,
        expectedOrigin: config.origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      this.ctx.logger.warn('[passkey/register] Verification failed: %s', err.message);
      throw this.createPublicError(400, '无法完成当前设备的 Face ID / Passkey 绑定');
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw this.createPublicError(400, '无法完成当前设备的 Face ID / Passkey 绑定');
    }

    const credential = buildCredentialEntryFromRegistrationInfo(verification.registrationInfo);
    const approvedCredentials = mergeCredentialEntries(config.credentials, credential);

    return {
      approvedCredentialCount: approvedCredentials.length,
      approvedCredentialsJson: serializeCredentialEntries(approvedCredentials),
      credential,
      requiresManualApproval: true,
    };
  }

  assertPasskeyReady(config) {
    if (!config.enabled) {
      throw this.createPublicError(403, '服务端已禁用 Face ID / Passkey 登录');
    }
    if (!config.rpID || !config.origin) {
      throw this.createPublicError(503, '服务端尚未完成 Face ID / Passkey 配置');
    }
  }

  issueFlowToken({ action, challenge }) {
    return sign(
      {
        purpose: FLOW_PURPOSE,
        action,
        challenge,
      },
      this.app.config.jwt.secret,
      {
        algorithm: 'HS256',
        expiresIn: this.app.config.passkey.challengeExpiresInSec,
      }
    );
  }

  verifyFlowToken(flowToken, expectedAction) {
    if (!flowToken || typeof flowToken !== 'string') {
      throw this.createPublicError(400, '缺少 passkey 挑战票据');
    }

    let payload;
    try {
      payload = verify(flowToken, this.app.config.jwt.secret, {
        algorithms: [ 'HS256' ],
      });
    } catch (err) {
      throw this.createPublicError(400, 'passkey 挑战票据已失效，请重试');
    }

    if (payload.purpose !== FLOW_PURPOSE || payload.action !== expectedAction) {
      throw this.createPublicError(400, 'passkey 挑战票据无效，请重试');
    }

    if (!payload.challenge || typeof payload.challenge !== 'string') {
      throw this.createPublicError(400, 'passkey 挑战票据无效，请重试');
    }

    return payload;
  }
  createPublicError(status, message) {
    const err = new Error(message);
    err.status = status;
    err.publicMessage = message;
    return err;
  }
}

module.exports = PasskeyService;
