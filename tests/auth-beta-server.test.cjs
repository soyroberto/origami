'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createServer } = require('../beta/server.cjs');
const { readAllowlist, updateAllowlist } = require('../beta/access.cjs');

// Synthetic IDs/keys/tokens exist only in temporary unit-test fixtures. The
// stub accepts an explicit token registry, NOT claims/email as authentication.
const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const CONFIG = { supabaseUrl: 'https://test-project.supabase.co', publishableKey: 'sb_publishable_unit_test_only_0123456789' };
const PHOTO_NAMES = ['f1.jpeg', 'f2.jpeg', 'f3.jpeg', 'f5.jpeg', 'f6.jpeg', 'f7.jpeg', 'f8.jpeg', 'f10.jpeg'];
const PREFIX = '/photos/onedrive/spotify/';
const ROOT_ASSETS = ['version.js', 'jquery-1.8.3.js', 'album-queue.js', 'shiftingtiles.js', 'gallery-layout.js', 'gallery-player.js', 'gallery-source.js', 'shiftingtiles.less', 'less-2.5.1.min.js'];
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function jwt(claims) {
  return [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), crypto.randomBytes(32).toString('base64url')].join('.');
}

async function fixture(t, options = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'origami-auth-beta-'));
  const betaDir = path.join(rootDir, 'beta');
  fs.mkdirSync(path.join(betaDir, 'vendor'), { recursive: true });
  for (const name of ROOT_ASSETS) fs.writeFileSync(path.join(rootDir, name), '/* test asset: ' + name + ' */');
  for (const name of PHOTO_NAMES) fs.writeFileSync(path.join(rootDir, name), PHOTO);
  fs.writeFileSync(path.join(rootDir, 'f11.jpeg'), 'not in beta');
  fs.writeFileSync(path.join(betaDir, 'index.html'), '<!doctype html><title>Unit fixture</title>');
  fs.writeFileSync(path.join(betaDir, 'auth-client.js'), '/* test client */');
  fs.writeFileSync(path.join(betaDir, 'auth.css'), 'body { color: white; }');
  fs.writeFileSync(path.join(betaDir, 'vendor', 'supabase.js'), '/* test SDK fixture, not auth */');
  fs.writeFileSync(path.join(betaDir, 'config.local.json'), JSON.stringify(CONFIG));
  const allowlistPath = path.join(betaDir, 'authorized-users.local.json');
  const registry = new Map();
  let calls = 0;
  let upstreamError = false;
  function register(claims = {}, user = {}) {
    const token = jwt({ sub: USER_ID, email: 'roberto@rober.to', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
    registry.set(token, { data: { user: { id: USER_ID, email: 'roberto@rober.to', app_metadata: { providers: ['google', 'azure', 'email', 'github'] },
      identities: [{ provider: 'google' }], user_metadata: { private_token: token }, ...user } }, error: null });
    return token;
  }
  const verifyToken = async (token) => {
    calls++;
    if (upstreamError) throw new Error('Private upstream details MUST NOT escape');
    return registry.get(token) || { data: { user: null }, error: new Error('Invalid signature') };
  };
  const server = createServer({ rootDir, betaDir, allowlistPath, port: 0, config: CONFIG, verifyToken, ...options });
  t.after(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  function request(url, input = {}) {
    const method = input.method || 'GET';
    const headers = { Host: 'localhost:' + port, Connection: 'close', ...input.headers };
    const body = input.body;
    if (body !== undefined && !input.chunked) headers['Content-Length'] = Buffer.byteLength(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          let data;
          try { data = JSON.parse(text); } catch (_) { data = null; }
          resolve({ status: res.statusCode, headers: res.headers, bytes, text, data });
        });
        res.on('error', reject);
      });
      req.setTimeout(7000, () => req.destroy(new Error('Unit HTTP timeout')));
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
  let browserCookie;
  async function login(token, input = {}) {
    if (!browserCookie) browserCookie = cookie(await request('/api/client-config'));
    const suppliedCookie = input.headers?.Cookie;
    return request('/api/session', { method: 'POST', ...input,
      headers: { Origin: 'http://localhost:' + port, Authorization: 'Bearer ' + token, ...input.headers,
        Cookie: [browserCookie, suppliedCookie].filter(Boolean).join('; ') } });
  }
  function allow(ids = [USER_ID]) { fs.writeFileSync(allowlistPath, JSON.stringify({ version: 1, userIds: ids })); }
  return { rootDir, betaDir, allowlistPath, server, port, request, login, register, allow,
    get calls() { return calls; }, set upstreamError(value) { upstreamError = value; } };
}

function cookie(response) {
  assert.ok(response.headers['set-cookie']);
  return response.headers['set-cookie'][0].split(';')[0];
}
function commonHeaders(response) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
}
function advanceClock(t, milliseconds) {
  const original = Date.now;
  const future = original() + milliseconds;
  Date.now = () => future;
  t.after(() => { Date.now = original; });
}

test('public health/config disclose no sessions or private files; headers are protective', async (t) => {
  const f = await fixture(t);
  const health = await f.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.data, { ok: true, mode: 'local-auth-beta' });
  commonHeaders(health);
  const config = await f.request('/api/client-config');
  assert.equal(config.status, 200);
  assert.deepEqual(config.data, { configured: true, ...CONFIG, callbackPath: '/auth/callback' });
  commonHeaders(config);
  assert.equal(f.calls, 0);
  assert.equal((await f.request('/api/session')).status, 401);
});

test('unconfigured and malformed/secret configuration fail closed', async (t) => {
  const forbidden = [null, {}, { ...CONFIG, supabaseUrl: 'http://test-project.supabase.co' },
    { ...CONFIG, supabaseUrl: 'https://supabase.co.attacker.test' },
    { ...CONFIG, supabaseUrl: 'https://test-project.supabase.co.attacker.test' },
    { ...CONFIG, supabaseUrl: 'https://user:secret@test-project.supabase.co' },
    { ...CONFIG, supabaseUrl: 'https://test-project.supabase.co/path' },
    { ...CONFIG, publishableKey: 'sb_secret_test_private_key' },
    { ...CONFIG, publishableKey: jwt({ role: 'service_role' }) },
    { ...CONFIG, publishableKey: 'arbitrary-key' }];
  for (const config of forbidden) {
    const f = await fixture(t, { config });
    const res = await f.request('/api/client-config');
    assert.equal(res.status, 503);
    assert.deepEqual(res.data, { configured: false });
    assert.equal((await f.login(f.register())).status, 503);
    assert.equal(f.calls, 0);
    assert.equal((await f.request(PREFIX + 'f1.jpeg')).status, 401);
  }
});

test('config.local.json is read privately; missing or malformed file denies configuration', async (t) => {
  const f = await fixture(t, { config: undefined });
  // An explicit undefined config is invalid, never an implicit development bypass.
  assert.equal((await f.request('/api/client-config')).status, 503);
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'origami-config-test-'));
  fs.mkdirSync(path.join(privateRoot, 'beta'));
  t.after(() => fs.rmSync(privateRoot, { recursive: true, force: true }));
  const verifier = async () => ({ data: { user: null }, error: null });
  async function checkFile(content, expected) {
    const target = path.join(privateRoot, 'beta', 'config.local.json');
    if (content === null) fs.rmSync(target, { force: true });
    else fs.writeFileSync(target, content);
    const server = createServer({ rootDir: privateRoot, port: 0, verifyToken: verifier });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const actualPort = server.address().port;
      const response = await new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port: actualPort, path: '/api/client-config', headers: { Host: 'localhost:' + actualPort } }, (res) => {
          res.resume(); res.on('end', () => resolve(res.statusCode));
        }).on('error', reject);
      });
      assert.equal(response, expected);
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  }
  await checkFile(null, 503);
  await checkFile('{malformed', 503);
  await checkFile(JSON.stringify(CONFIG), 200);
});

test('anonymous requests get JSON 401 on manifest and every direct private photo', async (t) => {
  const f = await fixture(t);
  for (const name of ['gallery.json', ...PHOTO_NAMES]) {
    const response = await f.request(PREFIX + name);
    assert.equal(response.status, 401);
    assert.deepEqual(response.data, { authenticated: false });
    assert.match(response.headers['content-type'], /^application\/json/);
    assert.equal(response.headers.location, undefined);
    commonHeaders(response);
  }
  const bearerOnly = await f.request(PREFIX + 'f1.jpeg', { headers: { Authorization: 'Bearer ' + f.register() } });
  assert.equal(bearerOnly.status, 401);
});

test('valid verified login is pending with 200; matching email grants no access', async (t) => {
  const f = await fixture(t);
  const token = f.register();
  const response = await f.login(token);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { authenticated: true, authorized: false,
    user: { id: USER_ID, email: 'roberto@rober.to', providers: ['azure', 'google'] }, library: 'spotify' });
  const sessionCookie = cookie(response);
  assert.match(sessionCookie, /^origami_beta_session=[A-Za-z0-9_-]{43}$/);
  const rawCookie = response.headers['set-cookie'][0];
  assert.match(rawCookie, /HttpOnly/);
  assert.match(rawCookie, /SameSite=Strict/);
  assert.match(rawCookie, /Path=\//);
  assert.doesNotMatch(rawCookie, /Secure/);
  const maxAge = Number(rawCookie.match(/Max-Age=(\d+)/)[1]);
  assert.ok(maxAge > 0 && maxAge <= 3600);
  assert.ok(!JSON.stringify(response).includes(token));
  assert.ok(!rawCookie.includes(USER_ID));
  const pending = await f.request('/api/session', { headers: { Cookie: sessionCookie } });
  assert.equal(pending.status, 200);
  assert.equal(pending.data.authorized, false);
  for (const name of ['gallery.json', 'f1.jpeg']) {
    const blocked = await f.request(PREFIX + name, { headers: { Cookie: sessionCookie } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.location, undefined);
  }
  assert.equal(f.calls, 1);
});

test('manual UUID approval permits exactly eight manifest paths and original image bytes', async (t) => {
  const f = await fixture(t);
  const token = f.register();
  const sessionCookie = cookie(await f.login(token));
  f.allow();
  const status = await f.request('/api/session', { headers: { Cookie: sessionCookie } });
  assert.equal(status.data.authorized, true);
  const manifest = await f.request(PREFIX + 'gallery.json', { headers: { Cookie: sessionCookie } });
  assert.equal(manifest.status, 200);
  assert.deepEqual(manifest.data, { version: 1, images: PHOTO_NAMES.map((name) => PREFIX.slice(1) + name) });
  for (const image of manifest.data.images) {
    const photo = await f.request('/' + image, { headers: { Cookie: sessionCookie } });
    assert.equal(photo.status, 200);
    assert.deepEqual(photo.bytes, PHOTO);
    assert.equal(photo.headers['content-type'], 'image/jpeg');
    commonHeaders(photo);
    assert.ok(!JSON.stringify(photo).includes(token));
  }
  for (const url of [PREFIX + 'f11.jpeg', '/photos/onedrive/other/gallery.json']) {
    assert.equal((await f.request(url, { headers: { Cookie: sessionCookie } })).status, 404);
  }
});

test('allowlist deletion/revocation is immediate, including during cached upstream validation', async (t) => {
  const f = await fixture(t);
  f.allow();
  const sessionCookie = cookie(await f.login(f.register()));
  assert.equal((await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } })).status, 200);
  fs.unlinkSync(f.allowlistPath);
  assert.equal((await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } })).status, 403);
  assert.equal((await f.request('/api/session', { headers: { Cookie: sessionCookie } })).data.authorized, false);
  f.allow([OTHER_ID]);
  assert.equal((await f.request(PREFIX + 'gallery.json', { headers: { Cookie: sessionCookie } })).status, 403);
  f.allow();
  assert.equal((await f.request(PREFIX + 'gallery.json', { headers: { Cookie: sessionCookie } })).status, 200);
  fs.writeFileSync(f.allowlistPath, '{invalid');
  assert.equal((await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } })).status, 403);
  fs.writeFileSync(f.allowlistPath, JSON.stringify({ version: 1, userIds: ['roberto@rober.to'] }));
  assert.equal((await f.request('/api/session', { headers: { Cookie: sessionCookie } })).data.authorized, false);
  assert.equal(f.calls, 1);
});

test('forged JWT email/UUID claims never authenticate, even for allowlisted UUID', async (t) => {
  const f = await fixture(t);
  f.allow();
  for (const token of [jwt({ sub: USER_ID, email: 'roberto@rober.to', exp: Math.floor(Date.now() / 1000) + 3600 }), 'not-a-jwt']) {
    const response = await f.login(token);
    assert.equal(response.status, 401);
    assert.deepEqual(response.data, { authenticated: false });
    assert.equal(response.headers['set-cookie'], undefined);
    assert.ok(!response.text.includes(token));
  }
  assert.equal((await f.request('/api/session')).status, 401);
});

test('upstream success still requires matching subject and a future numeric expiry', async (t) => {
  const f = await fixture(t);
  for (const claims of [{ exp: Math.floor(Date.now() / 1000) - 1 }, { exp: '9999999999' }, { exp: null }, { sub: OTHER_ID }]) {
    assert.equal((await f.login(f.register(claims))).status, 401);
  }
  const wrongVerifiedId = f.register({}, { id: 'not-a-uuid' });
  assert.equal((await f.login(wrongVerifiedId)).status, 401);
});

test('cached validation lasts at most 15 seconds; unavailable upstream then denies', async (t) => {
  const f = await fixture(t);
  f.allow();
  const sessionCookie = cookie(await f.login(f.register()));
  f.upstreamError = true;
  assert.equal((await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } })).status, 200);
  assert.equal(f.calls, 1);
  advanceClock(t, 15001);
  const rejected = await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } });
  assert.equal(rejected.status, 401);
  assert.equal(f.calls, 2);
  assert.ok(!rejected.text.includes('upstream'));
  assert.equal((await f.request('/api/session', { headers: { Cookie: sessionCookie } })).status, 401);
});

test('expired cookie session is denied before cache interval ends', async (t) => {
  const f = await fixture(t);
  f.allow();
  const sessionCookie = cookie(await f.login(f.register({ exp: Math.floor(Date.now() / 1000) + 5 })));
  advanceClock(t, 6000);
  const response = await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } });
  assert.equal(response.status, 401);
  assert.equal(f.calls, 1);
  assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
});

test('revalidation uses verified user data; repeated requests coalesce and respect current allowlist', async (t) => {
  let count = 0;
  let token;
  const verifier = async (incoming) => {
    assert.equal(incoming, token);
    count++;
    if (count > 1) await new Promise((resolve) => setTimeout(resolve, 30));
    return { data: { user: { id: USER_ID, email: count > 1 ? 'changed@example.test' : 'roberto@rober.to', app_metadata: { provider: 'google' } } }, error: null };
  };
  const f = await fixture(t, { verifyToken: verifier });
  token = f.register();
  f.allow();
  const sessionCookie = cookie(await f.login(token));
  advanceClock(t, 15001);
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request('/api/session', { headers: { Cookie: sessionCookie } })));
  assert.equal(count, 2);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.data.user.email, 'changed@example.test');
    assert.equal(response.data.authorized, true);
  }
});

test('cross-origin/missing-origin login and logout are denied; Referer also checked', async (t) => {
  const f = await fixture(t);
  const token = f.register();
  for (const origin of ['https://attacker.test', 'null', 'http://127.0.0.1:' + f.port, 'http://localhost:' + (f.port + 1)]) {
    assert.equal((await f.login(token, { headers: { Origin: origin } })).status, 403);
  }
  assert.equal((await f.request('/api/session', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).status, 403);
  assert.equal((await f.login(token, { headers: { Referer: 'https://attacker.test/' } })).status, 403);
  const sessionCookie = cookie(await f.login(token));
  assert.equal((await f.request('/api/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await f.request('/api/logout', { method: 'POST', headers: { Cookie: sessionCookie } })).status, 403);
  assert.equal((await f.request('/api/session', { headers: { Cookie: sessionCookie, Referer: 'https://attacker.test/' } })).status, 403);
  assert.equal((await f.request('/api/health', { headers: { Origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await f.request('/api/session', { headers: { Cookie: sessionCookie } })).status, 200);
  const logout = await f.request('/api/logout', { method: 'POST', headers: { Cookie: sessionCookie, Origin: 'http://localhost:' + f.port } });
  assert.equal(logout.status, 200);
  assert.deepEqual(logout.data, { authenticated: false });
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await f.request('/api/session', { headers: { Cookie: sessionCookie } })).status, 401);
});

test('Host is exact loopback name and listening port, preventing rebinding', async (t) => {
  const f = await fixture(t);
  for (const host of ['attacker.test:' + f.port, 'localhost', 'localhost:8683', '127.0.0.1', 'localhost:' + f.port + '.attacker.test', '[::1]:' + f.port]) {
    assert.equal((await f.request('/api/health', { headers: { Host: host } })).status, 403);
  }
  assert.equal((await f.request('/api/health', { headers: { Host: '127.0.0.1:' + f.port } })).status, 200);
});

test('literal public whitelist works; no root photos, repo tree, secrets, backend, or general static', async (t) => {
  const f = await fixture(t);
  for (const url of ['/', '/auth/callback?code=pkce-test-code', ...ROOT_ASSETS.map((name) => '/' + name), '/auth-client.js', '/auth.css', '/vendor/supabase.js']) {
    const response = await f.request(url);
    assert.equal(response.status, 200, url);
    commonHeaders(response);
    assert.equal(response.headers['content-security-policy'], undefined);
  }
  for (const url of ['/f1.jpeg', '/f10.jpeg', '/index.html', '/beta/index.html', '/beta/config.local.json', '/beta/authorized-users.local.json', '/.env', '/.git/config', '/backend/', '/server.cjs', '/api/admin', '/static/version.js', '/vendor/other.js', '/package.json', '/tests/auth-beta-server.test.cjs']) {
    assert.equal((await f.request(url)).status, 404, url);
  }
});

test('decoded traversal, backslashes, ambiguous encoding, malformed paths and tokens in URL are rejected', async (t) => {
  const f = await fixture(t);
  for (const url of ['/../.git/config', '/%2e%2e/.env', '/photos/%2e%2e/f1.jpeg', '/%252e%252e/.env', '/%252f.git/config', '/foo%5c..%5c.env', '/%00', '/%ZZ', '//.git/config', '/photos//onedrive/spotify/f1.jpeg', '/api/session?access_token=PRIVATE', '/auth/callback?refresh_token=PRIVATE', '/api/health?%74oken=PRIVATE']) {
    const response = await f.request(url);
    assert.equal(response.status, 400, url);
    assert.ok(!response.text.includes('PRIVATE'));
  }
});

test('symlinked public files, vendor directories, and approved photos are never served', async (t) => {
  const f = await fixture(t);
  const secret = path.join(f.rootDir, 'private-test-secret');
  fs.writeFileSync(secret, 'private-test-secret');
  fs.unlinkSync(path.join(f.rootDir, 'version.js'));
  fs.symlinkSync(secret, path.join(f.rootDir, 'version.js'));
  assert.equal((await f.request('/version.js')).status, 404);
  fs.renameSync(path.join(f.betaDir, 'vendor'), path.join(f.betaDir, 'vendor-real'));
  fs.symlinkSync(path.join(f.betaDir, 'vendor-real'), path.join(f.betaDir, 'vendor'));
  assert.equal((await f.request('/vendor/supabase.js')).status, 404);
  fs.unlinkSync(path.join(f.rootDir, 'f1.jpeg'));
  fs.symlinkSync(secret, path.join(f.rootDir, 'f1.jpeg'));
  f.allow();
  const sessionCookie = cookie(await f.login(f.register()));
  const response = await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: sessionCookie } });
  assert.equal(response.status, 404);
  assert.ok(!response.text.includes('private-test-secret'));
});

test('unsupported methods, oversized tokens, body limit, and invalid JSON fail safely', async (t) => {
  const f = await fixture(t);
  const token = f.register();
  for (const [url, method] of [['/api/session', 'PUT'], ['/api/logout', 'GET'], ['/api/logout', 'DELETE'], ['/api/health', 'POST'], ['/', 'POST']]) {
    assert.equal((await f.request(url, { method, headers: { Origin: 'http://localhost:' + f.port } })).status, 405);
  }
  assert.equal((await f.login('a'.repeat(8190) + '.b.c')).status, 401);
  assert.equal((await f.login(token, { body: 'x'.repeat(16385), headers: { 'Content-Type': 'application/json' } })).status, 413);
  assert.equal((await f.login(token, { body: 'x'.repeat(16385), chunked: true, headers: { 'Content-Type': 'application/json' } })).status, 413);
  assert.equal((await f.login(token, { body: 'bad', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await f.login(token, { body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.login(token, { body: '{}', headers: { 'Content-Type': 'application/json' } })).status, 200);
});

test('session capacity is bounded at 64 and successful relogin rotates opaque cookie', async (t) => {
  const f = await fixture(t);
  const token = f.register();
  const cookies = [];
  for (let i = 0; i < 65; i++) cookies.push(cookie(await f.login(token)));
  assert.equal(new Set(cookies).size, 65);
  assert.equal((await f.request('/api/session', { headers: { Cookie: cookies[0] } })).status, 401);
  assert.equal((await f.request('/api/session', { headers: { Cookie: cookies[1] } })).status, 200);
  const oldCookie = cookies[64];
  const rotated = cookie(await f.login(token, { headers: { Cookie: oldCookie } }));
  assert.notEqual(rotated, oldCookie);
  assert.equal((await f.request('/api/session', { headers: { Cookie: oldCookie } })).status, 401);
  assert.equal((await f.request('/api/session', { headers: { Cookie: rotated } })).status, 200);
  assert.equal((await f.request('/api/session', { headers: { Cookie: rotated + '; ' + rotated } })).status, 401);
});

test('access CLI helpers preserve existing UUIDs, reject email, and write atomic private files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'origami-access-beta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'authorized-users.local.json');
  assert.deepEqual(readAllowlist(file), { version: 1, userIds: [] });
  updateAllowlist(file, 'add', USER_ID.toUpperCase());
  updateAllowlist(file, 'add', OTHER_ID);
  updateAllowlist(file, 'add', USER_ID);
  assert.deepEqual(readAllowlist(file).userIds, [USER_ID, OTHER_ID]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['authorized-users.local.json']);
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => updateAllowlist(file, 'add', 'roberto@rober.to'));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.writeFileSync(file + '.lock', 'operator lock');
  assert.throws(() => updateAllowlist(file, 'remove', USER_ID));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.unlinkSync(file + '.lock');
  updateAllowlist(file, 'remove', USER_ID);
  assert.deepEqual(readAllowlist(file).userIds, [OTHER_ID]);
  fs.writeFileSync(file, '{invalid-existing-data');
  assert.throws(() => updateAllowlist(file, 'add', USER_ID));
  assert.equal(fs.readFileSync(file, 'utf8'), '{invalid-existing-data');
  assert.deepEqual(fs.readdirSync(dir), ['authorized-users.local.json']);
});

test('CLI add/remove/list operates only on its private sibling file and never accepts emails', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'origami-cli-beta-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(dir, 'access.cjs');
  fs.copyFileSync(path.join(__dirname, '..', 'beta', 'access.cjs'), cli);
  function run(...args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); }
  assert.deepEqual(JSON.parse(run('list').stdout), { version: 1, userIds: [] });
  assert.equal(run('add', USER_ID).status, 0);
  assert.deepEqual(JSON.parse(run('list').stdout).userIds, [USER_ID]);
  assert.equal(run('add', 'roberto@rober.to').status, 1);
  assert.deepEqual(JSON.parse(run('list').stdout).userIds, [USER_ID]);
  assert.equal(run('remove', USER_ID).status, 0);
  assert.deepEqual(JSON.parse(run('list').stdout).userIds, []);
});

test('same email on another verified UUID does not inherit an approved identity', async (t) => {
  const f = await fixture(t);
  f.allow([USER_ID]);
  const otherToken = f.register({ sub: OTHER_ID }, { id: OTHER_ID, email: 'roberto@rober.to' });
  const response = await f.login(otherToken);
  assert.equal(response.status, 200);
  assert.equal(response.data.user.id, OTHER_ID);
  assert.equal(response.data.authorized, false);
  const otherCookie = cookie(response);
  assert.equal((await f.request(PREFIX + 'gallery.json', { headers: { Cookie: otherCookie } })).status, 403);
});

test('symlinked private allowlist denies authorization and cannot be replaced by CLI', async (t) => {
  const f = await fixture(t);
  const target = path.join(f.rootDir, 'other-allowlist.json');
  fs.writeFileSync(target, JSON.stringify({ version: 1, userIds: [USER_ID] }));
  fs.symlinkSync(target, f.allowlistPath);
  const response = await f.login(f.register());
  assert.equal(response.status, 200);
  assert.equal(response.data.authorized, false);
  assert.equal((await f.request(PREFIX + 'f1.jpeg', { headers: { Cookie: cookie(response) } })).status, 403);
  assert.throws(() => updateAllowlist(f.allowlistPath, 'add', OTHER_ID));
  assert.ok(fs.lstatSync(f.allowlistPath).isSymbolicLink());
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')).userIds, [USER_ID]);
});

test('upstream error is always denial, even when response also includes user data', async (t) => {
  const f = await fixture(t, { verifyToken: async () => ({ data: { user: { id: USER_ID, email: 'roberto@rober.to' } }, error: new Error('private upstream failure') }) });
  f.allow();
  const token = f.register();
  const response = await f.login(token);
  assert.equal(response.status, 401);
  assert.deepEqual(response.data, { authenticated: false });
  assert.equal(response.headers['set-cookie'], undefined);
  assert.ok(!response.text.includes(token));
  assert.ok(!response.text.includes('private upstream failure'));
});


test('public OAuth return accepts provider Referer without weakening API/photo origin checks', async (t) => {
  const f = await fixture(t);
  const headers = {Referer: 'https://example-project.supabase.co/auth/v1/callback'};
  assert.equal((await f.request('/auth/callback?code=pkce-return', {headers})).status, 200);
  assert.equal((await f.request('/', {headers})).status, 200);
  assert.equal((await f.request('/api/session', {headers})).status, 403);
  assert.equal((await f.request(PREFIX + 'f1.jpeg', {headers})).status, 403);
  assert.equal((await f.request('/auth/callback')).headers['x-frame-options'], 'DENY');
});

test('logout cancels an in-flight validated login before it can restore cookie or media access', async (t) => {
  let resolveVerification, notifyStarted;
  const started = new Promise(resolve => {notifyStarted = resolve;});
  const f = await fixture(t, {verifyToken: () => {
    notifyStarted(); return new Promise(resolve => {resolveVerification = resolve;});
  }});
  f.allow();
  const browserCookie = cookie(await f.request('/api/client-config'));
  const token = f.register();
  const origin = 'http://localhost:' + f.port;
  const pending = f.request('/api/session', {method: 'POST', headers: {Origin: origin, Cookie: browserCookie, Authorization: 'Bearer ' + token}});
  await started;
  const logout = await f.request('/api/logout', {method: 'POST', headers: {Origin: origin, Cookie: browserCookie}});
  assert.equal(logout.status, 200);
  resolveVerification({data: {user: {id: USER_ID, email: 'roberto@rober.to', app_metadata: {provider: 'google'}}}, error: null});
  const late = await pending;
  assert.equal(late.status, 409);
  assert.equal(late.headers['set-cookie'], undefined);
  assert.equal((await f.request(PREFIX + 'f1.jpeg', {headers: {Cookie: browserCookie}})).status, 401);
});
