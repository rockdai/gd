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

  // Protected API routes (JWT required – enforced by jwtAuth middleware)
  router.get('/api/machines', controller.api.machines);
  router.post('/api/whitelist', controller.api.addWhitelist);
};
