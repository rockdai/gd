'use strict';

const { isPublicIpv4 } = require('./ip');

const IP_ENDPOINT = 'https://get-ip.rockdai.com';
// 取 IP 的请求必须有界：端点接受了连接但一直不返回，整轮同步就卡死在这里
const IP_FETCH_TIMEOUT_MS = 10 * 1000;

function extractIpv4(text) {
  // Endpoint example: "140.205.11.246%" (may include trailing % / whitespace)
  const m = String(text).match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (!m) return null;
  const ip = m[1];
  // basic sanity
  const parts = ip.split('.').map(n => Number(n));
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ip;
}

async function getPublicIp({ endpoint, timeoutMs = IP_FETCH_TIMEOUT_MS } = {}) {
  const target = endpoint || process.env.IP_ENDPOINT || IP_ENDPOINT;
  const resp = await fetch(target, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`Failed to fetch public ip: ${resp.status}`);
  const text = await resp.text();
  const ip = extractIpv4(text);
  if (!ip) throw new Error(`Failed to parse ip from response: ${JSON.stringify(text)}`);
  // 端点配错（比如指到一个只会回内网地址的自建服务）会拿到 192.168.x.x 之类：
  // 拿它去写规则并清掉真正公网 IP 的规则，等于把自己锁在门外。这里直接拒收。
  if (!isPublicIpv4(ip)) throw new Error(`Endpoint returned a non-public address: ${ip}`);
  return ip;
}

module.exports = { getPublicIp, extractIpv4, IP_ENDPOINT, IP_FETCH_TIMEOUT_MS };
