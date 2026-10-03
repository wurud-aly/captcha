import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSettings, clampSetting, createStore, SETTING_SPECS } from '../../src/scripts/settings.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const REQUIRED = [
  'index.html',
  'README.md',
  'LICENSE',
  '.gitignore',
  'package.json',
  'public/favicon.svg',
  'public/assets/fonts/Cairo-Light.ttf',
  'src/styles/main.css',
  'src/scripts/app.js',
  'src/scripts/captcha-engine.js',
  'src/scripts/arabic-composer.js',
  'src/scripts/image-processor.js',
  'src/scripts/letter-database.js',
  'src/scripts/word-database.js',
  'src/scripts/settings.js',
  'src/data/letters.json',
  'src/data/words.json',
  'src/data/composition.json',
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'output'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const sourceFiles = walk(ROOT).filter((p) => ['.html', '.js', '.mjs', '.css', '.json'].includes(extname(p)));

test('all required files exist', () => {
  for (const f of REQUIRED) assert.ok(existsSync(join(ROOT, f)), f);
});

test('12 handwritten PNG files are present', () => {
  const files = readdirSync(join(ROOT, 'public/assets/handwritten')).filter((f) => f.endsWith('.png'));
  assert.equal(files.length, 12);
});

test('font file is a TrueType font (Cairo Light)', () => {
  const b = readFileSync(join(ROOT, 'public/assets/fonts/Cairo-Light.ttf'));
  assert.equal(b.readUInt32BE(0), 0x00010000);
  assert.ok(b.includes(Buffer.from('Cairo Light', 'utf16le')) || b.includes(Buffer.from('Cairo-Light')));
});

test('no machine-specific absolute paths or local URLs in project sources', () => {
  const bad = /(\/home\/|\/root\/|\/Users\/|[A-Z]:\\\\|file:\/\/)/;
  for (const p of sourceFiles) {
    if (p.includes(`${join('tests', 'unit')}`)) continue; // this file contains the patterns
    assert.ok(!bad.test(readFileSync(p, 'utf8')), `absolute path in ${p}`);
  }
});

test('no external font / CDN dependencies in the app', () => {
  const ext = /(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs)/;
  for (const p of ['index.html', 'src/styles/main.css', ...readdirSync(join(ROOT, 'src/scripts')).filter((f) => f.endsWith('.js')).map((f) => `src/scripts/${f}`)]) {
    assert.ok(!ext.test(read(p)), p);
  }
});

test('index.html references only relative paths that exist', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const r of refs) {
    assert.ok(!r.startsWith('/') && !/^https?:/.test(r), `non-relative reference ${r}`);
    assert.ok(existsSync(join(ROOT, r)), `missing ${r}`);
  }
});

test('CSS url() references resolve relative to the stylesheet', () => {
  const css = read('src/styles/main.css');
  for (const m of css.matchAll(/url\('([^']+)'\)/g)) {
    assert.ok(existsSync(resolve(dirname(join(ROOT, 'src/styles/main.css')), m[1])), m[1]);
  }
});

test('JSON asset paths are relative and exist', () => {
  const comp = JSON.parse(read('src/data/composition.json'));
  assert.ok(existsSync(join(ROOT, comp.typed.fontFile)));
  assert.ok(!comp.typed.fontFile.startsWith('/'));
  for (const s of JSON.parse(read('src/data/letters.json')).samples) assert.ok(!s.file.startsWith('/'));
});

test('ES module imports resolve to files', () => {
  for (const p of sourceFiles.filter((f) => f.includes(join('src', 'scripts')))) {
    for (const m of readFileSync(p, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      assert.ok(existsSync(resolve(dirname(p), m[1])), `${p} -> ${m[1]}`);
    }
  }
});

test('settings defaults come from composition.json and are within range', () => {
  const comp = JSON.parse(read('src/data/composition.json'));
  const d = defaultSettings(comp);
  assert.equal(d.typedStroke, comp.typed.thickness);
  for (const [k, spec] of Object.entries(SETTING_SPECS)) {
    if (spec.options) assert.ok(spec.options.includes(d[k]), k);
    else assert.ok(d[k] >= spec.min && d[k] <= spec.max, `${k}=${d[k]}`);
  }
});

test('settings clamp and store', () => {
  assert.equal(clampSetting('overlap', 999), SETTING_SPECS.overlap.max);
  assert.equal(clampSetting('baselineMode', 'nope'), 'joins');
  const store = createStore({ a: 1, characters: {} });
  let calls = 0;
  store.subscribe(() => calls++);
  store.set({ a: 2 });
  store.setCharacter('w', 1, { style: 'typed' });
  assert.equal(store.get().a, 2);
  assert.deepEqual(store.get().characters, { w: { 1: { style: 'typed' } } });
  assert.equal(calls, 2);
});
