'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  // PWA entry
  router.get('/', controller.home.index);
  // A root-level worker can control the home-screen start_url (/).
  router.get('/sw.js', controller.home.serviceWorker);

  // Authentication
  router.post('/api/login', controller.auth.login);
  router.get('/api/auth/status', controller.passkey.status);
  // Same small bootstrap payload, but JWT middleware verifies the session first.
  // Restoring login must not depend on listing every Alibaba Cloud region.
  router.get('/api/auth/session', controller.passkey.status);
  router.post('/api/passkey/auth/options', controller.passkey.authOptions);
  router.post('/api/passkey/auth/verify', controller.passkey.verifyAuth);
  router.post('/api/passkey/register/options', controller.passkey.registerOptions);
  router.post('/api/passkey/register/verify', controller.passkey.verifyRegistration);

  // Protected API routes (JWT required – enforced by jwtAuth middleware)
  router.get('/api/machines', controller.api.machines);
  router.get('/api/ip-location', controller.api.ipLocation);
  router.post('/api/whitelist', controller.api.addWhitelist);

  // OpenAPI routes (header-based PASSWORD auth, not JWT)
  const passwordAuth = app.middleware.passwordAuth({}, app);
  router.post('/openapi/whitelist', passwordAuth, controller.openapi.addWhitelist);
};
