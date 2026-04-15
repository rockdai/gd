'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;

  // PWA entry
  router.get('/', controller.home.index);

  // API routes
  router.get('/api/machines', controller.api.machines);
  router.post('/api/whitelist', controller.api.addWhitelist);
};
