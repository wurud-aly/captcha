#!/usr/bin/env node
/**
 * Admin dashboard end-to-end test (Playwright + Chromium).
 * Runs against a throwaway copy of the project, so real data is never changed.
 *
 *   npm run test:admin
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer, PASSWORD, letterPng } from '../server/helpers.mjs';

const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail: detail ?? '' });
    console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, status: 'fail', detail: err.message });
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const srv = await startServer();
const B = srv.base;
const originals = Object.fromEntries(readdirSync(join(srv.dir, 'public/assets/handwritten')).filter((f) => f.endsWith('.png')).map((f) => [f, sha(join(srv.dir, 'public/assets/handwritten', f))]));
writeFileSync(join(OUT, 'upload-valid.png'), await letterPng());
writeFileSync(join(OUT, 'upload-opaque.png'), await letterPng({ opaque: true }));
writeFileSync(join(OUT, 'upload-fake.png'), Buffer.from('this is not an image'));

const browser = await chromium.launch();
const problems = [];
// Chrome logs every 401 response as a console error; the test triggers those on
// purpose (wrong password, API call after sign-out), so only they are ignored.
const EXPECTED = /status of 401 \(Unauthorized\)/;
async function newPage(viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !EXPECTED.test(m.text()) && problems.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url()}`));
  return page;
}
const page = await newPage();
const settle = () => page.waitForTimeout(350);
const dirtyText = () => page.textContent('#dirty-state');
const canvasHash = (sel) =>
  page.$eval(sel, (c) => {
    const d = c.toDataURL();
    let h = 0;
    for (let i = 0; i < d.length; i++) h = (Math.imul(31, h) + d.charCodeAt(i)) | 0;
    return h;
  });
const inkPixels = (sel) =>
  page.$eval(sel, (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++;
    return n;
  });
const go = async (hash) => {
  await page.evaluate((h) => (location.hash = h), hash);
  await settle();
};

console.log(`\nAdmin server on a temporary project copy: ${B}\n`);
console.log('1. Access control');
await check('dashboard redirects to the login page when signed out', async () => {
  await page.goto(`${B}/admin`);
  assert(page.url().endsWith('/admin/login'), page.url());
  const dir = await page.evaluate(() => document.documentElement.dir);
  assert(dir === 'rtl', 'login page is not RTL');
  await page.screenshot({ path: `${OUT}admin-login.png` });
  return 'login page in Arabic (RTL)';
});
await check('wrong password shows an error and does not sign in', async () => {
  await page.fill('#password', 'not the password');
  await page.click('#login-btn');
  await page.waitForSelector('#login-status.status--error');
  assert(page.url().endsWith('/admin/login'), 'navigated away');
  return (await page.textContent('#login-status')).trim();
});
await check('correct password opens the dashboard', async () => {
  srv.limiter.success('127.0.0.1');
  await page.fill('#password', PASSWORD);
  await page.click('#login-btn');
  await page.waitForSelector('html[data-ready="true"]', { timeout: 20000 });
  assert(page.url().endsWith('/admin'), page.url());
  assert((await page.$$('#letter-grid .tile')).length === 12, 'letter grid');
  await page.screenshot({ path: `${OUT}admin-letters.png`, fullPage: true });
  return '12 letters listed';
});

console.log('\n2. Letters');
await check('letter editor: before/after previews and words using the letter', async () => {
  await go('#letters/hw-05');
  assert((await inkPixels('#before-canvas')) > 200, 'before preview blank');
  assert((await inkPixels('#after-canvas')) > 200, 'after preview blank');
  const ctxCount = await page.$$eval('#letter-context canvas', (c) => c.length);
  assert(ctxCount === 1, `context previews: ${ctxCount}`);
  await page.screenshot({ path: `${OUT}admin-letter-editor.png`, fullPage: true });
  return 'hw-05 shown in حاسب';
});
await check('size/position adjustments update the previews and are stored separately', async () => {
  const before = await canvasHash('#after-canvas');
  const ctxBefore = await canvasHash('#letter-context canvas');
  await page.$eval('#adj-scale', (el) => {
    el.value = '1.4';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('#adj-offsetY', (el) => {
    el.value = '-6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  assert(before !== (await canvasHash('#after-canvas')), 'after preview unchanged');
  assert(ctxBefore !== (await canvasHash('#letter-context canvas')), 'word preview unchanged');
  const adj = await page.evaluate(() => fetch('/admin/api/data').then((r) => r.json()).then((d) => d.letters.samples.find((s) => s.id === 'hw-05').adjust));
  assert(adj.scale === 1, 'server data changed before saving');
  return (await dirtyText()).trim();
});
await check('connection point tools: click sets the entry/exit point; undo, redo and discard work', async () => {
  await go('#letters/hw-11');
  const get = () => page.evaluate(() => document.getElementById('geo-exit-x').value);
  const x0 = await get();
  await page.click('[data-tool="exit"]');
  const box = await page.$eval('#before-canvas', (c) => c.getBoundingClientRect().toJSON());
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await settle();
  const x1 = await get();
  assert(x1 !== x0, 'exit point did not move');
  await page.click('#undo-btn');
  await settle();
  assert((await get()) === x0, 'undo failed');
  await page.click('#redo-btn');
  await settle();
  assert((await get()) === x1, 'redo failed');
  await page.click('#discard-btn');
  await page.click('#confirm-ok');
  await settle();
  assert((await dirtyText()).includes('لا توجد'), 'discard did not reset');
  return `exit x ${x0} → ${x1}, undo/redo/discard ok`;
});
await check('upload: non-PNG and opaque images are rejected with a clear message', async () => {
  await go('#letters/new');
  await page.setInputFiles('#upload-file', join(OUT, 'upload-fake.png'));
  await page.waitForSelector('.status--error');
  const fake = await page.textContent('.status');
  await page.setInputFiles('#upload-file', join(OUT, 'upload-opaque.png'));
  await page.waitForFunction(() => document.querySelector('.status').textContent.includes('شفافة'));
  const opaque = await page.textContent('.status');
  assert(await page.$eval('#add-letter', (b) => b.disabled), 'add enabled for invalid file');
  return `${fake.trim()} / ${opaque.trim()}`;
});
await check('upload a transparent PNG, assign the letter ب (initial), add to library', async () => {
  await page.setInputFiles('#upload-file', join(OUT, 'upload-valid.png'));
  await page.waitForSelector('.status--success');
  await page.selectOption('#new-char', 'ب');
  await page.selectOption('#new-form', 'initial');
  await page.click('#add-letter');
  await settle();
  assert(page.url().endsWith('#letters/hw-13'), page.url());
  assert((await inkPixels('#before-canvas')) > 100, 'new letter preview blank');
  await go('#letters');
  const badge = await page.textContent('[data-sample="hw-13"]');
  assert(badge.includes('جديد'), 'new badge missing');
  return 'hw-13 added (unsaved)';
});
await check('replace an image: new file for that letter only', async () => {
  await go('#letters/hw-12');
  await page.setInputFiles('#replace-file', join(OUT, 'upload-valid.png'));
  await settle();
  const file = await page.textContent('.adm-head .adm-muted');
  assert(file.includes('unsaved'), file);
  await page.click('#undo-btn');
  await settle();
  return 'replaced, then undone';
});
await check('delete a letter: confirmation dialog (cancel keeps it, confirm removes it)', async () => {
  await go('#letters/hw-01');
  await page.click('#delete-letter');
  await page.waitForSelector('#confirm-dialog[open]');
  const body = await page.textContent('#confirm-body');
  await page.click('#confirm-cancel');
  await settle();
  assert(page.url().endsWith('#letters/hw-01'), 'cancel did not keep the letter');
  await page.click('#delete-letter');
  await page.click('#confirm-ok');
  await settle();
  assert(!(await page.$('[data-sample="hw-01"]')), 'still listed');
  return body.includes('لا يُحذف') ? 'dialog explains the file is kept' : 'deleted';
});

console.log('\n3. Words');
await check('add the word باب with a live preview', async () => {
  await go('#words/new');
  await page.fill('#new-word', 'abc');
  await page.click('#create-word');
  await page.waitForSelector('.status--error');
  await page.fill('#new-word', 'باب');
  await page.fill('#new-meaning', 'door');
  await page.click('#create-word');
  await settle();
  assert(page.url().includes('#words/'), page.url());
  assert((await inkPixels('#word-preview')) > 300, 'preview blank');
  return page.url().split('#')[1];
});
await check('choose handwritten/typed per letter and pick samples', async () => {
  await page.click('.letter-chip[data-index="0"]');
  await page.click('.segmented button[data-style="handwritten"]');
  await settle();
  const s0 = await page.$eval('#letter-sample', (s) => [...s.options].map((o) => o.value));
  assert(s0.includes('hw-13'), `ب initial samples: ${s0}`);
  await page.click('.letter-chip[data-index="1"]');
  await page.click('.segmented button[data-style="handwritten"]');
  await settle();
  await page.selectOption('#letter-sample', 'hw-03');
  await settle();
  await page.click('.letter-chip[data-index="2"]');
  const disabled = await page.$eval('.segmented button[data-style="handwritten"]', (b) => b.disabled);
  assert(disabled, 'isolated ب has no handwritten sample, toggle should be disabled');
  const chips = await page.$$eval('.letter-chip', (c) => c.map((x) => x.dataset.style));
  assert(chips.join() === 'handwritten,handwritten,typed', chips.join());
  await page.screenshot({ path: `${OUT}admin-word-editor.png`, fullPage: true });
  return 'ب hw-13, ا hw-03, ب typed';
});
await check('per-letter adjustment in a word changes the preview', async () => {
  const before = await canvasHash('#word-preview');
  await page.$eval('#word-adj-offsetX', (el) => {
    el.value = '8';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  assert(before !== (await canvasHash('#word-preview')), 'no change');
  return 'offsetX +8';
});
await check('delete a word with confirmation', async () => {
  await go('#words/new');
  await page.fill('#new-word', 'دار');
  await page.click('#create-word');
  await settle();
  await page.click('#delete-word');
  await page.click('#confirm-ok');
  await settle();
  const words = await page.$$eval('[data-word]', (a) => a.map((x) => x.textContent));
  assert(!words.some((w) => w.includes('دار')), 'دار still listed');
  return `${words.length} words listed`;
});

console.log('\n4. Layout, preview and save');
await check('global spacing/overlap settings update the live preview', async () => {
  await go('#layout');
  const before = await canvasHash('#layout-preview');
  await page.$eval('#comp-layout-overlap', (el) => {
    el.value = '6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('#comp-layout-spacing', (el) => {
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  assert(before !== (await canvasHash('#layout-preview')), 'no change');
  await page.screenshot({ path: `${OUT}admin-layout.png`, fullPage: true });
  return 'overlap 6, spacing 30';
});
await check('Preview CAPTCHA: saved vs draft side by side, answer test works', async () => {
  await go('#preview');
  await page.selectOption('#preview-word', { label: 'باب' });
  await settle();
  const savedHidden = await page.$eval('#preview-saved', (c) => c.hidden);
  assert(savedHidden, 'new word should not exist in the saved version yet');
  assert((await inkPixels('#preview-draft')) > 300, 'draft preview blank');
  await page.fill('#preview-answer', 'باب');
  await page.click('#preview-answer ~ button');
  await page.waitForSelector('#preview-status.status--success');
  await page.selectOption('#preview-word', { label: 'فهد' });
  await settle();
  const differ = (await canvasHash('#preview-saved')) !== (await canvasHash('#preview-draft'));
  await page.screenshot({ path: `${OUT}admin-preview.png`, fullPage: true });
  assert(differ, 'saved and draft should differ after layout changes');
  return 'باب only in draft; فهد differs saved vs draft; answer verified';
});
await check('Save and apply writes the files; originals untouched', async () => {
  const issues = await page.$eval('#issues', (e) => (e.hidden ? '' : e.textContent));
  assert(!issues, `issues: ${issues}`);
  await page.click('#save-btn');
  await page.waitForSelector('.adm-toast--success', { timeout: 15000 });
  const words = JSON.parse(readFileSync(join(srv.dir, 'src/data/words.json'), 'utf8')).words;
  const letters = JSON.parse(readFileSync(join(srv.dir, 'src/data/letters.json'), 'utf8')).samples;
  const comp = JSON.parse(readFileSync(join(srv.dir, 'src/data/composition.json'), 'utf8'));
  const bab = words.find((w) => w.word === 'باب');
  assert(bab && bab.characters[0].sample === 'hw-13' && bab.characters[1].sample === 'hw-03', JSON.stringify(bab));
  const hw13 = letters.find((s) => s.id === 'hw-13');
  assert(hw13 && /uploads\/hw-13-[0-9a-f]{12}\.png$/.test(hw13.file) && existsSync(join(srv.dir, hw13.file)), 'upload not stored');
  assert(!letters.find((s) => s.id === 'hw-01'), 'deleted letter still present');
  assert(bab.characters[2].adjust?.offsetX === 8, 'per-letter word adjustment not saved');
  assert(letters.find((s) => s.id === 'hw-05').adjust.scale === 1, 'discarded adjustment was saved');
  assert(comp.layout.overlap === 6 && comp.layout.spacing === 30, 'layout not saved');
  const now = Object.fromEntries(Object.keys(originals).map((f) => [f, sha(join(srv.dir, 'public/assets/handwritten', f))]));
  assert(JSON.stringify(now) === JSON.stringify(originals), 'an original image changed');
  assert((await dirtyText()).includes('لا توجد'), 'still dirty after save');
  return `${words.length} words, ${letters.length} letters; 12 originals byte-identical`;
});
await check('the public CAPTCHA renders the new word with the uploaded letter', async () => {
  const pub = await newPage();
  await pub.goto(`${B}/?debug`);
  await pub.waitForSelector('html[data-ready="true"]');
  const bab = await pub.$('[data-word="bab"]');
  assert(bab, 'word not in public picker');
  await bab.click();
  await pub.waitForTimeout(300);
  const plan = await pub.evaluate(() => window.__ahc.app.last.plan.map((l) => `${l.char}:${l.sample?.id || 'typed'}`).join(' '));
  assert(plan === 'ب:hw-13 ا:hw-03 ب:typed', plan);
  await pub.fill('#answer-input', 'باب');
  await pub.click('#answer-form button[type="submit"]');
  assert((await pub.$eval('#status', (e) => e.className)).includes('success'), 'public verify failed');
  await pub.screenshot({ path: `${OUT}admin-public-after-save.png` });
  await pub.close();
  return plan;
});

console.log('\n5. History, language, mobile, sign out');
await check('backups listed; restore brings back the previous version', async () => {
  await go('#history');
  await page.waitForSelector('[data-backup]');
  const n = await page.$$eval('[data-backup]', (b) => b.length);
  await page.click('[data-backup]');
  const restored = page.waitForResponse((r) => r.url().endsWith('/admin/api/backups/restore'));
  await page.click('#confirm-ok');
  assert((await restored).status() === 200, 'restore request failed');
  await page.waitForFunction(() => !document.querySelector('[data-word="bab"]') && document.getElementById('dirty-state').textContent.length > 0);
  const words = JSON.parse(readFileSync(join(srv.dir, 'src/data/words.json'), 'utf8')).words.map((w) => w.word);
  assert(words.join() === 'شبكات,حاسب,فهد', words.join());
  await page.screenshot({ path: `${OUT}admin-history.png`, fullPage: true });
  return `${n} backup(s); restored ${words.join('، ')}`;
});
await check('English interface switches to LTR', async () => {
  await page.click('#lang-btn');
  await settle();
  const st = await page.evaluate(() => [document.documentElement.dir, document.querySelector('[data-view="letters"]').textContent]);
  assert(st[0] === 'ltr' && st[1] === 'Letters', st.join());
  await page.click('#lang-btn');
  return 'ltr ⇄ rtl';
});
await check('mobile (390 px): every view fits without horizontal scrolling', async () => {
  const m = await page.context().newPage(); // same signed-in browser session
  await m.setViewportSize({ width: 390, height: 844 });
  m.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  await m.goto(`${B}/admin`);
  await m.waitForSelector('html[data-ready="true"]');
  const over = [];
  for (const v of ['letters', 'letters/hw-05', 'letters/new', 'words', 'words/shabakat', 'layout', 'preview', 'history']) {
    await m.evaluate((h) => (location.hash = h), `#${v}`);
    await m.waitForTimeout(400);
    // check every element's box (RTL overflow goes left and does not show up in scrollWidth);
    // the section tabs scroll horizontally on purpose and are excluded
    const o = await m.evaluate(() => {
      let worst = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.adm-nav, dialog:not([open]), [hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        worst = Math.max(worst, -r.left, r.right - window.innerWidth);
      }
      return Math.round(Math.max(worst, document.documentElement.scrollWidth - window.innerWidth));
    });
    if (o > 1) over.push(`${v}:${o}px`);
    if (v === 'letters/hw-05' || v === 'words/shabakat') await m.screenshot({ path: `${OUT}admin-mobile-${v.replace('/', '-')}.png`, fullPage: true });
  }
  await m.close();
  assert(!over.length, over.join(', '));
  return '8 views';
});
await check('sign out ends the session', async () => {
  await page.click('#logout-btn');
  await page.waitForURL(/\/admin\/login$/);
  const r = await page.evaluate(() => fetch('/admin/api/data').then((x) => x.status));
  await page.goto(`${B}/admin`);
  assert(r === 401 && page.url().endsWith('/admin/login'), `api ${r}, url ${page.url()}`);
  return 'API 401, dashboard → login';
});
await check('no console errors, CSP violations or server errors during the whole run', () => {
  if (problems.length) throw new Error(problems.join('\n      '));
  return 'clean';
});

await browser.close();
await srv.close();
const failed = results.filter((r) => r.status === 'fail');
writeFileSync(`${OUT}admin-report.json`, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Report: tests/e2e/output/admin-report.json\n`);
process.exit(failed.length ? 1 : 0);
