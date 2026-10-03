#!/usr/bin/env node
/**
 * Arabic Hybrid CAPTCHA: admin server.
 *
 * Serves the public CAPTCHA site AND a private, password-protected admin
 * dashboard at /admin. GitHub Pages cannot run this (it is static hosting
 * only), so the dashboard runs here: on your own computer (default, bound to
 * 127.0.0.1) or on a server behind HTTPS. See README > Admin dashboard.
 *
 *   npm run admin:setup     # once: choose the admin password
 *   npm run admin           # http://127.0.0.1:8787/admin
 *
 * Environment (all optional):
 *   ADMIN_PORT (8787)  ADMIN_HOST (127.0.0.1)
 *   ADMIN_PASSWORD_HASH      scrypt hash from admin:setup (instead of the credentials file)
 *   ADMIN_CREDENTIALS_FILE   default server/.data/credentials.json
 *   ADMIN_DATA_DIR           backups location, default server/.data
 *   ADMIN_COOKIE_SECURE=1    required when served over HTTPS (sets Secure + __Host- cookie)
 *   ADMIN_TRUST_PROXY=1      trust X-Forwarded-For/Host from a reverse proxy
 *   GITHUB_*                 optional publishing, see lib/publisher.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HttpError,
  readJson,
  parseCookies,
  serializeCookie,
  setSecurityHeaders,
  sendJson,
  sendError,
  redirect,
  clientIp,
  isSameOrigin,
} from './lib/http.mjs';
import {
  SessionStore,
  LoginLimiter,
  verifyPassword,
  loadPasswordHash,
  csrfMatches,
  hashPassword,
  checkPasswordStrength,
  saveCredentials,
} from './lib/auth.mjs';
import { ProjectStore } from './lib/store.mjs';
import { publishConfig, publish } from './lib/publisher.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const UI = join(HERE, 'admin-ui');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
};

/** Public site: only these paths are ever served. Everything else is 404. */
const PUBLIC_PREFIXES = ['public/', 'src/'];
const PUBLIC_FILES = new Set(['index.html']);

export function createAdminServer(options = {}) {
  const env = options.env || process.env;
  const root = resolve(options.root || join(HERE, '..'));
  const config = {
    root,
    secureCookie: options.secureCookie ?? env.ADMIN_COOKIE_SECURE === '1',
    trustProxy: options.trustProxy ?? env.ADMIN_TRUST_PROXY === '1',
    credentialsFile: options.credentialsFile || env.ADMIN_CREDENTIALS_FILE || join(root, 'server', '.data', 'credentials.json'),
    dataDir: options.dataDir || env.ADMIN_DATA_DIR || join(root, 'server', '.data'),
    loginDelayMs: options.loginDelayMs ?? 400,
  };
  const cookieName = config.secureCookie ? '__Host-ahc_admin' : 'ahc_admin';
  const sessions = options.sessions || new SessionStore();
  const limiter = options.limiter || new LoginLimiter();
  const store = new ProjectStore(root, { dataDir: config.dataDir });
  const publishCfg = () => publishConfig(env);
  const passwordHash = () => loadPasswordHash({ file: config.credentialsFile, env });

  const sessionOf = (req) => {
    const id = parseCookies(req)[cookieName];
    const s = sessions.get(id);
    return s ? { id, session: s } : null;
  };
  const sessionCookie = (id) => serializeCookie(cookieName, id, { secure: config.secureCookie });
  const clearCookie = () => serializeCookie(cookieName, '', { secure: config.secureCookie, maxAge: 0 });

  async function serveFile(res, abs, { admin = false } = {}) {
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isFile()) throw new HttpError(404, 'not_found', 'Not found');
    const body = await readFile(abs);
    setSecurityHeaders(res, { admin });
    res.writeHead(200, { 'Content-Type': TYPES[extname(abs)] || 'application/octet-stream', 'Cache-Control': admin ? 'no-store' : 'no-cache' });
    res.end(body);
  }

  function safeJoin(base, rel) {
    const abs = resolve(base, rel);
    if (!abs.startsWith(base + sep)) throw new HttpError(404, 'not_found', 'Not found');
    if (rel.split('/').some((seg) => seg.startsWith('.'))) throw new HttpError(404, 'not_found', 'Not found');
    return abs;
  }

  /** Requires a valid session; for state-changing methods also same-origin + CSRF token. */
  function requireAdmin(req) {
    const s = sessionOf(req);
    if (!s) throw new HttpError(401, 'unauthenticated', 'Sign in first');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!isSameOrigin(req, config.trustProxy)) throw new HttpError(403, 'bad_origin', 'Cross-site request blocked');
      if (!csrfMatches(s.session, req.headers['x-csrf-token'])) throw new HttpError(403, 'bad_csrf', 'Missing or invalid CSRF token');
    }
    return s;
  }

  async function handleApi(req, res, path) {
    setSecurityHeaders(res, { admin: true });
    const route = `${req.method} ${path}`;

    if (route === 'GET /admin/api/session') {
      const s = sessionOf(req);
      return sendJson(res, 200, { authenticated: Boolean(s), csrf: s?.session.csrf || null, configured: Boolean(await passwordHash()) });
    }

    if (route === 'POST /admin/api/login') {
      if (!isSameOrigin(req, config.trustProxy)) throw new HttpError(403, 'bad_origin', 'Cross-site request blocked');
      const ip = clientIp(req, config.trustProxy);
      const gate = limiter.check(ip);
      if (!gate.allowed) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again later.', { retryAfter: gate.retryAfter });
      const body = await readJson(req, 4096);
      const hash = await passwordHash();
      if (!hash) throw new HttpError(503, 'not_configured', 'No admin password is set. Run: npm run admin:setup');
      const ok = typeof body.password === 'string' && body.password.length <= 256 && (await verifyPassword(body.password, hash));
      if (!ok) {
        const e = limiter.fail(ip);
        await new Promise((r) => setTimeout(r, config.loginDelayMs));
        if (e.lockedUntil) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts. Try again later.', { retryAfter: Math.ceil(limiter.lockMs / 1000) });
        throw new HttpError(401, 'invalid_credentials', 'Incorrect password', { remaining: limiter.maxFailures - e.count });
      }
      limiter.success(ip);
      const old = sessionOf(req);
      if (old) sessions.destroy(old.id); // no session fixation
      const { id, csrf } = sessions.create();
      res.setHeader('Set-Cookie', sessionCookie(id));
      return sendJson(res, 200, { ok: true, csrf });
    }

    if (route === 'POST /admin/api/logout') {
      const s = requireAdmin(req);
      sessions.destroy(s.id);
      res.setHeader('Set-Cookie', clearCookie());
      return sendJson(res, 200, { ok: true });
    }

    // ---- everything below requires a signed-in admin ----
    requireAdmin(req);

    if (route === 'GET /admin/api/data') {
      const data = await store.read();
      const p = publishCfg();
      return sendJson(res, 200, { ...data, publish: { configured: p.configured, repo: p.configured ? p.repo : null, branch: p.branch } });
    }
    if (route === 'POST /admin/api/save') {
      const body = await readJson(req, 40 * 1024 * 1024);
      return sendJson(res, 200, await store.save(body));
    }
    if (route === 'GET /admin/api/backups') return sendJson(res, 200, { backups: await store.listBackups() });
    if (route === 'POST /admin/api/backups/restore') {
      const body = await readJson(req, 4096);
      return sendJson(res, 200, await store.restore(body.id));
    }
    if (route === 'POST /admin/api/publish') return sendJson(res, 200, await publish(store, publishCfg()));
    if (route === 'POST /admin/api/password') {
      if (env.ADMIN_PASSWORD_HASH) throw new HttpError(400, 'managed_by_env', 'The password is set by ADMIN_PASSWORD_HASH on the server; change it there.');
      const body = await readJson(req, 4096);
      if (!(await verifyPassword(String(body.current || ''), await passwordHash()))) throw new HttpError(401, 'invalid_credentials', 'Current password is incorrect');
      const problems = checkPasswordStrength(body.next);
      if (problems.length) throw new HttpError(422, 'weak_password', problems.join('. '));
      await saveCredentials(config.credentialsFile, await hashPassword(body.next));
      sessions.destroyAll();
      res.setHeader('Set-Cookie', clearCookie());
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, 'not_found', 'Unknown API route');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'bad_path', 'Bad path');
    }
    if (path.includes('\0')) throw new HttpError(400, 'bad_path', 'Bad path');
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

    if (path.startsWith('/admin/api/')) return handleApi(req, res, path);

    if (path === '/admin' || path === '/admin/') {
      if (!sessionOf(req)) return redirect(res, '/admin/login');
      return serveFile(res, join(UI, 'index.html'), { admin: true });
    }
    if (path === '/admin/login') {
      if (sessionOf(req)) return redirect(res, '/admin');
      return serveFile(res, join(UI, 'login.html'), { admin: true });
    }
    if (path.startsWith('/admin/static/')) return serveFile(res, safeJoin(join(UI, 'static'), path.slice('/admin/static/'.length)), { admin: true });
    if (path.startsWith('/admin/app/')) {
      if (!sessionOf(req)) throw new HttpError(401, 'unauthenticated', 'Sign in first');
      return serveFile(res, safeJoin(join(UI, 'app'), path.slice('/admin/app/'.length)), { admin: true });
    }
    if (path.startsWith('/admin')) throw new HttpError(404, 'not_found', 'Not found');

    // public CAPTCHA site (read-only)
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
    const rel = path === '/' ? 'index.html' : path.slice(1);
    if (!PUBLIC_FILES.has(rel) && !PUBLIC_PREFIXES.some((p) => rel.startsWith(p))) throw new HttpError(404, 'not_found', 'Not found');
    return serveFile(res, safeJoin(root, rel));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.end();
      setSecurityHeaders(res, { admin: req.url.startsWith('/admin') });
      if (err instanceof HttpError && err.status === 404 && !req.url.startsWith('/admin/api/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      sendError(res, err);
    });
  });
  return { server, sessions, limiter, store, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.ADMIN_PORT || 8787);
  const host = process.env.ADMIN_HOST || '127.0.0.1';
  const { server, config } = createAdminServer();
  const hash = await loadPasswordHash({ file: config.credentialsFile, env: process.env });
  server.listen(port, host, () => {
    console.log(`\nArabic Hybrid CAPTCHA admin server`);
    console.log(`  Public site : http://${host}:${port}/`);
    console.log(`  Dashboard   : http://${host}:${port}/admin`);
    if (!hash) console.log('\n  No admin password set yet. Stop the server and run: npm run admin:setup\n');
    if (host !== '127.0.0.1' && host !== 'localhost' && !config.secureCookie)
      console.warn('\n  WARNING: listening on a public interface without ADMIN_COOKIE_SECURE=1. Serve it only behind HTTPS.\n');
  });
}
