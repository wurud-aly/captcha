#!/usr/bin/env node
/**
 * Build the GitHub Pages bundle: only the CAPTCHA page and its assets.
 *
 *   node scripts/build-pages.mjs [outDir]     (default: _site)
 *
 * Included: index.html, .nojekyll, public/, src/
 * Never included: tests/, scripts/, .github/, node_modules, README, package files.
 */
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const PUBLIC_ENTRIES = ['index.html', '.nojekyll', 'public', 'src'];
const EXCLUDE = [/(^|\/)\./, /\.tmp$/]; // dotfiles inside folders, temp files

export function buildPages(outDir = join(ROOT, '_site')) {
  const out = resolve(outDir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of PUBLIC_ENTRIES) {
    const src = join(ROOT, entry);
    if (!existsSync(src)) continue;
    cpSync(src, join(out, entry), {
      recursive: true,
      filter: (p) => {
        const rel = relative(ROOT, p).split('\\').join('/');
        return rel === entry || !EXCLUDE.some((re) => re.test(rel.slice(entry.length + 1)));
      },
    });
  }
  return { out, files: list(out).map((p) => relative(out, p).split('\\').join('/')) };
}

function list(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) list(p, acc);
    else acc.push(p);
  }
  return acc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { out, files } = buildPages(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`GitHub Pages bundle: ${files.length} files in ${relative(process.cwd(), out) || out}`);
}
