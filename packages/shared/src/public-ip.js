'use strict';

const IP_ENDPOINT = 'https://get-ip.rockdai.com';

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

async function getPublicIp({ endpoint } = {}) {
  const target = endpoint || process.env.IP_ENDPOINT || IP_ENDPOINT;
  const resp = await fetch(target, { headers: { accept: 'text/plain' } });
  if (!resp.ok) throw new Error(`Failed to fetch public ip: ${resp.status}`);
  const text = await resp.text();
  const ip = extractIpv4(text);
  if (!ip) throw new Error(`Failed to parse ip from response: ${JSON.stringify(text)}`);
  return ip;
}

module.exports = { getPublicIp, extractIpv4, IP_ENDPOINT };
