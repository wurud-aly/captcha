#!/usr/bin/env node
/**
 * End-to-end browser tests (Playwright + Chromium).
 *
 * The app is served under a sub-path (/arabic-hybrid-captcha/) exactly like a
 * GitHub Pages project site, then exercised in a real browser.
 *
 *   npm install            # installs playwright (dev dependency)
 *   npx playwright install chromium
 *   npm run test:e2e
 *
 * Output: tests/e2e/output/report.json, screenshots and per-word renders.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';

const OUT = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const BASE = '/arabic-hybrid-captcha/';
const PORT = 8600 + Math.floor(Math.random() * 300);
const URL_ROOT = `http://localhost:${PORT}${BASE}`;

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
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const server = await startServer({ port: PORT, base: BASE, quiet: true });
const browser = await chromium.launch();
const problems = { console: [], network: [] };

// Pages driven by pixel-reading test helpers trigger Chrome's "willReadFrequently"
// performance hint on the test's own canvases; that one message is ignored there.
// The clean-session check below (strict) verifies the app emits no warnings at all.
const TEST_READBACK_HINT = /willReadFrequently/;
async function openPage({ width = 1400, height = 900, dsf = 1, query = 'debug', name = 'page', strict = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (!strict && m.type() === 'warning' && TEST_READBACK_HINT.test(m.text())) return;
    problems.console.push(`${name}: [${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.console.push(`${name}: [pageerror] ${e.message}`));
  page.on('requestfailed', (r) => problems.network.push(`${name}: failed ${r.url()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.network.push(`${name}: HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(`${URL_ROOT}?${query}`);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 20000 });
  return page;
}

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const canvasHash = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const data = document.getElementById('captcha-canvas').toDataURL();
    let h = 0;
    for (let i = 0; i < data.length; i++) h = (Math.imul(31, h) + data.charCodeAt(i)) | 0;
    return h;
  });

// ---------------------------------------------------------------- in-page helpers
const HELPERS = () => {
  window.__t = {
    alpha(canvas) {
      const ctx = canvas.getContext('2d');
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const a = new Float32Array(canvas.width * canvas.height);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
      return a;
    },
    components(a, w, h, threshold = 0.15, minSize = 4) {
      const seen = new Uint8Array(w * h);
      let n = 0;
      for (let i = 0; i < a.length; i++) {
        if (seen[i] || a[i] <= threshold) continue;
        let size = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const p = stack.pop();
          size++;
          const x = p % w;
          const y = (p / w) | 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const q = yy * w + xx;
              if (!seen[q] && a[q] > threshold) {
                seen[q] = 1;
                stack.push(q);
              }
            }
        }
        if (size >= minSize) n++;
      }
      return n;
    },
    ncc(a, b) {
      let ma = 0;
      let mb = 0;
      for (let i = 0; i < a.length; i++) {
        ma += a[i];
        mb += b[i];
      }
      ma /= a.length;
      mb /= b.length;
      let num = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
      }
      return num / Math.sqrt(da * db);
    },
  };
};

// ---------------------------------------------------------------- tests
console.log(`\nServing ${URL_ROOT} (GitHub Pages style sub-path)\n`);
const page = await openPage({ name: 'desktop', dsf: 2 });
await page.evaluate(HELPERS);

console.log('A. Assets');
await check('all 12 handwritten images load at their recorded size', () =>
  page.evaluate(() => {
    const { engine } = window.__ahc;
    const bad = engine.letters.all().filter((s) => {
      const img = engine.imageFor(s.id);
      return !img || img.naturalWidth !== s.image.width || img.naturalHeight !== s.image.height;
    });
    if (bad.length) throw new Error(`bad: ${bad.map((s) => s.id)}`);
    return `${engine.letters.all().length} images`;
  }),
);
await check('gallery images (original files) load', async () => {
  const n = await page.$$eval('#gallery-grid img', async (imgs) => {
    await Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => null))));
    return imgs.filter((i) => i.naturalWidth > 0).length;
  });
  assert(n === 12, `${n} gallery images loaded`);
  return '12/12';
});
await check('Cairo Light loads from the local file and is used for typed letters', () =>
  page.evaluate(() => {
    const fam = window.__ahc.engine.composition.typed.fontFamily;
    if (!document.fonts.check(`300 40px "${fam}"`, 'شبكات')) throw new Error('engine font not loaded');
    if (!document.fonts.check(`300 16px "Cairo UI"`, 'ب')) throw new Error('UI font not loaded');
    const c = document.createElement('canvas').getContext('2d');
    c.font = `300 100px "${fam}"`;
    const cairo = c.measureText('شبكات').width;
    c.font = '300 100px serif';
    const fallback = c.measureText('شبكات').width;
    if (Math.abs(cairo - fallback) < 0.5) throw new Error('glyph widths equal to fallback font');
    const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, '') === fam && f.status === 'loaded');
    if (!faces.length) throw new Error('FontFace not registered');
    return `width Cairo ${cairo.toFixed(1)} vs fallback ${fallback.toFixed(1)}`;
  }),
);

console.log('\nB/C. Rendering and word generation');
const words = await page.evaluate(() => window.__ahc.engine.words.all().map((w) => ({ id: w.id, word: w.word, characters: w.characters })));
for (const w of words) {
  await page.click(`[data-word="${w.id}"]`);
  await settle(page);

  await check(`${w.word}: plan matches words.json (letters, forms, styles, samples)`, () =>
    page.evaluate((w) => {
      const plan = window.__ahc.app.last.plan;
      if (plan.length !== w.characters.length) throw new Error('length mismatch');
      plan.forEach((l, i) => {
        const c = w.characters[i];
        if (l.char !== c.char || l.form !== c.form || l.style !== c.style || (c.sample && l.sample?.id !== c.sample))
          throw new Error(`letter ${i}: got ${l.char}/${l.form}/${l.style}/${l.sample?.id}`);
      });
      return plan.map((l) => `${l.char}:${l.style === 'handwritten' ? l.sample.id : 'typed'}`).join(' ');
    }, w),
  );

  await check(`${w.word}: right-to-left ordering of letters on the canvas`, () =>
    page.evaluate(() => {
      const { pieces, layout, fit } = window.__ahc.app.last;
      const cx = pieces.map((p, i) => fit.tx + (layout.placements[i].x + p.inkBox.x + p.inkBox.w / 2) * fit.scale);
      for (let i = 1; i < cx.length; i++) if (!(cx[i] < cx[i - 1])) throw new Error(`letter ${i} not left of ${i - 1}`);
      return `centres x: ${cx.map((v) => Math.round(v)).join(' > ')}`;
    }),
  );

  await check(`${w.word}: connected letters meet exactly at their connection points`, () =>
    page.evaluate(() => {
      const { layout, k } = window.__ahc.app.last;
      const s = window.__ahc.store.get();
      for (const j of layout.joins) {
        const dx = j.entry.x - j.exit.x - s.overlap * k;
        const dy = j.entry.y - j.exit.y;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) throw new Error(`join ${j.from}->${j.to} off by ${dx}, ${dy}`);
      }
      return `${layout.joins.length} joins, ${layout.groups.length} groups`;
    }),
  );

  await check(`${w.word}: no visible gap at any join (pixel check)`, () =>
    page.evaluate(() => {
      const { engine, store, app } = window.__ahc;
      const c = document.createElement('canvas');
      const r = engine.render(c, { wordId: app.wordId, settings: { ...store.get(), background: 'plain', showGuides: false }, seed: 1, dpr: 2, setAnswer: false });
      const ctx = c.getContext('2d');
      const out = [];
      for (const j of r.layout.joins) {
        const x = Math.round(r.fit.tx + ((j.exit.x + j.entry.x) / 2) * r.fit.scale);
        const y = Math.round(r.fit.ty + ((j.exit.y + j.entry.y) / 2) * r.fit.scale);
        const d = ctx.getImageData(x - 3, y - 3, 7, 7).data;
        let darkest = 1;
        for (let i = 0; i < d.length; i += 4) darkest = Math.min(darkest, (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255);
        if (darkest > 0.5) throw new Error(`gap at join ${j.from}->${j.to} (lightest-ink ${darkest.toFixed(2)})`);
        out.push(darkest.toFixed(2));
      }
      return `ink luminance at joins: ${out.join(', ') || 'no joins'}`;
    }),
  );

  await check(`${w.word}: handwritten letters keep all parts (dots), are not cropped or mirrored`, () =>
    page.evaluate(() => {
      const { engine, app } = window.__ahc;
      const T = window.__t;
      const report = [];
      app.last.pieces.forEach((p, i) => {
        if (p.kind !== 'handwritten') return;
        const s = engine.letters.get(p.sampleId);
        // components: original image vs processed piece
        const img = engine.imageFor(s.id);
        const oc = document.createElement('canvas');
        oc.width = s.image.width;
        oc.height = s.image.height;
        oc.getContext('2d').drawImage(img, 0, 0);
        const oa = T.alpha(oc);
        const origParts = T.components(oa, oc.width, oc.height);
        const pa = T.alpha(p.canvas);
        const pieceParts = T.components(pa, p.canvas.width, p.canvas.height);
        if (pieceParts !== origParts) throw new Error(`${s.id}: ${origParts} parts in original, ${pieceParts} rendered`);
        // not cropped: ink never touches the raster edge
        const b = p.inkBox;
        if (b.x <= 0 || b.y <= 0 || b.x + b.w >= p.width || b.y + b.h >= p.height) throw new Error(`${s.id}: ink touches raster edge`);
        // not mirrored: map the raster back to original pixels and correlate
        // with the original image and with its horizontal mirror image
        const back = document.createElement('canvas');
        back.width = s.image.width;
        back.height = s.image.height;
        back.getContext('2d').drawImage(p.canvas, p.pad, p.pad, s.image.width * p.scale, s.image.height * p.scale, 0, 0, s.image.width, s.image.height);
        const ba = T.alpha(back);
        const mirrored = new Float32Array(oa.length);
        for (let y = 0; y < oc.height; y++) for (let x = 0; x < oc.width; x++) mirrored[y * oc.width + x] = oa[y * oc.width + (oc.width - 1 - x)];
        const same = T.ncc(ba, oa);
        const flip = T.ncc(ba, mirrored);
        if (!(same > 0.8 && same > flip + 0.2)) throw new Error(`${s.id}: correlation ${same.toFixed(2)} vs mirrored ${flip.toFixed(2)}`);
        report.push(`${s.id}: ${pieceParts} part(s), ncc ${same.toFixed(2)} (mirror ${flip.toFixed(2)})`);
      });
      return report.join('; ') || 'no handwritten letters';
    }),
  );

  await check(`${w.word}: stroke widths of typed and handwritten letters are consistent`, () =>
    page.evaluate(() => {
      const { pieces, k } = window.__ahc.app.last;
      const hw = pieces.filter((p) => p.kind === 'handwritten').map((p) => p.strokeWidth / k);
      const ty = pieces.filter((p) => p.kind === 'typed').map((p) => p.strokeWidth / k);
      const all = [...hw, ...ty];
      const ratio = Math.max(...all) / Math.min(...all);
      if (ratio > 1.35) throw new Error(`stroke widths vary by ${ratio.toFixed(2)}×`);
      return `handwritten ${hw.map((v) => v.toFixed(2)).join('/')} px, typed ${ty.map((v) => v.toFixed(2)).join('/')} px`;
    }),
  );

  await check(`${w.word}: whole word fits the CAPTCHA frame without distortion`, () =>
    page.evaluate(() => {
      const { layout, fit } = window.__ahc.app.last;
      const c = document.getElementById('captcha-canvas');
      const x0 = fit.tx + layout.bounds.minX * fit.scale;
      const x1 = fit.tx + layout.bounds.maxX * fit.scale;
      const y0 = fit.ty + layout.bounds.minY * fit.scale;
      const y1 = fit.ty + layout.bounds.maxY * fit.scale;
      if (x0 < 0 || y0 < 0 || x1 > c.width || y1 > c.height) throw new Error('word exceeds canvas');
      return `uniform scale ${fit.scale.toFixed(2)}, ink ${Math.round(x1 - x0)}×${Math.round(y1 - y0)} px of ${c.width}×${c.height}`;
    }),
  );

  await check(`${w.word}: baseline alignment of connected groups`, () =>
    page.evaluate(() => {
      const { pieces, layout, k } = window.__ahc.app.last;
      return layout.groups
        .map((g) => {
          const dev = g.map((i) => (layout.placements[i].y + pieces[i].baseline) / k);
          const mean = dev.reduce((a, b) => a + b, 0) / dev.length;
          if (Math.abs(mean) > 0.01 && g.length > 1) throw new Error('group mean baseline not on shared baseline');
          return `[${dev.map((d) => d.toFixed(1)).join(', ')}]`;
        })
        .join(' ');
    }),
  );

  await check(`${w.word}: regenerate 5× (non-blank, background changes, letters unchanged)`, async () => {
    const hashes = [];
    for (let i = 0; i < 5; i++) {
      await page.click('#refresh-btn');
      hashes.push(await canvasHash(page));
      const ok = await page.evaluate(() => {
        const c = document.getElementById('captcha-canvas');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90) dark++;
        return dark;
      });
      assert(ok > 500, `render ${i} looks blank (${ok} ink pixels)`);
    }
    assert(new Set(hashes).size === 5, 'refresh did not change the image');
    const same = await page.evaluate(() => {
      const { engine, store, app } = window.__ahc;
      const a = document.createElement('canvas');
      const b = document.createElement('canvas');
      engine.render(a, { wordId: app.wordId, settings: store.get(), seed: 42, dpr: 2, setAnswer: false });
      engine.render(b, { wordId: app.wordId, settings: store.get(), seed: 42, dpr: 2, setAnswer: false });
      return a.toDataURL() === b.toDataURL();
    });
    assert(same, 'same seed did not reproduce the same image');
    return '5 distinct images, same seed reproducible';
  });

  // save renders for visual inspection
  for (const guides of [false, true]) {
    const png = await page.evaluate((guides) => {
      const { engine, store, app } = window.__ahc;
      const c = document.createElement('canvas');
      engine.render(c, { wordId: app.wordId, settings: { ...store.get(), showGuides: guides }, seed: 7, dpr: 2, setAnswer: false });
      return c.toDataURL('image/png').split(',')[1];
    }, guides);
    writeFileSync(`${OUT}render-${w.id}${guides ? '-guides' : ''}.png`, Buffer.from(png, 'base64'));
  }
}

console.log('\nD. Interface');
await check('verification: correct, wrong, empty and normalised answers', async () => {
  await page.click('[data-word="shabakat"]');
  const attempt = async (text) => {
    await page.fill('#answer-input', text);
    await page.click('#answer-form button[type="submit"]');
    return page.$eval('#status', (e) => e.className);
  };
  assert((await attempt('شبكات')).includes('status--success'), 'correct answer rejected');
  assert((await attempt('شبكة')).includes('status--error'), 'wrong answer accepted');
  assert((await attempt('')).includes('status--error'), 'empty answer accepted');
  assert((await attempt(' شَبكـات ')).includes('status--success'), 'diacritics/tatweel/space not normalised');
  return 'success / error / error / success';
});
await check('random mode: hidden word can be solved, answer not exposed beside the image', async () => {
  await page.click('[data-word="random"]');
  await page.click('#refresh-btn');
  const word = await page.evaluate(() => window.__ahc.engine.words.get(window.__ahc.app.wordId).word);
  const exposed = await page.evaluate((word) => {
    const stage = document.querySelector('.generator');
    const clone = stage.cloneNode(true);
    clone.querySelector('.word-picker').remove(); // the picker lists all words by design
    return clone.innerHTML.includes(word) || document.getElementById('captcha-canvas').getAttribute('aria-label').includes(word);
  }, word);
  assert(!exposed, 'answer text found in the generator markup');
  const lettersLocked = await page.$eval('#letters-root', (e) => !!e.querySelector('.letters-locked') && !e.querySelector('.letter-chip'));
  assert(lettersLocked, 'letter editor reveals the hidden word');
  await page.fill('#answer-input', word);
  await page.click('#answer-form button[type="submit"]');
  assert((await page.$eval('#status', (e) => e.className)).includes('success'), 'random word not verified');
  return `solved a hidden "${word}"`;
});
await check('word selection switches the rendered word', async () => {
  const seen = [];
  for (const w of words) {
    await page.click(`[data-word="${w.id}"]`);
    await page.waitForTimeout(80);
    seen.push(await page.evaluate(() => window.__ahc.app.last.plan.map((l) => l.char).join('')));
    assert((await page.getAttribute(`[data-word="${w.id}"]`, 'aria-checked')) === 'true', 'picker state');
  }
  assert(seen.join('|') === words.map((w) => w.word).join('|'), seen.join('|'));
  return seen.join(', ');
});
await check('every settings control changes the CAPTCHA preview', async () => {
  await page.click('[data-word="shabakat"]');
  const ids = await page.$$eval('#settings-root input[type=range], #settings-root select', (els) => els.map((e) => e.id));
  const changed = [];
  for (const id of ids) {
    const before = await canvasHash(page);
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el.tagName === 'SELECT') {
        el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const v = Number(el.value);
        const max = Number(el.max);
        const min = Number(el.min);
        el.value = String(v + (max - v > (max - min) / 4 ? (max - min) / 4 : -(max - min) / 4));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, id);
    const after = await canvasHash(page);
    assert(before !== after, `${id} did not change the image`);
    changed.push(id.replace('set-', ''));
  }
  await page.click('#reset-all');
  return changed.join(', ');
});
await check('guides toggle shows construction overlay and legend', async () => {
  const before = await canvasHash(page);
  await page.click('.stage-meta .switch');
  const after = await canvasHash(page);
  const legend = await page.$eval('#legend', (e) => !e.hidden);
  await page.screenshot({ path: `${OUT}desktop-guides.png` });
  await page.click('.stage-meta .switch');
  assert(before !== after && legend, 'guides not shown');
  return 'overlay + legend';
});
await check('per-letter character type, sample and scale controls', async () => {
  await page.click('[data-word="shabakat"]');
  await page.click('.letter-chip[data-index="1"]'); // medial ب
  await page.click('#letters-root .segmented button[data-style="handwritten"]');
  await settle(page);
  const b = await page.evaluate(() => window.__ahc.app.last.plan[1]);
  assert(b.style === 'handwritten' && b.sample.id === 'hw-06', 'ب not switched to hw-06');
  await page.click('.letter-chip[data-index="2"]'); // medial ك: no identified sample
  const disabled = await page.$eval('#letters-root .segmented button[data-style="handwritten"]', (e) => e.disabled);
  assert(disabled, 'handwritten allowed for ك without a sample');
  await page.click('.letter-chip[data-index="3"]'); // final ا: two samples
  const opts = await page.$$eval('#set-letter-sample option', (o) => o.map((x) => x.value));
  assert(opts.join() === 'hw-03,hw-12', `alif samples: ${opts}`);
  await page.selectOption('#set-letter-sample', 'hw-03');
  await settle(page);
  const a = await page.evaluate(() => window.__ahc.app.last.plan[3].sample.id);
  assert(a === 'hw-03', 'sample switch failed');
  const before = await canvasHash(page);
  await page.evaluate(() => {
    const el = document.getElementById('set-scale');
    el.value = '1.3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert(before !== (await canvasHash(page)), 'letter scale had no effect');
  await page.screenshot({ path: `${OUT}desktop-letter-edit.png`, fullPage: true });
  await page.click('.letter-reset');
  return 'ب → hw-06, ك typed-only, ا sample hw-03, scale 1.3';
});
await check('stroke matching button aligns typed and handwritten stroke widths', async () => {
  await page.click('#match-stroke');
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => window.__ahc.engine.measureStrokes(window.__ahc.store.get()));
  assert(Math.abs(m.typed - m.hand) / m.hand < 0.06, `hand ${m.hand} typed ${m.typed}`);
  const v = await page.evaluate(() => window.__ahc.store.get().typedStroke);
  await page.click('#reset-all');
  return `handwritten ${m.hand.toFixed(2)} px, typed ${m.typed.toFixed(2)} px (typed stroke ${v})`;
});
await check('gallery: 12 items with label, type and dimensions; preview opens and closes', async () => {
  const tiles = await page.$$eval('.tile', (t) => t.map((x) => x.innerText));
  assert(tiles.length === 12, `${tiles.length} tiles`);
  for (const text of tiles) assert(/\d+ × \d+ px/.test(text) && /Handwritten/.test(text), `tile text: ${text}`);
  await page.click('.tile[data-sample="hw-08"]');
  await page.waitForSelector('#preview-dialog[open]');
  const details = await page.$eval('#preview-content', (e) => e.innerText);
  assert(details.includes('ف') && details.includes('170 × 170'), 'details missing');
  await page.screenshot({ path: `${OUT}desktop-preview.png` });
  await page.click('#preview-close');
  assert(!(await page.$('#preview-dialog[open]')), 'dialog did not close');
  return `${tiles.filter((t) => t.includes('Unknown')).length} marked unknown`;
});
await check('desktop layout has no horizontal overflow', async () => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.click('[data-word="fahd"]');
  await page.screenshot({ path: `${OUT}desktop.png`, fullPage: true });
  assert(o <= 0, `overflow ${o}px`);
  return '1400×900';
});
await page.close();

const mobile = await openPage({ width: 390, height: 844, dsf: 2, name: 'mobile' });
await check('mobile layout (390 px): no horizontal overflow, controls usable', async () => {
  const o = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(o <= 0, `overflow ${o}px`);
  await mobile.click('[data-word="hasib"]');
  await mobile.fill('#answer-input', 'حاسب');
  await mobile.click('#answer-form button[type="submit"]');
  assert((await mobile.$eval('#status', (e) => e.className)).includes('success'), 'verify failed on mobile');
  const chipsOneRow = await mobile.$$eval('.letter-chip', (c) => new Set(c.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1);
  await mobile.screenshot({ path: `${OUT}mobile.png`, fullPage: true });
  return chipsOneRow ? 'letter chips on one row' : 'letter chips wrap';
});
await mobile.close();

const ar = await openPage({ name: 'arabic', query: 'debug&lang=ar' });
await check('Arabic interface switches to RTL', async () => {
  const dir = await ar.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
  assert(dir[0] === 'rtl' && dir[1] === 'ar', dir.join());
  await ar.click('[data-word="shabakat"]');
  const order = await ar.$$eval('.letter-chip', (c) => c.map((x) => [x.dataset.index, x.getBoundingClientRect().left]));
  assert(order.every((x, i) => i === 0 || x[1] < order[i - 1][1]), 'letter chips not right-to-left');
  await ar.screenshot({ path: `${OUT}arabic.png`, fullPage: true });
  await ar.click('#lang-toggle');
  const back = await ar.evaluate(() => document.documentElement.dir);
  assert(back === 'ltr', 'toggle back failed');
  return 'dir=rtl, chips right-to-left, toggles back to ltr';
});
await ar.close();

const clean = await openPage({ name: 'clean-session', query: '', strict: true });
await check('clean session: normal use through the UI only (words, refresh, settings, letters, gallery, language)', async () => {
  for (const w of words) {
    await clean.click(`[data-word="${w.id}"]`);
    await clean.click('#refresh-btn');
    await clean.click('.letter-chip[data-index="1"]');
  }
  await clean.click('#letters-root .segmented button[data-style="typed"]');
  await clean.fill('#set-overlap', '4');
  await clean.selectOption('#set-background', 'ruled');
  await clean.click('#match-stroke');
  await clean.click('.stage-meta .switch');
  await clean.click('.tile[data-sample="hw-01"]');
  await clean.click('#preview-close');
  await clean.click('#lang-toggle');
  await clean.click('[data-word="random"]');
  await clean.fill('#answer-input', 'خطأ');
  await clean.click('#answer-form button[type="submit"]');
  await clean.waitForTimeout(600);
  return 'completed without page errors';
});
await clean.close();

console.log('\nE. Deployment');
await check('sub-path deployment: every request resolved (no 404s or failed loads)', () => {
  if (problems.network.length) throw new Error(problems.network.join('\n      '));
  return `served from ${BASE}`;
});
await check('no JavaScript errors or console warnings', () => {
  if (problems.console.length) throw new Error(problems.console.join('\n      '));
  return 'console clean';
});
await check('debug hook is absent without ?debug', async () => {
  const p = await openPage({ query: '', name: 'nodebug' });
  const hook = await p.evaluate(() => typeof window.__ahc);
  await p.close();
  assert(hook === 'undefined', 'debug hook exposed');
  return 'window.__ahc undefined';
});

await browser.close();
server.close();

const failed = results.filter((r) => r.status === 'fail');
writeFileSync(`${OUT}report.json`, JSON.stringify({ date: new Date().toISOString(), base: BASE, results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Report: tests/e2e/output/report.json\n`);
process.exit(failed.length ? 1 : 0);
