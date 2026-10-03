#!/usr/bin/env node
/**
 * End-to-end tests in Chromium (Playwright), served under a sub-path exactly
 * like GitHub Pages: /arabic-hybrid-captcha/
 *
 * Drag and drop is tested with a real mouse on desktop and with real touch
 * events (Chrome DevTools Protocol) on an emulated phone.
 *
 *   npm install && npx playwright install chromium
 *   npm run test:e2e
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';
import { splitLetters } from '../../src/scripts/challenge.js';

const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const WORDS = JSON.parse(readFileSync(new URL('../../src/data/words.json', import.meta.url), 'utf8')).words;
const BASE = '/arabic-hybrid-captcha/';
const PORT = 8700 + Math.floor(Math.random() * 200);
const URL_ROOT = `http://localhost:${PORT}${BASE}`;
const SUCCESS = 'تم التحقق بنجاح. أنت إنسان.';
const ERROR = 'إجابة غير صحيحة. حاول مرة أخرى.';

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail: detail ?? '' });
    console.log(`  ✓ ${name}${detail ? `  (${detail})` : ''}`);
  } catch (err) {
    results.push({ name, status: 'fail', detail: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const server = await startServer({ port: PORT, base: BASE, quiet: true });
const browser = await chromium.launch();
const problems = [];

async function open({ mobile = false } = {}) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 860 } },
  );
  const page = await context.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[failed] ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`[HTTP ${r.status()}] ${r.url()}`));
  await page.goto(URL_ROOT);
  await page.waitForSelector('.tile');
  await page.waitForTimeout(500); // entrance animation
  return page;
}

const order = (page) => page.$$eval('#tiles .tile', (els) => els.map((e) => e.dataset.letter));
const state = (page) => page.$eval('#captcha', (e) => e.dataset.state);
/** Identify the current word from its letters (the page never exposes it). */
async function currentWord(page) {
  const letters = (await order(page)).sort().join('');
  const matches = WORDS.filter((w) => splitLetters(w).sort().join('') === letters);
  assert(matches.length === 1, `tiles ${letters} match ${matches.length} words`);
  return matches[0];
}
const rect = (page, i) => page.$eval(`#tiles .tile:nth-child(${i + 1})`, (e) => e.getBoundingClientRect().toJSON());

/** Drag the tile at index `from` so it lands in front of (to the right of, in RTL) the tile at index `to`. */
async function mouseDrag(page, from, to) {
  const a = await rect(page, from);
  const b = await rect(page, to);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  const tx = b.x + b.width - 6;
  const ty = b.y + b.height / 2;
  const steps = 14;
  for (let s = 1; s <= steps; s++) await page.mouse.move(a.x + a.width / 2 + ((tx - a.x - a.width / 2) * s) / steps, a.y + a.height / 2 + ((ty - a.y - a.height / 2) * s) / steps);
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(260);
}

/** Same gesture with real touch events (touchstart/move/end through CDP). */
async function touchDrag(page, cdp, from, to) {
  const a = await rect(page, from);
  const b = await rect(page, to);
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  const tx = b.x + b.width - 5;
  const ty = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  const steps = 14;
  for (let s = 1; s <= steps; s++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + ((tx - sx) * s) / steps, y: sy + ((ty - sy) * s) / steps }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(260);
}

/** Put the letters in the right order, one drag per misplaced position. */
async function solve(page, drag) {
  const answer = splitLetters(await currentWord(page));
  let moves = 0;
  for (let i = 0; i < answer.length; i++) {
    const cur = await order(page);
    if (cur[i] === answer[i]) continue;
    const from = cur.findIndex((l, j) => j > i && l === answer[i]);
    await drag(from, i);
    moves++;
    const after = await order(page);
    assert(after[i] === answer[i], `drag ${from}→${i} did not place ${answer[i]}: ${after.join('')}`);
  }
  return moves;
}

console.log(`\nServing ${URL_ROOT} (GitHub Pages style sub-path)\n`);

// ------------------------------------------------------------------ desktop
console.log('Desktop (mouse)');
let page = await open();
await page.screenshot({ path: `${OUT}desktop-initial.png` });

await check('only the CAPTCHA is shown: no navigation, settings, admin or other UI', async () => {
  const info = await page.evaluate(() => ({
    links: document.querySelectorAll('a').length,
    navs: document.querySelectorAll('nav, aside, header:not(.captcha__head), footer, dialog, select, input, iframe').length,
    buttons: [...document.querySelectorAll('button')].filter((b) => !b.classList.contains('tile')).map((b) => b.id),
    visibleOutsideCard: [...document.body.querySelectorAll('*')].filter((e) => !e.closest('#captcha') && !['MAIN', 'SCRIPT'].includes(e.tagName) && e.getBoundingClientRect().width > 0).length,
    text: document.body.innerText.replace(/\s+/g, ' ').trim(),
  }));
  assert(info.links === 0 && info.navs === 0, JSON.stringify(info));
  assert(info.buttons.join() === 'new-challenge,verify', info.buttons.join());
  assert(info.visibleOutsideCard === 0, 'content outside the CAPTCHA card');
  const body = await page.evaluate(() => document.body.innerHTML);
  const term = body.match(/admin|setting|gallery|debug|experiment|font-size|customi[sz]/i);
  assert(!term, `old UI term in the page: ${term}`);
  return info.text;
});
await check('Arabic RTL page, card centred on screen', async () => {
  const r = await page.evaluate(() => {
    const c = document.getElementById('captcha').getBoundingClientRect();
    return { dir: document.documentElement.dir, lang: document.documentElement.lang, dx: c.left + c.width / 2 - innerWidth / 2, dy: c.top + c.height / 2 - innerHeight / 2 };
  });
  assert(r.dir === 'rtl' && r.lang === 'ar', `${r.dir} ${r.lang}`);
  assert(Math.abs(r.dx) < 2 && Math.abs(r.dy) < 2, `off-centre by ${r.dx}, ${r.dy}`);
  return 'centred horizontally and vertically';
});
await check('tiles show exactly the letters of one word from the list, scrambled', async () => {
  const word = await currentWord(page);
  const tiles = await order(page);
  assert(tiles.length === splitLetters(word).length, 'extra or missing letters');
  assert(tiles.join('') !== splitLetters(word).join(''), 'shown in the correct order');
  return `${tiles.length} tiles, scrambled`;
});
await check('the answer is not revealed in the page or in global variables', async () => {
  const word = await currentWord(page);
  const leaks = await page.evaluate((w) => {
    const found = [];
    if (document.documentElement.outerHTML.includes(w)) found.push('DOM');
    for (const k of Object.getOwnPropertyNames(window)) {
      try {
        const v = window[k];
        if (v === w || (typeof v === 'string' && v.includes(w))) found.push(k);
      } catch {
        /* ignore */
      }
    }
    try {
      if (Object.values(localStorage).some((v) => v.includes(w))) found.push('localStorage');
    } catch {
      /* ignore */
    }
    return found;
  }, word);
  assert(!leaks.length, `answer found in: ${leaks.join(', ')}`);
  return 'not in DOM, globals or storage';
});
await check('Verify with the wrong order shows the error and keeps the letters movable', async () => {
  await page.click('#verify');
  await page.waitForTimeout(450);
  assert((await state(page)) === 'error', 'no error state');
  assert((await page.textContent('#result-text')) === ERROR, await page.textContent('#result-text'));
  assert(await page.$eval('.result__cross', (e) => getComputedStyle(e).display !== 'none'), 'no error icon');
  await page.screenshot({ path: `${OUT}desktop-error.png` });
  return ERROR;
});
await check('mouse drag and drop reorders tiles (other tiles slide aside)', async () => {
  const before = await order(page);
  const a = await rect(page, before.length - 1);
  const b = await rect(page, 0);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let s = 1; s <= 10; s++) await page.mouse.move(a.x + a.width / 2 + (b.x + b.width - 6 - a.x - a.width / 2) * (s / 10), a.y + a.height / 2 - 6 * Math.sin((s / 10) * Math.PI));
  const lifted = await page.$eval('.tile.is-dragging', (e) => getComputedStyle(e).transform !== 'none').catch(() => false);
  await page.screenshot({ path: `${OUT}desktop-dragging.png` });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await order(page);
  assert(lifted, 'tile did not follow the pointer');
  assert(after[0] === before[before.length - 1], `${before.join('')} → ${after.join('')}`);
  assert((await state(page)) === 'ready', 'error message should clear after moving a letter');
  return `${before.join(' ')} → ${after.join(' ')}`;
});
await check('arrange the correct word with the mouse → green check and success message', async () => {
  await page.click('#new-challenge'); // fresh scramble, so at least one drag is needed
  await page.waitForTimeout(500);
  const moves = await solve(page, (f, t) => mouseDrag(page, f, t));
  assert(moves > 0, 'nothing to drag');
  await page.click('#verify');
  await page.waitForTimeout(900);
  assert((await state(page)) === 'success', 'no success state');
  assert((await page.textContent('#result-text')) === SUCCESS, await page.textContent('#result-text'));
  const check = await page.$eval('.result__check', (e) => ({ display: getComputedStyle(e).display, stroke: getComputedStyle(e).stroke }));
  assert(check.display === 'block' && check.stroke === 'rgb(21, 128, 61)', JSON.stringify(check));
  await page.screenshot({ path: `${OUT}desktop-success.png` });
  return `${moves} drag(s); ${SUCCESS}`;
});
await check('after success the letters are locked', async () => {
  const before = await order(page);
  await mouseDrag(page, 0, before.length - 1);
  assert((await order(page)).join('') === before.join(''), 'tiles still movable');
  return 'locked';
});
await check('tap one letter then another to swap them (alternative to dragging)', async () => {
  await page.click('#new-challenge');
  await page.waitForTimeout(500);
  const before = await order(page);
  await page.click('#tiles .tile:nth-child(1)');
  await page.click(`#tiles .tile:nth-child(${before.length})`);
  await page.waitForTimeout(250);
  const after = await order(page);
  assert(after[0] === before[before.length - 1] && after[before.length - 1] === before[0], `${before.join('')} → ${after.join('')}`);
  return `${before.join(' ')} → ${after.join(' ')}`;
});
await check('keyboard: arrow keys move the focused letter', async () => {
  const before = await order(page);
  await page.focus('#tiles .tile:nth-child(1)');
  await page.keyboard.press('ArrowLeft'); // RTL: left = later in the word
  await page.waitForTimeout(250);
  const after = await order(page);
  assert(after[1] === before[0] && after[0] === before[1], `${before.join('')} → ${after.join('')}`);
  const focused = await page.evaluate(() => document.activeElement.dataset.letter);
  assert(focused === before[0], 'focus lost');
  return 'ArrowLeft moved the letter one place';
});
await page.close();

await check('every page load is a new challenge; the previous word is never repeated', async () => {
  const p = await open();
  const seq = [];
  for (let i = 0; i < 15; i++) {
    const w = await currentWord(p);
    const tiles = await order(p);
    assert(tiles.join('') !== splitLetters(w).join(''), `load ${i}: shown already solved`);
    seq.push(w);
    await p.reload();
    await p.waitForSelector('.tile');
  }
  await p.close();
  for (let i = 1; i < seq.length; i++) assert(seq[i] !== seq[i - 1], `repeated ${seq[i]} at load ${i}`);
  assert(new Set(seq).size === WORDS.length, `only saw ${[...new Set(seq)].join(', ')}`);
  return seq.join(' → ');
});
await check('“new challenge” button also changes the word and scrambles again', async () => {
  const p = await open();
  const seen = [await currentWord(p)];
  for (let i = 0; i < 6; i++) {
    await p.click('#new-challenge');
    await p.waitForTimeout(150);
    seen.push(await currentWord(p));
    assert(seen.at(-1) !== seen.at(-2), 'same word twice');
    assert((await state(p)) === 'ready', 'state not reset');
  }
  await p.close();
  return seen.join(' → ');
});

// ------------------------------------------------------------------ mobile
console.log('\nMobile (touch)');
page = await open({ mobile: true });
const cdp = await page.context().newCDPSession(page);
await check('mobile layout: fits 390 px, no horizontal scroll, tiles large enough to touch', async () => {
  const r = await page.evaluate(() => {
    let worst = 0;
    for (const el of document.body.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width) worst = Math.max(worst, -b.left, b.right - innerWidth);
    }
    const t = document.querySelector('.tile').getBoundingClientRect();
    return { worst, scroll: document.documentElement.scrollWidth - innerWidth, tile: [t.width, t.height] };
  });
  assert(r.worst <= 0 && r.scroll <= 0, `overflow ${r.worst}px`);
  assert(r.tile[0] >= 44 && r.tile[1] >= 44, `tile ${r.tile}`);
  await page.screenshot({ path: `${OUT}mobile-initial.png` });
  return `tile ${Math.round(r.tile[0])}×${Math.round(r.tile[1])} px`;
});
await check('touch drag reorders tiles without scrolling the page', async () => {
  const before = await order(page);
  await touchDrag(page, cdp, before.length - 1, 0);
  const after = await order(page);
  const scrolled = await page.evaluate(() => scrollY);
  assert(after[0] === before[before.length - 1], `${before.join('')} → ${after.join('')}`);
  assert(scrolled === 0, `page scrolled ${scrolled}px`);
  return `${before.join(' ')} → ${after.join(' ')}`;
});
await check('wrong answer on mobile → error; solve by touch → success', async () => {
  const word = await currentWord(page);
  if ((await order(page)).join('') !== splitLetters(word).join('')) {
    await page.tap('#verify');
    await page.waitForTimeout(450);
    assert((await page.textContent('#result-text')) === ERROR, 'no error message');
    await page.screenshot({ path: `${OUT}mobile-error.png` });
  }
  const moves = await solve(page, (f, t) => touchDrag(page, cdp, f, t));
  await page.tap('#verify');
  await page.waitForTimeout(900);
  assert((await state(page)) === 'success', 'no success');
  assert((await page.textContent('#result-text')) === SUCCESS, 'wrong message');
  await page.screenshot({ path: `${OUT}mobile-success.png` });
  return `${word}: ${moves} touch drag(s)`;
});
await check('tap-to-swap works with touch', async () => {
  await page.tap('#new-challenge');
  await page.waitForTimeout(500);
  const before = await order(page);
  await page.tap('#tiles .tile:nth-child(1)');
  await page.tap('#tiles .tile:nth-child(2)');
  await page.waitForTimeout(250);
  const after = await order(page);
  assert(after[0] === before[1] && after[1] === before[0], `${before.join('')} → ${after.join('')}`);
  return `${before.join(' ')} → ${after.join(' ')}`;
});
await page.close();

// ------------------------------------------------------------------ deployment
console.log('\nDeployment');
await check('works under the GitHub Pages sub-path: no 404s, failed requests or console errors', () => {
  if (problems.length) throw new Error(problems.join('\n      '));
  return `served from ${BASE}`;
});
await check('font loads from the local file', async () => {
  const p = await open();
  const ok = await p.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('300 32px Cairo', 'ب');
  });
  await p.close();
  assert(ok, 'Cairo not loaded');
  return 'Cairo Light';
});

await browser.close();
server.close();
const failed = results.filter((r) => r.status === 'fail');
writeFileSync(`${OUT}report.json`, JSON.stringify({ date: new Date().toISOString(), base: BASE, results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Report: tests/e2e/output/report.json\n`);
process.exit(failed.length ? 1 : 0);
