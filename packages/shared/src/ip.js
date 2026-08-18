'use strict';

const net = require('node:net');

function isValidIpv4(ip) {
  return typeof ip === 'string' && net.isIPv4(ip);
}

module.exports = {
  isValidIpv4,
};
