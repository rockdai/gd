'use strict';

// Bootstrap script for deploying Egg.js to Alibaba Cloud Function Compute (FC)
// FC custom runtime will call this to start the Egg.js application.

const egg = require('egg');

egg.startCluster({
  baseDir: __dirname,
  port: process.env.PORT || 9000,
  workers: 1,
});
