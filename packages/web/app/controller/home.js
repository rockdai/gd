'use strict';

const { Controller } = require('egg');
const path = require('path');
const fs = require('fs/promises');

let cachedHtml = null;
let cachedServiceWorker = null;

class HomeController extends Controller {
  async index() {
    const { ctx } = this;
    if (!cachedHtml) {
      const htmlPath = path.join(this.app.baseDir, 'app/public/index.html');
      cachedHtml = await fs.readFile(htmlPath, 'utf8');
    }
    ctx.set('content-type', 'text/html; charset=utf-8');
    ctx.body = cachedHtml;
  }

  async serviceWorker() {
    if (!cachedServiceWorker) {
      cachedServiceWorker = await fs.readFile(path.join(this.app.baseDir, 'app/public/sw.js'), 'utf8');
    }
    this.ctx.set('content-type', 'application/javascript; charset=utf-8');
    this.ctx.set('cache-control', 'no-cache');
    this.ctx.body = cachedServiceWorker;
  }
}

module.exports = HomeController;
