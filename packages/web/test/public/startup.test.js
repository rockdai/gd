'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '../../app/public/index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const status = { success: true, ipEndpoint: 'https://ip.example.test', passkeyReady: true, passkeyConfigured: true };

// Exercise the actual inline startup script with controllable network timing.
// No real credentials, cloud APIs or browser dependencies are needed in CI.
function page({ token = '', fetch }) {
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const tag = match[0];
    const classes = new Set((tag.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/));
    elements.set(match[1], {
      style: Object.fromEntries((tag.match(/style="([^"]*)"/)?.[1] || '').split(';').filter(Boolean).map(s => s.split(':').map(v => v.trim()))),
      value: '', textContent: '', innerHTML: '', disabled: false,
      focus() {},
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value),
      },
    });
  }
  const listeners = {}, registrations = [], timers = new Map(), requests = [];
  const storage = new Map(token ? [ [ 'gd_token', token ] ] : []);
  const bodyClasses = new Set([ 'app-locked' ]);
  const context = vm.createContext({
    console: { warn() {} }, AbortController,
    setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch: (url, options) => { requests.push(url); return fetch(url, options); },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    window: { PublicKeyCredential: function () {} },
    navigator: { credentials: {}, serviceWorker: { register: (...args) => { registrations.push(args); return Promise.resolve(); } } },
    document: {
      body: { classList: { toggle: (value, enabled) => enabled ? bodyClasses.add(value) : bodyClasses.delete(value) } },
      getElementById: id => elements.get(id),
      querySelectorAll: () => [],
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
  });
  vm.runInContext(script, context);
  return { context, elements, registrations, timers, requests, storage, bodyClasses, start: () => listeners.DOMContentLoaded() };
}

describe('web startup', () => {
  it('shows password login and registers the root worker without waiting for auth status', () => {
    const p = page({ fetch: () => new Promise(() => {}) });
    p.start();
    assert.strictEqual(p.elements.get('loginForm').style.display, 'block');
    assert.strictEqual(p.elements.get('loginLoading').style.display, 'none');
    assert.strictEqual(p.registrations[0][0], '/sw.js');
    assert.strictEqual(p.registrations[0][1].scope, '/');
    assert.deepStrictEqual(p.requests, [ '/api/auth/status' ]);
  });

  it('unlocks after session verification while machines and IP are still pending', async () => {
    const session = deferred();
    const p = page({ token: 'saved-token', fetch: url => url === '/api/auth/session' ? session.promise : new Promise(() => {}) });
    p.start();
    assert(p.bodyClasses.has('app-locked'));
    assert.strictEqual(p.elements.get('loginLoading').style.display, 'flex');
    assert.strictEqual(p.registrations.length, 1);
    session.resolve(json(status));
    await flush();
    assert(!p.bodyClasses.has('app-locked'));
    assert(p.elements.get('loginOverlay').classList.contains('hidden'));
    assert.deepStrictEqual(p.requests, [ '/api/auth/session', status.ipEndpoint, '/api/machines' ]);
  });

  it('clears an expired session and loads public login options without listing machines', async () => {
    const p = page({ token: 'expired-token', fetch: async url => url === '/api/auth/session' ? new Response('', { status: 401 }) : json(status) });
    p.start();
    await flush();
    assert(p.bodyClasses.has('app-locked'));
    assert(!p.storage.has('gd_token'));
    assert.strictEqual(p.elements.get('loginForm').style.display, 'block');
    assert.strictEqual(p.elements.get('passkeyLoginBtn').style.display, 'block');
    assert.deepStrictEqual(p.requests, [ '/api/auth/session', '/api/auth/status' ]);
  });

  it('keeps the saved token and offers retry when session verification is offline', async () => {
    const p = page({ token: 'saved-token', fetch: async () => { throw new Error('offline'); } });
    p.start();
    await flush();
    assert(p.bodyClasses.has('app-locked'));
    assert.strictEqual(p.storage.get('gd_token'), 'saved-token');
    assert.strictEqual(p.elements.get('retrySessionBtn').style.display, 'block');
    assert.strictEqual(p.elements.get('loginForm').style.display, 'block');
  });

  it('times out a stalled response body and leaves login usable', async () => {
    const p = page({ token: 'saved-token', fetch: async (url, { signal }) => ({
      ok: true,
      json: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      })),
    }) });
    p.start();
    await flush();
    for (const timeout of p.timers.values()) timeout();
    await flush();
    assert.strictEqual(p.timers.size, 0);
    assert.strictEqual(p.elements.get('retrySessionBtn').style.display, 'block');
    assert.strictEqual(p.elements.get('loginLoading').style.display, 'none');
  });

  it('waits for the configured IP endpoint after a fast password login, but not for machines', async () => {
    const bootstrap = deferred();
    const p = page({ fetch: url => url === '/api/auth/status' ? bootstrap.promise : new Promise(() => {}) });
    p.start();
    const login = p.context.finishLogin('new-token');
    assert(!p.bodyClasses.has('app-locked'));
    assert.deepStrictEqual(p.requests, [ '/api/auth/status', '/api/machines' ]);
    bootstrap.resolve(json(status));
    await login;
    assert.deepStrictEqual(p.requests, [ '/api/auth/status', '/api/machines', status.ipEndpoint ]);
  });

  it('does not repopulate cards from responses arriving after logout', async () => {
    const machineBody = deferred(), ipBody = deferred();
    const p = page({ token: 'saved-token', fetch: async url => {
      if (url === '/api/auth/session') return json(status);
      return { ok: true, status: 200, json: () => machineBody.promise, text: () => ipBody.promise };
    } });
    p.start();
    await flush();
    p.context.logout();
    machineBody.resolve({ success: true, machines: [ { instanceId: 'private-instance' } ] });
    ipBody.resolve('1.2.3.4');
    await flush();
    assert.strictEqual(p.elements.get('currentIp').textContent, '-');
    assert.strictEqual(p.elements.get('machineListContainer').innerHTML, '<div class="empty-state">请先登录</div>');
    assert(p.bodyClasses.has('app-locked'));
  });

  it('ignores a late 401 from an old token after a new login', async () => {
    const oldRequest = deferred();
    const p = page({ token: 'old-token', fetch: () => oldRequest.promise });
    const pending = p.context.authFetch('/api/machines');
    p.context.storeAuthToken('new-token');
    oldRequest.resolve(new Response('', { status: 401 }));
    await assert.rejects(pending, /STALE_AUTH/);
    assert.strictEqual(p.storage.get('gd_token'), 'new-token');
  });
});
