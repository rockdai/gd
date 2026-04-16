'use strict';

const { Service } = require('egg');

class IpLocationService extends Service {
  async lookup(ip) {
    if (!this._isValidIpv4(ip)) {
      throw new Error('Invalid IPv4 address');
    }

    const { webServiceKey, ipLocationEndpoint, requestTimeout } = this.config.amap;
    if (!webServiceKey) {
      throw new Error('Missing AMap Web Service key. Set AMAP_WEB_SERVICE_KEY');
    }

    const requestUrl = new URL(ipLocationEndpoint);
    requestUrl.searchParams.set('key', webServiceKey);
    requestUrl.searchParams.set('output', 'JSON');
    requestUrl.searchParams.set('ip', ip);

    const resp = await this.ctx.curl(requestUrl.toString(), {
      method: 'GET',
      dataType: 'json',
      timeout: requestTimeout,
      headers: {
        accept: 'application/json',
      },
    });

    if (resp.status !== 200) {
      throw new Error(`AMap IP lookup failed with HTTP ${resp.status}`);
    }

    const data = resp.data || {};
    if (String(data.status) !== '1' || String(data.infocode || '') !== '10000') {
      const message = data.info || data.infocode || 'Unknown error';
      throw new Error(`AMap IP lookup failed: ${message}`);
    }

    const province = this._normalizeText(data.province);
    const city = this._normalizeText(data.city);

    return {
      province,
      city,
      adcode: this._normalizeText(data.adcode),
      rectangle: this._normalizeText(data.rectangle),
      location: this._formatLocation(province, city),
    };
  }

  _formatLocation(province, city) {
    if (!province && !city) return '';
    if (!city || city === province) return province || city;
    return `${province} ${city}`.trim();
  }

  _normalizeText(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[]') return '';
    return trimmed;
  }

  _isValidIpv4(ip) {
    if (typeof ip !== 'string') return false;
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
  }
}

module.exports = IpLocationService;
