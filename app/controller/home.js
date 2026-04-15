'use strict';

const { Controller } = require('egg');
const path = require('path');
const fs = require('fs/promises');

let cachedHtml = null;

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
}

module.exports = HomeController;
