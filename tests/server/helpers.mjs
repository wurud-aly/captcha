/** Test helpers: throwaway project copies and a running admin server. */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminServer } from '../../server/admin-server.mjs';
import { hashPassword, SessionStore, LoginLimiter } from '../../server/lib/auth.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PASSWORD = 'correct horse battery staple';

/** Copy the public project files into a temp folder (real data is never touched). */
export function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'ahc-test-'));
  for (const entry of ['index.html', 'public', 'src']) cpSync(join(ROOT, entry), join(dir, entry), { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

let hashCache;
export async function startServer(opts = {}) {
  hashCache ||= await hashPassword(PASSWORD);
  const project = tempProject();
  const env = { ADMIN_PASSWORD_HASH: hashCache, ...(opts.env || {}) };
  const { server, sessions, limiter, store } = createAdminServer({
    root: project.dir,
    env,
    loginDelayMs: 0,
    dataDir: join(project.dir, '.admin-data'),
    sessions: opts.sessions || new SessionStore(),
    limiter: opts.limiter || new LoginLimiter(),
    ...opts.server,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    await new Promise((r) => server.close(r));
    project.cleanup();
  };
  return { base, server, sessions, limiter, store, dir: project.dir, close };
}

/** Sign in and return helpers bound to the session. */
export async function login(base, password = PASSWORD) {
  const res = await fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ password }),
  });
  const body = await res.json();
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  const call = async (method, path, data, extra = {}) => {
    const r = await fetch(`${base}/admin/api/${path}`, {
      method,
      headers: {
        cookie,
        Origin: base,
        ...(method !== 'GET' ? { 'X-CSRF-Token': body.csrf } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extra,
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  return { res, body, cookie, csrf: body.csrf, call };
}

/** A small valid letter PNG: a horizontal stroke with a dot, transparent background. */
export async function letterPng({ w = 120, h = 90, opaque = false } = {}) {
  const { encodePng } = await import('../../server/lib/png.mjs');
  const px = new Uint8ClampedArray(w * h * 4);
  if (opaque) px.fill(255);
  const stroke = Math.round(h * 0.6); // 4 px stroke with a 15 px margin left and right
  const dot = Math.round(h / 3); // 4×4 "dot" above it
  for (let y = stroke; y < stroke + 4; y++) for (let x = 15; x < w - 15; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
  for (let y = dot; y < dot + 4; y++) for (let x = (w >> 1) - 2; x < (w >> 1) + 2; x++) px.set([20, 20, 20, 255], (y * w + x) * 4);
  return encodePng(w, h, px);
}
