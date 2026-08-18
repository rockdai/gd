'use strict';

const net = require('node:net');

function isValidIpv4(ip) {
  return typeof ip === 'string' && net.isIPv4(ip);
}

// 不能作为"公网 IP"写进白名单的段：私网、回环、链路本地、CGNAT、组播、保留、0.0.0.0/8
// 注意：web 端用户手填 IP 走 isValidIpv4，不用这个——VPC 内网机器互相放行是合法需求
const NON_PUBLIC_IPV4 = [
  [ '0.0.0.0', 8 ],
  [ '10.0.0.0', 8 ],
  [ '100.64.0.0', 10 ],
  [ '127.0.0.0', 8 ],
  [ '169.254.0.0', 16 ],
  [ '172.16.0.0', 12 ],
  [ '192.168.0.0', 16 ],
  [ '224.0.0.0', 3 ],
];

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPublicIpv4(ip) {
  if (!isValidIpv4(ip)) return false;
  const value = ipv4ToInt(ip);
  return !NON_PUBLIC_IPV4.some(([ base, bits ]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  });
}

module.exports = {
  isValidIpv4,
  isPublicIpv4,
};
