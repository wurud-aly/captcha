import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LoginLimiter } from '../../server/lib/auth.mjs';
import { startServer, login, PASSWORD, letterPng } from './helpers.mjs';

let srv;
before(async () => {
  srv = await startServer({ limiter: new LoginLimiter({ maxFailures: 5 }) });
});
after(() => srv.close());

const get = (path, headers = {}) => fetch(`${srv.base}${path}`, { redirect: 'manual', headers });

test('public site is served; admin is not linked from it', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Arabic Hybrid CAPTCHA'));
  assert.ok(!/admin/i.test(html), 'public page must not mention or link the admin');
});

test('server files, credentials, dotfiles and traversal attempts are never served', async () => {
  for (const p of [
    '/server/admin-server.mjs',
    '/server/lib/auth.mjs',
    '/server/.data/credentials.json',
    '/.admin-data/backups',
    '/package.json',
    '/src/../server/lib/auth.mjs',
    '/src/%2e%2e/server/lib/auth.mjs',
    '/public/../.git/config',
    '/admin/static/../app/main.js',
    '/admin/app/../../lib/auth.mjs',
  ]) {
    const res = await get(p);
    // 404, or 401 when the normalised path is a session-protected admin file
    assert.ok([401, 404].includes(res.status), `${p} -> ${res.status}`);
    const body = await res.text();
    assert.ok(!/import |export |passwordHash|scrypt/.test(body), `${p} leaked content`);
  }
});

test('dashboard and its code require a session', async () => {
  const dash = await get('/admin');
  assert.equal(dash.status, 302);
  assert.equal(dash.headers.get('location'), '/admin/login');
  assert.equal((await get('/admin/app/main.js')).status, 401);
  for (const p of ['data', 'backups']) assert.equal((await get(`/admin/api/${p}`)).status, 401);
  const post = await fetch(`${srv.base}/admin/api/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: srv.base }, body: '{}' });
  assert.equal(post.status, 401);
});

test('login page is served with strict security headers', async () => {
  const res = await get('/admin/login');
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
});

test('wrong password is rejected; cookie is HttpOnly + SameSite=Strict on success', async () => {
  const bad = await login(srv.base, 'wrong password!!');
  assert.equal(bad.res.status, 401);
  assert.equal(bad.res.headers.get('set-cookie'), null);
  srv.limiter.success('127.0.0.1');
  const ok = await login(srv.base);
  assert.equal(ok.res.status, 200);
  const cookie = ok.res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.ok(ok.csrf && ok.csrf.length >= 40);
  const dash = await get('/admin', { cookie: ok.cookie });
  assert.equal(dash.status, 200);
});

test('state-changing requests need the CSRF token and same origin', async () => {
  const s = await login(srv.base);
  const noToken = await s.call('POST', 'logout', undefined, { 'X-CSRF-Token': '' });
  assert.equal(noToken.status, 403);
  const crossSite = await s.call('POST', 'logout', undefined, { Origin: 'https://evil.example' });
  assert.equal(crossSite.status, 403);
  const crossLogin = await fetch(`${srv.base}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  assert.equal(crossLogin.status, 403);
});

test('full flow: read, upload a letter, add a word, save, public site serves the result', async () => {
  const s = await login(srv.base);
  const { body: data } = await s.call('GET', 'data');
  assert.equal(data.letters.samples.length, 12);
  data.letters.samples.push({
    id: 'hw-13', file: 'pending:upload0001', status: 'identified', character: 'ب', form: 'initial', confidence: 'high',
    writerId: 'writer-01', baseline: 57, anchors: { entry: null, exit: { x: 15, y: 57 } }, adjust: { scale: 1, offsetX: 0, offsetY: 0, thickness: 0 },
  });
  data.words.words.push({ id: 'bab', word: 'باب', meaning: 'door', characters: [{ style: 'handwritten', sample: 'hw-13' }, { style: 'handwritten', sample: 'hw-03' }, { style: 'typed' }] });
  const images = [{ ref: 'pending:upload0001', data: (await letterPng()).toString('base64'), name: 'b.png' }];
  const save = await s.call('POST', 'save', { baseVersion: data.version, letters: data.letters, words: data.words, composition: data.composition, images });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(save.body.written.length, 1);
  assert.ok(existsSync(join(srv.dir, save.body.written[0])));
  const pub = await (await get('/src/data/words.json')).json();
  assert.deepEqual(pub.words.map((w) => w.word), ['شبكات', 'حاسب', 'فهد', 'باب']);
  assert.equal((await get(`/${save.body.written[0]}`)).status, 200);
  // the same base version cannot be saved twice (optimistic locking)
  const stale = await s.call('POST', 'save', { baseVersion: data.version, letters: data.letters, words: data.words, composition: data.composition });
  assert.equal(stale.status, 409);
  const backups = await s.call('GET', 'backups');
  assert.ok(backups.body.backups.length >= 1);
});

test('request size limits are enforced', async () => {
  const s = await login(srv.base);
  const big = await fetch(`${srv.base}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: srv.base },
    body: JSON.stringify({ password: 'x'.repeat(10000) }),
  });
  assert.equal(big.status, 413);
  const wrongType = await s.call('POST', 'save', undefined, { 'Content-Type': 'text/plain' });
  assert.equal(wrongType.status, 415);
});

test('logout ends the session server-side', async () => {
  const s = await login(srv.base);
  assert.equal((await s.call('POST', 'logout')).status, 200);
  assert.equal((await s.call('GET', 'data')).status, 401);
});

test('brute force: the 5th wrong password locks the client out (429), even for the right password', async () => {
  const fresh = await startServer({ limiter: new LoginLimiter({ maxFailures: 5, lockMs: 60_000 }) });
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await login(fresh.base, `wrong-password-${i}`)).res.status);
    assert.deepEqual(codes, [401, 401, 401, 401, 429, 429]);
    const right = await login(fresh.base);
    assert.equal(right.res.status, 429);
    assert.ok(Number(right.res.headers.get('retry-after')) > 0);
  } finally {
    await fresh.close();
  }
});

test('without a configured password nobody can sign in', async () => {
  const none = await startServer({ env: { ADMIN_PASSWORD_HASH: '' }, server: { credentialsFile: '/nonexistent/credentials.json' } });
  try {
    const r = await login(none.base);
    assert.equal(r.res.status, 503);
    const s = await (await fetch(`${none.base}/admin/api/session`)).json();
    assert.equal(s.configured, false);
  } finally {
    await none.close();
  }
});

test('Secure + __Host- cookie when configured for HTTPS', async () => {
  const sec = await startServer({ server: { secureCookie: true } });
  try {
    const r = await login(sec.base);
    const cookie = r.res.headers.get('set-cookie');
    assert.match(cookie, /^__Host-ahc_admin=/);
    assert.match(cookie, /Secure/);
  } finally {
    await sec.close();
  }
});

test('password change requires the current password and signs everyone out', async () => {
  const p = await startServer({ env: { ADMIN_PASSWORD_HASH: '' }, server: {} });
  try {
    const { saveCredentials, hashPassword } = await import('../../server/lib/auth.mjs');
    await saveCredentials(join(p.dir, 'server', '.data', 'credentials.json'), await hashPassword(PASSWORD));
    const s = await login(p.base);
    assert.equal(s.res.status, 200);
    assert.equal((await s.call('POST', 'password', { current: 'wrong wrong wrong', next: 'another strong passphrase' })).status, 401);
    assert.equal((await s.call('POST', 'password', { current: PASSWORD, next: 'short' })).status, 422);
    assert.equal((await s.call('POST', 'password', { current: PASSWORD, next: 'another strong passphrase' })).status, 200);
    assert.equal((await s.call('GET', 'data')).status, 401, 'old session invalidated');
    assert.equal((await login(p.base)).res.status, 401, 'old password no longer works');
    assert.equal((await login(p.base, 'another strong passphrase')).res.status, 200);
  } finally {
    await p.close();
  }
});

test('encoded traversal is blocked even for a signed-in admin (raw, un-normalised paths)', async () => {
  const { request } = await import('node:http');
  const s = await login(srv.base);
  const raw = (path) =>
    new Promise((resolve, reject) => {
      const u = new URL(srv.base);
      const req = request({ host: u.hostname, port: u.port, path, headers: { cookie: s.cookie } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });
  for (const p of ['/admin/app/..%2f..%2fadmin-server.mjs', '/admin/app/..%2f..%2flib%2fauth.mjs', '/admin/static/..%2f..%2f.data%2fcredentials.json', '/src/..%2fserver%2flib%2fauth.mjs', '/public/..%2f..%2fetc%2fpasswd']) {
    const r = await raw(p);
    assert.equal(r.status, 404, `${p} -> ${r.status}`);
    assert.ok(!/import |passwordHash/.test(r.body));
  }
  assert.equal((await raw('/admin/app/main.js')).status, 200, 'legitimate file still served');
});
