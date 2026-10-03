/**
 * Optional "Publish to GitHub" support.
 *
 * GitHub Pages serves whatever is in the repository, so publishing means
 * committing the changed data files and any new images. This uses the GitHub
 * Git Data API with a fine-grained token that lives ONLY on the server
 * (environment variable), never in the browser or in the repository.
 *
 * Environment:
 *   GITHUB_TOKEN        fine-grained token, "Contents: Read and write" on one repo
 *   GITHUB_REPO         owner/name
 *   GITHUB_BRANCH       default: main
 *   GITHUB_PATH_PREFIX  folder of this project inside the repo (default: repo root)
 *   GITHUB_API_URL      default: https://api.github.com (overridable for tests)
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { HttpError } from './http.mjs';

export function publishConfig(env = process.env) {
  const repo = env.GITHUB_REPO || '';
  return {
    configured: Boolean(env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(repo)),
    token: env.GITHUB_TOKEN || '',
    repo,
    branch: env.GITHUB_BRANCH || 'main',
    prefix: (env.GITHUB_PATH_PREFIX || '').replace(/^\/+|\/+$/g, ''),
    api: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
  };
}

/** Git blob id of file contents, to skip files GitHub already has. */
export function gitBlobSha(buf) {
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

export async function publish(store, cfg, { message = 'Update CAPTCHA data from the admin dashboard' } = {}) {
  if (!cfg.configured) throw new HttpError(400, 'publish_not_configured', 'GitHub publishing is not configured on the server');
  const gh = async (method, path, body) => {
    const res = await fetch(`${cfg.api}/repos/${cfg.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'arabic-hybrid-captcha-admin',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, 'github_error', `GitHub API ${method} ${path} failed (${res.status}) ${text.slice(0, 200)}`);
    }
    return res.json();
  };

  const ref = await gh('GET', `/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  const headSha = ref.object.sha;
  const head = await gh('GET', `/git/commits/${headSha}`);
  const tree = await gh('GET', `/git/trees/${head.tree.sha}?recursive=1`);
  const remote = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));

  const changes = [];
  for (const rel of await store.publishableFiles()) {
    const buf = await readFile(store.path(rel));
    const repoPath = cfg.prefix ? posix.join(cfg.prefix, rel) : rel;
    if (remote.get(repoPath) === gitBlobSha(buf)) continue;
    const blob = await gh('POST', '/git/blobs', { content: buf.toString('base64'), encoding: 'base64' });
    changes.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (!changes.length) return { committed: false, files: [], message: 'GitHub is already up to date' };

  const newTree = await gh('POST', '/git/trees', { base_tree: head.tree.sha, tree: changes });
  const commit = await gh('POST', '/git/commits', { message, tree: newTree.sha, parents: [headSha] });
  await gh('PATCH', `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: commit.sha, force: false });
  return { committed: true, commit: commit.sha, files: changes.map((c) => c.path) };
}
