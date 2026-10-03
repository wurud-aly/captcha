import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPages } from '../../scripts/build-pages.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'output', '_site'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('required files exist', () => {
  for (const f of ['index.html', 'src/styles/main.css', 'src/scripts/app.js', 'src/scripts/challenge.js', 'src/scripts/drag-sort.js', 'src/data/words.json', 'public/assets/fonts/Cairo-Light.ttf', 'public/favicon.svg', '.nojekyll'])
    assert.ok(existsSync(join(ROOT, f)), f);
});

test('the old interface, admin dashboard and developer tools are gone', () => {
  for (const f of ['server', 'tools', 'src/scripts/ui', 'src/scripts/captcha-engine.js', 'src/scripts/settings.js', 'src/data/letters.json', 'public/assets/handwritten'])
    assert.ok(!existsSync(join(ROOT, f)), `${f} should not exist`);
  const html = read('index.html');
  for (const word of ['admin', 'settings', 'gallery', 'experiment', '<nav', '<aside', '<a ', 'debug'])
    assert.ok(!html.toLowerCase().includes(word), `index.html contains "${word}"`);
});

test('the page is Arabic and right-to-left', () => {
  assert.match(read('index.html'), /<html lang="ar" dir="rtl">/);
});

test('index.html and CSS reference only relative paths that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  for (const r of refs) {
    assert.ok(!r.startsWith('/') && !/^https?:/.test(r), `non-relative ${r}`);
    assert.ok(existsSync(join(ROOT, r)), `missing ${r}`);
  }
  for (const m of read('src/styles/main.css').matchAll(/url\('([^']+)'\)/g)) assert.ok(existsSync(resolve(join(ROOT, 'src/styles'), m[1])), m[1]);
  for (const p of walk(join(ROOT, 'src/scripts')))
    for (const m of readFileSync(p, 'utf8').matchAll(/from '(\.[^']+)'/g)) assert.ok(existsSync(resolve(dirname(p), m[1])), `${p} -> ${m[1]}`);
});

test('no external services, CDNs or absolute machine paths', () => {
  for (const p of walk(ROOT).filter((f) => ['.html', '.js', '.mjs', '.css', '.json'].includes(extname(f)))) {
    if (p.includes(join('tests', 'unit'))) continue;
    const text = readFileSync(p, 'utf8');
    assert.ok(!/(\/home\/|\/root\/|\/Users\/|file:\/\/)/.test(text), `absolute path in ${p}`);
    if (!p.includes('.github')) assert.ok(!/(googleapis|gstatic|jsdelivr|unpkg|cdnjs)/.test(text), `external dependency in ${p}`);
  }
});

test('the complete word list is never written into the page', () => {
  const html = read('index.html');
  for (const w of JSON.parse(read('src/data/words.json')).words) assert.ok(!html.includes(w), w);
});

test('GitHub Pages bundle contains only the CAPTCHA page and its assets', () => {
  const out = mkdtempSync(join(tmpdir(), 'captcha-pages-'));
  try {
    const { files } = buildPages(out);
    assert.deepEqual(files.sort(), [
      '.nojekyll',
      'index.html',
      'public/assets/fonts/Cairo-Light.ttf',
      'public/assets/fonts/OFL.txt',
      'public/favicon.svg',
      'src/data/words.json',
      'src/scripts/app.js',
      'src/scripts/challenge.js',
      'src/scripts/drag-sort.js',
      'src/styles/main.css',
    ]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
