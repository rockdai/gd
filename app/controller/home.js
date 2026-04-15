'use strict';

const { Controller } = require('egg');
const path = require('path');
const fs = require('fs');

class HomeController extends Controller {
  async index() {
    const { ctx } = this;
    const htmlPath = path.join(this.app.baseDir, 'app/public/index.html');
    ctx.set('content-type', 'text/html; charset=utf-8');
    ctx.body = fs.readFileSync(htmlPath, 'utf8');
  }
}

module.exports = HomeController;
