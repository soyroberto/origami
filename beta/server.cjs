'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isUuid, readAllowlist } = require('./access.cjs');

const DEFAULT_PORT = 8683;
const SESSION_COOKIE = 'origami_beta_session';
const BROWSER_COOKIE = 'origami_beta_browser';
const MAX_TOKEN_BYTES = 8192;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SESSIONS = 64;
const VALIDATION_CACHE_MS = 15 * 1000;
const VALIDATION_TIMEOUT_MS = 5000;
const PHOTO_NAMES = Object.freeze(['f1.jpeg', 'f2.jpeg', 'f3.jpeg', 'f5.jpeg', 'f6.jpeg', 'f7.jpeg', 'f8.jpeg', 'f10.jpeg']);
const PHOTO_PREFIX = '/photos/onedrive/spotify/';
const MANIFEST_PATH = PHOTO_PREFIX + 'gallery.json';
const ROOT_ASSETS = Object.freeze({
  '/version.js': 'version.js',
  '/jquery-1.8.3.js': 'jquery-1.8.3.js',
  '/album-queue.js': 'album-queue.js',
  '/shiftingtiles.js': 'shiftingtiles.js',
  '/gallery-layout.js': 'gallery-layout.js',
  '/gallery-player.js': 'gallery-player.js',
  '/gallery-source.js': 'gallery-source.js',
  '/shiftingtiles.less': 'shiftingtiles.less',
  '/less-2.5.1.min.js': 'less-2.5.1.min.js'
});
const BETA_ASSETS = Object.freeze({
  '/': 'index.html',
  '/auth/callback': 'index.html',
  '/auth-client.js': 'auth-client.js',
  '/auth.css': 'auth.css',
  '/vendor/supabase.js': 'vendor/supabase.js'
});

class RequestError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid JWT');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

function validConfig(input) {
  try {
    if (!input || typeof input.supabaseUrl !== 'string' || typeof input.publishableKey !== 'string') return null;
    const url = new URL(input.supabaseUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.supabase\.co$/.test(url.hostname) ||
        url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return null;
    const key = input.publishableKey;
    if (key.length > MAX_TOKEN_BYTES) return null;
    // Both current public keys and legacy anon keys are supported. Never accept
    // sb_secret_*, service_role JWTs, arbitrary API keys, or whitespace.
    if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) {
      const claims = decodeJwtPayload(key);
      if (claims.role !== 'anon') return null;
    }
    return { supabaseUrl: url.origin, publishableKey: key };
  } catch (_) { return null; }
}

function loadConfig(betaDir) {
  let fd;
  try {
    const file = path.join(betaDir, 'config.local.json');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return null;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (fs.fstatSync(fd).size > 64 * 1024) return null;
    return validConfig(JSON.parse(fs.readFileSync(fd, 'utf8')));
  } catch (_) { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function realVerifier(config) {
  // The parent installs @supabase/supabase-js 2.119.2. Only the exported factory
  // accepts a test verifier; the CLI has no environment/argument auth bypass.
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS) })
    }
  });
  return (token) => client.auth.getUser(token);
}

function securityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // No CSP is advertised: the original LESS 2.5.1 runtime needs eval/inline
  // styles. A restrictive but incompatible policy would break the beta UI.
}

function json(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function requestPath(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) {
    throw new RequestError(400, 'invalid_path');
  }
  const queryAt = raw.indexOf('?');
  const rawPath = queryAt < 0 ? raw : raw.slice(0, queryAt);
  let decoded;
  try { decoded = decodeURIComponent(rawPath); }
  catch (_) { throw new RequestError(400, 'invalid_path'); }
  if (/[\x00-\x20\x7f\\%]/.test(decoded) || decoded.includes('//') || decoded.split('/').some((part) => part === '.' || part === '..')) {
    throw new RequestError(400, 'invalid_path');
  }
  if (queryAt >= 0) {
    const params = new URLSearchParams(raw.slice(queryAt + 1));
    for (const name of params.keys()) {
      if (/^(?:access_token|refresh_token|id_token|token|jwt|authorization)$/i.test(name)) throw new RequestError(400, 'token_in_url');
    }
  }
  return decoded;
}

function headerCount(req, name) {
  let count = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
  return count;
}

function checkRequestOrigin(req, expectedOrigin, mutation) {
  if (headerCount(req, 'origin') > 1 || headerCount(req, 'referer') > 1) throw new RequestError(403, 'origin_denied');
  const origin = req.headers.origin;
  if ((mutation && origin !== expectedOrigin) || (origin !== undefined && origin !== expectedOrigin)) throw new RequestError(403, 'origin_denied');
  const referer = req.headers.referer;
  if (referer !== undefined) {
    try {
      const url = new URL(referer);
      if (url.origin !== expectedOrigin || url.username || url.password) throw new Error('Foreign referer');
    } catch (_) { throw new RequestError(403, 'origin_denied'); }
  }
}

function readBody(req) {
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    req.resume();
    return Promise.reject(new RequestError(413, 'body_too_large'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    function cleanup() {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAbort);
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        req.resume();
        reject(new RequestError(413, 'body_too_large'));
      } else chunks.push(chunk);
    }
    function onEnd() { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); }
    function onError() { cleanup(); reject(new RequestError(400, 'invalid_body')); }
    function onAbort() { cleanup(); reject(new RequestError(400, 'invalid_body')); }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAbort);
  });
}

function cookieId(req, name = SESSION_COOKIE) {
  const matches = (req.headers.cookie || '').split(';').map((item) => item.trim()).filter((item) => item.startsWith(name + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', SESSION_COOKIE + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function publicUser(user) {
  if (!user || !isUuid(user.id)) throw new Error('Invalid verified user');
  const providers = new Set();
  const candidates = [user.app_metadata?.provider, ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(Array.isArray(user.identities) ? user.identities.map((identity) => identity?.provider) : [])];
  for (const provider of candidates) if (provider === 'google' || provider === 'azure') providers.add(provider);
  return { id: user.id.toLowerCase(), email: typeof user.email === 'string' && user.email.length <= 320 ? user.email : null, providers: [...providers].sort() };
}

async function literalFile(baseDir, relative) {
  // Only callers' hard-coded filenames reach this function. Reject symlinks at
  // every component, then open the leaf with O_NOFOLLOW and read the open fd.
  const base = path.resolve(baseDir);
  let target = base;
  if (!fs.lstatSync(base).isDirectory() || fs.lstatSync(base).isSymbolicLink()) throw new Error('Unsafe base');
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Symlinks are not served');
  }
  const handle = await fs.promises.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Not a regular file');
    return await handle.readFile();
  } finally { await handle.close(); }
}

function contentType(relative) {
  if (relative.endsWith('.html')) return 'text/html; charset=utf-8';
  if (relative.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (relative.endsWith('.css')) return 'text/css; charset=utf-8';
  if (relative.endsWith('.less')) return 'text/plain; charset=utf-8';
  return 'image/jpeg';
}

/**
 * Returns an unlistened native http.Server. verifyToken is a unit-test-only
 * dependency with the same result shape as supabase.auth.getUser(token).
 * port:0 resolves Host/Origin using the temporary listening port in tests.
 * No token, cache, or HTTP administration API is exported.
 */
function createServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const betaDir = path.resolve(options.betaDir || path.join(rootDir, 'beta'));
  const allowlistPath = options.allowlistPath || path.join(betaDir, 'authorized-users.local.json');
  const port = options.port === undefined ? DEFAULT_PORT : options.port;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (options.origin !== undefined) {
    const url = new URL(options.origin);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.origin !== options.origin ||
        (port !== 0 && Number(url.port) !== port)) throw new Error('Invalid local origin');
  }
  let config = Object.prototype.hasOwnProperty.call(options, 'config') ? validConfig(options.config) : loadConfig(betaDir);
  let verifier = null;
  if (config) {
    try { verifier = options.verifyToken === undefined ? realVerifier(config) : options.verifyToken; }
    catch (_) { config = null; }
    if (typeof verifier !== 'function') config = null;
  }
  const sessions = new Map();
  const browsers = new Map();
  function initializeBrowser(req, res) {
    let id = cookieId(req, BROWSER_COOKIE);
    if (!id || !browsers.has(id)) {
      while (browsers.size >= MAX_SESSIONS) browsers.delete(browsers.keys().next().value);
      id = crypto.randomBytes(32).toString('base64url');
      browsers.set(id, { epoch: 0 });
    }
    res.setHeader('Set-Cookie', BROWSER_COOKIE + '=' + id + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600');
  }
  let server;
  function currentPort() { return port || server.address()?.port; }
  function currentOrigin() { return options.origin || 'http://localhost:' + currentPort(); }
  function authorized(userId) {
    try { return readAllowlist(allowlistPath).userIds.includes(userId); }
    catch (_) { return false; }
  }
  function purgeExpired() {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
  }
  async function verify(token) {
    let timer;
    try {
      const start = Date.now();
      const result = await Promise.race([
        Promise.resolve().then(() => verifier(token)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Auth unavailable')), VALIDATION_TIMEOUT_MS); timer.unref(); })
      ]);
      if (!result || result.error || !result.data?.user) throw new Error('Auth rejected');
      const user = publicUser(result.data.user);
      // JWT claims are used only AFTER the upstream getUser has succeeded.
      // They never authorize an identity or substitute for signature validation.
      const claims = decodeJwtPayload(token);
      if (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now() ||
          typeof claims.sub !== 'string' || claims.sub.toLowerCase() !== user.id) throw new Error('Invalid verified expiry/subject');
      return { user, expiresAt: claims.exp * 1000, verifiedAt: start };
    } catch (_) { return null; }
    finally { if (timer) clearTimeout(timer); }
  }
  async function sessionFor(req) {
    purgeExpired();
    const id = cookieId(req);
    const session = id && sessions.get(id);
    if (!session) return null;
    if (Date.now() - session.verifiedAt >= VALIDATION_CACHE_MS) {
      // Coalesce requests for the same private session, but never extend a
      // failed/expired validation cache while Supabase is unavailable.
      if (!session.pending) session.pending = verify(session.token);
      const fresh = await session.pending;
      session.pending = null;
      if (!fresh || !sessions.has(id) || fresh.user.id !== session.user.id) {
        sessions.delete(id);
        return null;
      }
      Object.assign(session, fresh);
    }
    if (session.expiresAt <= Date.now() || !sessions.has(id)) { sessions.delete(id); return null; }
    return session;
  }
  function sessionJson(session) {
    return { authenticated: true, authorized: authorized(session.user.id), user: session.user, library: 'spotify' };
  }

  server = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {
    securityHeaders(res);
    // IncomingMessage may emit error after aborted; a disconnected client must
    // never crash the process after the body reader has cleaned its listeners.
    req.on('error', () => {});
    try {
      const expectedHosts = ['localhost:' + currentPort(), '127.0.0.1:' + currentPort()];
      if (headerCount(req, 'host') !== 1 || !expectedHosts.includes(req.headers.host)) throw new RequestError(403, 'host_denied');
      const pathname = requestPath(req.url);
      const mutation = req.method === 'POST' && (pathname === '/api/session' || pathname === '/api/logout');
      // A provider's top-level OAuth redirect may carry a foreign Referer.
      // These two public HTML pages grant nothing; APIs/photos remain restricted.
      const publicNavigation = req.method === 'GET' && (pathname === '/' || pathname === '/auth/callback');
      if (!publicNavigation) checkRequestOrigin(req, currentOrigin(), mutation);
      if (!['GET', 'POST'].includes(req.method)) {
        res.setHeader('Allow', pathname === '/api/session' ? 'GET, POST' : pathname === '/api/logout' ? 'POST' : 'GET');
        throw new RequestError(405, 'method_not_allowed');
      }
      if ((pathname === '/api/logout' && req.method !== 'POST') || (req.method === 'POST' && !mutation)) {
        res.setHeader('Allow', pathname === '/api/logout' ? 'POST' : 'GET');
        throw new RequestError(405, 'method_not_allowed');
      }
      const body = await readBody(req);
      if (body) {
        if (!mutation || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new RequestError(415, 'json_body_required');
        try { JSON.parse(body); } catch (_) { throw new RequestError(400, 'invalid_json'); }
      }
      if (pathname === '/api/health') return json(res, 200, { ok: true, mode: 'local-auth-beta' });
      if (pathname === '/api/client-config') {
        initializeBrowser(req, res);
        return config ? json(res, 200, { configured: true, ...config, callbackPath: '/auth/callback' }) : json(res, 503, { configured: false });
      }
      if (pathname === '/api/logout') {
        const id = cookieId(req);
        const browserId = cookieId(req, BROWSER_COOKIE) || sessions.get(id)?.browserId;
        const browser = browsers.get(browserId);
        if (browser) browser.epoch++;
        if (browserId) {
          for (const [key, session] of sessions) if (session.browserId === browserId) sessions.delete(key);
        }
        if (id) sessions.delete(id);
        clearCookie(res);
        return json(res, 200, { authenticated: false });
      }
      if (pathname === '/api/session' && req.method === 'POST') {
        if (!config) return json(res, 503, { authenticated: false, error: 'not_configured' });
        const bearer = req.headers.authorization;
        if (headerCount(req, 'authorization') !== 1 || typeof bearer !== 'string' || !bearer.startsWith('Bearer ')) {
          return json(res, 401, { authenticated: false });
        }
        const token = bearer.slice(7);
        if (Buffer.byteLength(token) > MAX_TOKEN_BYTES || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
          return json(res, 401, { authenticated: false });
        }
        const browserId = cookieId(req, BROWSER_COOKIE);
        const browser = browsers.get(browserId);
        if (!browser) return json(res, 403, { authenticated: false, error: 'browser_session_required' });
        const epoch = browser.epoch;
        const validated = await verify(token);
        if (!validated) return json(res, 401, { authenticated: false });
        if (res.destroyed || browsers.get(browserId) !== browser || browser.epoch !== epoch) {
          return json(res, 409, { authenticated: false, error: 'session_cancelled' });
        }
        const maxAge = Math.floor((validated.expiresAt - Date.now()) / 1000);
        if (maxAge <= 0) return json(res, 401, { authenticated: false });
        purgeExpired();
        const oldId = cookieId(req);
        if (oldId) sessions.delete(oldId);
        while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
        const id = crypto.randomBytes(32).toString('base64url');
        const session = { ...validated, token, pending: null, browserId };
        sessions.set(id, session);
        res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + id + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge);
        return json(res, 200, sessionJson(session));
      }
      if (pathname === '/api/session') {
        const session = await sessionFor(req);
        if (!session) { clearCookie(res); return json(res, 401, { authenticated: false }); }
        return json(res, 200, sessionJson(session));
      }
      // Authorize the whole photo namespace before looking up a filename. No
      // unauthorized image/manifest bytes or existence information escape.
      if (pathname.startsWith('/photos/')) {
        const session = await sessionFor(req);
        if (!session) { clearCookie(res); return json(res, 401, { authenticated: false }); }
        if (!authorized(session.user.id)) return json(res, 403, { error: 'forbidden' });
        if (pathname === MANIFEST_PATH) return json(res, 200, { version: 1, images: PHOTO_NAMES.map((name) => PHOTO_PREFIX.slice(1) + name) });
        const name = PHOTO_NAMES.find((item) => pathname === PHOTO_PREFIX + item);
        if (!name) throw new RequestError(404, 'not_found');
        let bytes;
        try { bytes = await literalFile(rootDir, name); }
        catch (_) { throw new RequestError(404, 'not_found'); }
        // Logout, expiry, cache expiration and UUID revocation during disk I/O
        // also fail closed before image delivery.
        const currentSession = await sessionFor(req);
        if (!currentSession) { clearCookie(res); return json(res, 401, { authenticated: false }); }
        if (!authorized(currentSession.user.id)) return json(res, 403, { error: 'forbidden' });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length });
        return res.end(bytes);
      }
      const inRoot = Object.prototype.hasOwnProperty.call(ROOT_ASSETS, pathname);
      const inBeta = Object.prototype.hasOwnProperty.call(BETA_ASSETS, pathname);
      if (!inRoot && !inBeta) throw new RequestError(404, 'not_found');
      const relative = inRoot ? ROOT_ASSETS[pathname] : BETA_ASSETS[pathname];
      let bytes;
      try { bytes = await literalFile(inRoot ? rootDir : betaDir, relative); }
      catch (_) { throw new RequestError(404, 'not_found'); }
      res.writeHead(200, { 'Content-Type': contentType(relative), 'Content-Length': bytes.length });
      res.end(bytes);
    } catch (error) {
      req.resume();
      json(res, error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.code : 'request_failed' });
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 100;
  server.on('close', () => { sessions.clear(); browsers.clear(); });
  return server;
}

module.exports = { createServer };
if (require.main === module) {
  const server = createServer();
  server.on('error', () => {
    process.stderr.write('Could not start the local beta on 127.0.0.1:8683.\n');
    process.exitCode = 1;
  });
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    process.stdout.write('Origami local-auth-beta: http://localhost:8683 (loopback only).\n');
  });
}
