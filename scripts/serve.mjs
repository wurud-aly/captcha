#!/usr/bin/env node
/**
 * Zero-dependency static server for local development and tests.
 *
 *   node scripts/serve.mjs                     -> http://localhost:8080/
 *   node scripts/serve.mjs --port 5173
 *   node scripts/serve.mjs --base /arabic-hybrid-captcha/
 *        -> serves the project under a sub-path, exactly like GitHub Pages
 *           (https://<user>.github.io/arabic-hybrid-captcha/)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(arg('--port', process.env.PORT || 8080));
let BASE = arg('--base', '/');
if (!BASE.startsWith('/')) BASE = `/${BASE}`;
if (!BASE.endsWith('/')) BASE += '/';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

export function startServer({ port = PORT, base = BASE, quiet = false } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (base !== '/' && path === base.slice(0, -1)) {
        res.writeHead(301, { Location: base });
        return res.end();
      }
      if (!path.startsWith(base)) {
        res.writeHead(404);
        return res.end('Not found (outside base path)');
      }
      path = path.slice(base.length);
      let file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT + sep) && file !== ROOT) {
        res.writeHead(403);
        return res.end();
      }
      const info = await stat(file).catch(() => null);
      if (info?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      if (!quiet) console.log(`200 ${req.url}`);
    } catch {
      res.writeHead(404);
      res.end('Not found');
      if (!quiet) console.log(`404 ${req.url}`);
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`Arabic Hybrid CAPTCHA running at http://localhost:${PORT}${BASE}`));
}
