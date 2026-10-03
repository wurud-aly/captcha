import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish, publishConfig, gitBlobSha } from '../../server/lib/publisher.mjs';
import { ProjectStore } from '../../server/lib/store.mjs';
import { buildPages } from '../../scripts/build-pages.mjs';
import { tempProject, startServer, login } from './helpers.mjs';

/** Minimal mock of the GitHub Git Data API. */
async function mockGitHub(remoteFiles) {
  const calls = [];
  const blobs = new Map();
  let ref = 'c0';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, json });
    const send = (o) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
    if (req.url.endsWith('/git/ref/heads/main')) return send({ object: { sha: ref } });
    if (req.url.includes('/git/commits/')) return send({ tree: { sha: 't0' } });
    if (req.url.includes('/git/trees/t0')) return send({ tree: Object.entries(remoteFiles).map(([path, sha]) => ({ path, sha, type: 'blob' })) });
    if (req.url.endsWith('/git/blobs')) {
      const sha = `b${blobs.size}`;
      blobs.set(sha, json.content);
      return send({ sha });
    }
    if (req.url.endsWith('/git/trees')) return send({ sha: 't1' });
    if (req.url.endsWith('/git/commits')) return send({ sha: 'c1abcdef' });
    if (req.method === 'PATCH' && req.url.endsWith('/git/refs/heads/main')) {
      ref = json.sha;
      return send({ ok: true });
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

test('publishing commits only files that differ from GitHub, with the server-side token', async () => {
  const p = tempProject();
  const store = new ProjectStore(p.dir, { dataDir: join(p.dir, '.data') });
  // pretend GitHub already has everything except words.json
  const remote = {};
  for (const rel of await store.publishableFiles()) remote[rel] = gitBlobSha(readFileSync(join(p.dir, rel)));
  remote['src/data/words.json'] = 'outdated';
  const gh = await mockGitHub(remote);
  try {
    const cfg = publishConfig({ GITHUB_TOKEN: 'secret-token', GITHUB_REPO: 'owner/repo', GITHUB_API_URL: gh.url });
    const r = await publish(store, cfg);
    assert.equal(r.committed, true);
    assert.deepEqual(r.files, ['src/data/words.json']);
    assert.ok(gh.calls.every((c) => c.auth === 'Bearer secret-token'));
    const patch = gh.calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.json.sha, 'c1abcdef');
    assert.equal(patch.json.force, false, 'never force-push');
    // nothing left to publish
    remote['src/data/words.json'] = gitBlobSha(readFileSync(join(p.dir, 'src/data/words.json')));
    const again = await publish(store, cfg);
    assert.equal(again.committed, false);
  } finally {
    await gh.close();
    p.cleanup();
  }
});

test('publishing is refused when not configured; the token is never sent to the browser', async () => {
  assert.equal(publishConfig({}).configured, false);
  assert.equal(publishConfig({ GITHUB_TOKEN: 'x', GITHUB_REPO: 'not a repo' }).configured, false);
  const srv = await startServer({ env: { GITHUB_TOKEN: 'super-secret-token', GITHUB_REPO: 'owner/repo' } });
  try {
    const s = await login(srv.base);
    const data = await s.call('GET', 'data');
    assert.deepEqual(data.body.publish, { configured: true, repo: 'owner/repo', branch: 'main' });
    assert.ok(!JSON.stringify(data.body).includes('super-secret-token'));
  } finally {
    await srv.close();
  }
});

test('GitHub Pages bundle contains only the public site (no admin, server or secrets)', () => {
  const out = mkdtempSync(join(tmpdir(), 'ahc-pages-'));
  try {
    const { files } = buildPages(out);
    assert.ok(files.includes('index.html'));
    assert.ok(files.includes('.nojekyll'));
    assert.ok(files.includes('src/scripts/captcha-engine.js'));
    assert.ok(files.includes('public/assets/fonts/Cairo-Light.ttf'));
    assert.equal(files.filter((f) => /^public\/assets\/handwritten\/letter-\d\d\.png$/.test(f)).length, 12);
    for (const f of files) {
      assert.ok(!/^(server|tests|tools|docs|node_modules|scripts|\.github)\//.test(f), `unexpected ${f}`);
      assert.ok(!/admin|credentials|\.data|backup/i.test(f), `unexpected ${f}`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
