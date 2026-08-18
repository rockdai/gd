'use strict';

const { Service } = require('egg');
const { isValidIpv4 } = require('@gd/shared/src/ip');

class IpLocationService extends Service {
  async lookup(ip) {
    if (!isValidIpv4(ip)) {
      throw this._createError('Invalid IPv4 address', {
        status: 400,
        code: 'INVALID_IPV4',
        publicMessage: 'Invalid IPv4 address',
      });
    }

    const { webServiceKey, ipLocationEndpoint, requestTimeout } = this.config.amap;
    if (!webServiceKey) {
      throw this._createError('Missing AMap Web Service key', {
        status: 500,
        code: 'AMAP_NOT_CONFIGURED',
        publicMessage: 'IP geolocation service is not configured',
      });
    }

    const requestUrl = new URL(ipLocationEndpoint);
    requestUrl.searchParams.set('key', webServiceKey);
    requestUrl.searchParams.set('output', 'JSON');
    requestUrl.searchParams.set('ip', ip);

    let resp;
    try {
      resp = await this.ctx.curl(requestUrl.toString(), {
        method: 'GET',
        dataType: 'json',
        timeout: requestTimeout,
        headers: {
          accept: 'application/json',
        },
      });
    } catch (err) {
      throw this._createError(this._sanitizeErrorMessage(err, webServiceKey), {
        status: 502,
        code: 'AMAP_REQUEST_FAILED',
        publicMessage: 'IP geolocation lookup failed',
      });
    }

    if (resp.status !== 200) {
      throw this._createError(`AMap IP lookup failed with HTTP ${resp.status}`, {
        status: 502,
        code: 'AMAP_BAD_HTTP_STATUS',
        publicMessage: 'IP geolocation lookup failed',
      });
    }

    const data = resp.data || {};
    if (String(data.status) !== '1' || String(data.infocode || '') !== '10000') {
      const message = data.info || data.infocode || 'Unknown error';
      throw this._createError(`AMap IP lookup failed: ${message}`, {
        status: 502,
        code: 'AMAP_LOOKUP_FAILED',
        publicMessage: 'IP geolocation lookup failed',
      });
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

  _sanitizeErrorMessage(err, secret) {
    const message = err && err.message ? err.message : String(err);
    return message
      .replace(/([?&]key=)[^&\s]+/g, '$1[REDACTED]')
      .replaceAll(secret, '[REDACTED]');
  }

  _createError(message, { status, code, publicMessage }) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    err.publicMessage = publicMessage;
    return err;
  }
}

module.exports = IpLocationService;
