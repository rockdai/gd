'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../../app/public/sw.js'), 'utf8');
const origin = 'https://gd.example.test';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function worker(fetch, { cacheUnavailable = false } = {}) {
  const handlers = {}, entries = new Map(), deleted = [];
  let precached;
  const cache = {
    async match(key) { return entries.get(key)?.clone(); },
    async put(key, response) { entries.set(key, response.clone()); },
    async addAll(requests) { precached = requests; },
  };
  vm.runInNewContext(source, {
    URL,
    Request: class extends Request {
      constructor(url, opts) { super(new URL(url, origin), opts); }
    },
    fetch,
    caches: {
      open: async () => {
        if (cacheUnavailable) throw new Error('Cache storage unavailable');
        return cache;
      },
      keys: async () => [ 'gd-whitelist-v3', 'gd-whitelist-v4', 'another-app' ],
      delete: async key => { deleted.push(key); },
    },
    self: {
      location: { origin },
      addEventListener: (name, callback) => { handlers[name] = callback; },
      skipWaiting() {}, clients: { claim() {} },
    },
  });
  function dispatch(name, request) {
    const waits = [];
    let response;
    handlers[name]({ request, waitUntil: promise => waits.push(promise), respondWith: promise => { response = promise; } });
    return { response, done: () => Promise.all(waits) };
  }
  return { entries, deleted, dispatch, precached: () => precached };
}

const request = (pathname = '/', method = 'GET') => ({ url: new URL(pathname, origin).href, method, mode: 'navigate' });

describe('PWA shell caching', () => {
  it('returns cached HTML before a slow network responds, then refreshes it for the next visit', async () => {
    const network = deferred();
    const w = worker(() => network.promise);
    w.entries.set('/', new Response('cached shell'));
    const event = w.dispatch('fetch', request('/?from=home-screen'));
    assert.strictEqual(await (await event.response).text(), 'cached shell');
    network.resolve(new Response('updated shell'));
    await event.done();
    assert.strictEqual(await w.entries.get('/').text(), 'updated shell');
  });

  it('returns and caches a successful network response on the first visit', async () => {
    const w = worker(async () => new Response('first shell'));
    const event = w.dispatch('fetch', request());
    assert.strictEqual(await (await event.response).text(), 'first shell');
    await event.done();
    assert.strictEqual(await w.entries.get('/').text(), 'first shell');
  });

  it('still serves the network response when browser cache storage is unavailable', async () => {
    const w = worker(async () => new Response('network shell'), { cacheUnavailable: true });
    const event = w.dispatch('fetch', request());
    assert.strictEqual(await (await event.response).text(), 'network shell');
    await event.done();
  });

  for (const [ label, fetch ] of [
    [ 'offline', async () => { throw new Error('offline'); } ],
    [ 'server errors', async () => new Response('unavailable', { status: 503 }) ],
    [ 'redirects', async () => ({ ok: true, redirected: true }) ],
  ]) {
    it(`preserves working HTML on ${label}`, async () => {
      const w = worker(fetch);
      w.entries.set('/', new Response('working shell'));
      const event = w.dispatch('fetch', request());
      assert.strictEqual(await (await event.response).text(), 'working shell');
      await event.done();
      assert.strictEqual(await w.entries.get('/').text(), 'working shell');
    });
  }

  it('never intercepts APIs, writes, cross-origin IP lookups or unknown URLs', () => {
    const w = worker(() => { throw new Error('must not fetch or cache this request'); });
    for (const req of [
      request('/api/auth/session'), request('/api/machines'), request('/api/auth/status'),
      request('/openapi/whitelist', 'POST'), request('/', 'POST'), request('/unknown'),
      request('https://ip.example.test/'), request('/sw.js'),
    ]) {
      assert.strictEqual(w.dispatch('fetch', req).response, undefined);
    }
  });

  it('bypasses the HTTP cache when installing assets and only removes its own old caches', async () => {
    const w = worker(() => {});
    await w.dispatch('install').done();
    assert(w.precached().some(req => req.url === origin + '/'));
    assert(w.precached().every(req => req.cache === 'reload'));
    await w.dispatch('activate').done();
    assert.deepStrictEqual(w.deleted, [ 'gd-whitelist-v3' ]);
  });
});
