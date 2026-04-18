'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  // PWA entry
  router.get('/', controller.home.index);

  // Authentication
  router.post('/api/login', controller.auth.login);
  router.get('/api/auth/status', controller.passkey.status);
  router.post('/api/passkey/auth/options', controller.passkey.authOptions);
  router.post('/api/passkey/auth/verify', controller.passkey.verifyAuth);
  router.post('/api/passkey/register/options', controller.passkey.registerOptions);
  router.post('/api/passkey/register/verify', controller.passkey.verifyRegistration);

  // Protected API routes (JWT required – enforced by jwtAuth middleware)
  router.get('/api/machines', controller.api.machines);
  router.get('/api/ip-location', controller.api.ipLocation);
  router.post('/api/whitelist', controller.api.addWhitelist);
};
