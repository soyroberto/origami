'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createFlow} = require('../beta/auth-client.js');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');

function fixture(overrides = {}) {
  const events = [], calls = [], oauth = [], timers = new Map();
  let session = {access_token: 'test-token-not-production'}, sequence = 0;
  const client = {auth: {
    getSession: async () => ({data: {session}, error: null}),
    signInWithOAuth: async value => { oauth.push(value); return {error: null}; },
    signOut: async () => { session = null; return {error: null}; }
  }};
  const flow = createFlow({client, callbackUrl: 'http://localhost:8683/auth/callback',
    request: async (url, init) => { calls.push({url, init}); return url === '/api/logout' ? {ok: true} : {
      authenticated: true, authorized: false, user: {id: 'owner-uuid', email: 'owner@example.test'}
    }; },
    onState: value => events.push(value), schedule: fn => {timers.set(++sequence, fn); return sequence;},
    cancel: id => timers.delete(id), ...overrides});
  return {flow, client, events, calls, oauth, timers, setSession: value => {session = value;}};
}

test('verified but unapproved server session stays pending', async () => {
  const f = fixture(); await f.flow.sync();
  assert.equal(f.events.at(-1).phase, 'pending');
  assert.equal(f.calls[0].url, '/api/session');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer test-token-not-production');
  assert.equal(f.calls[0].init.body, '{}');
  assert.equal(f.timers.size, 1); f.flow.stop(); assert.equal(f.timers.size, 0);
});
test('only explicit server authorization opens gallery', async () => {
  const f = fixture({request: async () => ({authenticated: true, authorized: true, user: {id: 'owner-uuid'}})});
  await f.flow.sync(); assert.equal(f.events.at(-1).phase, 'authorized'); f.flow.stop();
});
test('truthy authorization strings cannot open gallery', async () => {
  const f = fixture({request: async () => ({authenticated: true, authorized: 'true', user: {id: 'owner-uuid'}})});
  await f.flow.sync(); assert.equal(f.events.at(-1).phase, 'pending'); f.flow.stop();
});
test('missing session clears server cookie and never starts gallery', async () => {
  const f = fixture(); f.setSession(null); await f.flow.sync();
  assert.equal(f.events.at(-1).phase, 'signed-out');
  assert.deepEqual(f.calls.map(call => call.url), ['/api/logout']); assert.equal(f.timers.size, 0);
});
test('server errors lock access even with a local SDK token', async () => {
  const f = fixture({request: async () => {throw new Error('401');}});
  await f.flow.sync(); assert.equal(f.events.at(-1).phase, 'error'); assert.equal(f.timers.size, 0);
});
test('malformed authenticated server response fails closed', async () => {
  const f = fixture({request: async () => ({authorized: true, user: {id: 'owner-uuid'}})});
  await f.flow.sync(); assert.equal(f.events.at(-1).phase, 'error');
});
test('Google and Microsoft use fixed PKCE return route; Microsoft asks for email only', async () => {
  const f = fixture(); await f.flow.signIn('google'); await f.flow.signIn('azure');
  assert.equal(f.oauth[0].provider, 'google'); assert.equal(f.oauth[1].provider, 'azure');
  assert.equal(f.oauth[1].options.scopes, 'email');
  for (const item of f.oauth) assert.equal(item.options.redirectTo, 'http://localhost:8683/auth/callback');
  assert.equal(f.oauth[1].options.queryParams.prompt, 'select_account');
  await assert.rejects(f.flow.signIn('unknown')); f.flow.stop();
});
test('provider configuration errors remain logged out', async () => {
  const f = fixture(); f.client.auth.signInWithOAuth = async () => ({error: new Error('provider disabled')});
  await f.flow.signIn('azure'); assert.equal(f.events.at(-1).phase, 'error');
});
test('sign out hides gallery immediately and clears both sessions', async () => {
  const f = fixture(); await f.flow.sync(); await f.flow.signOut();
  assert.equal(f.events.at(-2).phase, 'signing-out'); assert.equal(f.events.at(-1).phase, 'signed-out');
  assert.equal(f.calls.at(-1).url, '/api/logout'); assert.equal(f.timers.size, 0);
});
test('failed server sign out is not claimed as successful', async () => {
  const f = fixture({request: async () => {throw new Error('offline');}});
  await f.flow.signOut(); assert.equal(f.events.at(-1).phase, 'error');
});
test('late verification cannot reopen gallery after sign out', async () => {
  let resolve;
  const f = fixture({request: async url => url === '/api/logout' ? {ok: true} : new Promise(done => {resolve = done;})});
  const pending = f.flow.sync(); await new Promise(done => setImmediate(done));
  await f.flow.signOut(); resolve({authenticated: true, authorized: true, user: {id: 'owner-uuid'}});
  await pending; assert.equal(f.events.at(-1).phase, 'signed-out'); assert.equal(f.timers.size, 0);
});
test('stopping flow prevents stale results and refresh timers', async () => {
  let resolve; const f = fixture({request: () => new Promise(done => {resolve = done;})});
  const pending = f.flow.sync(); await new Promise(done => setImmediate(done));
  f.flow.stop(); resolve({authenticated: true, authorized: true, user: {id: 'owner-uuid'}});
  await pending; assert.equal(f.events.length, 0); assert.equal(f.timers.size, 0);
});
test('beta entry is isolated and has no public-photo fallback or inline gallery boot', () => {
  const html = fs.readFileSync(path.join(root, 'beta/index.html'), 'utf8');
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.getElementById('private-gallery').hidden, true);
  assert.equal(dom.window.document.querySelectorAll('script:not([src])').length, 0);
  assert.equal(/f\d+\.jpe?g|saauxfotos/.test(html), false);
  dom.window.close();
});


test('DOM boot gates gallery mounting and destroys every component on revocation or logout', async (t) => {
  const {boot} = require('../beta/auth-client.js');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'beta/index.html'), 'utf8'), {
    url: 'http://localhost:8683/auth/callback?code=test-only', runScripts: 'outside-only'
  });
  const win = dom.window;
  win.eval(fs.readFileSync(path.join(root, 'jquery-1.8.3.js'), 'utf8'));
  win.OrigamiAuthBeta = {};
  let session = null, authorized = false, fail = false;
  const counters = {attach: 0, mount: 0, sourceStop: 0, playbackDestroy: 0, layoutDestroy: 0};
  win.supabase = {createClient: (_url, _key, options) => {
    assert.equal(options.auth.flowType, 'pkce');
    return {auth: {
      getSession: async () => ({data: {session}, error: null}),
      onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}}),
      signInWithOAuth: async () => ({error: null}),
      signOut: async () => {session = null; return {error: null};}
    }};
  }};
  win.fetch = async (url, init) => {
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    if (url === '/api/client-config') return {ok: true, json: async () => ({configured: true, supabaseUrl: 'https://example.supabase.co', publishableKey: 'test-public-key'})};
    if (url === '/api/logout') return {ok: true, json: async () => ({authenticated: false})};
    assert.equal(url, '/api/session');
    return {ok: !fail, status: fail ? 401 : 200, json: async () => ({authenticated: true, authorized, user: {id: 'test-only-uuid', email: 'owner@example.test'}})};
  };
  // Lifecycle spies cover boot's delegation; the real visual modules are unchanged.
  win.ShiftingTilesPlayer = {attach: gallery => {
    counters.attach++;
    gallery.data('shiftingtiles-layout', {destroy() {counters.layoutDestroy++;}});
  }};
  win.ShiftingTilesPhotos = {mount: (gallery, images, options) => {
    counters.mount++; assert.deepEqual(images, []); assert.equal(options.libraryId, 'spotify');
    gallery.append('<div class="test-tile"></div>');
    gallery.data('shiftingtiles-source', {stop() {counters.sourceStop++;}});
    gallery.data('shiftingtiles-playback', {destroy() {counters.playbackDestroy++;}});
  }};
  t.after(() => {win.OrigamiAuthBeta.flow?.stop(); win.close();});
  const gallery = win.document.getElementById('private-gallery');
  await boot(win);
  const flow = win.OrigamiAuthBeta.flow;
  assert.equal(gallery.hidden, true); assert.equal(counters.mount, 0);
  assert.equal(win.document.getElementById('sign-in-google').disabled, false);
  assert.equal(win.location.pathname, '/'); assert.equal(win.location.search, '');
  session = {access_token: 'unit-test-session'};
  await flow.sync(); assert.equal(gallery.hidden, true); assert.equal(counters.mount, 0);
  fail = true;
  await flow.sync(); assert.equal(gallery.hidden, true); assert.equal(counters.mount, 0);
  fail = false; authorized = true;
  await flow.sync(); await flow.sync();
  assert.equal(gallery.hidden, false); assert.equal(counters.mount, 1); assert.equal(counters.attach, 1);
  authorized = false;
  await flow.sync(); assert.equal(gallery.hidden, true); assert.equal(gallery.children.length, 0);
  assert.equal(counters.sourceStop, 1); assert.equal(counters.playbackDestroy, 1); assert.equal(counters.layoutDestroy, 1);
  authorized = true;
  await flow.sync(); await flow.signOut();
  assert.equal(gallery.hidden, true); assert.equal(gallery.children.length, 0);
  assert.equal(counters.mount, 2); assert.equal(counters.sourceStop, 2);
  assert.equal(counters.playbackDestroy, 2); assert.equal(counters.layoutDestroy, 2);
});
