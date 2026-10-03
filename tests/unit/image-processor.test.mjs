import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dilate,
  erode,
  adjustThickness,
  crispen,
  inkBox,
  inkSum,
  estimateStrokeWidth,
  detectAnchors,
  inkFromRGBA,
} from '../../src/scripts/image-processor.js';

const W = 80;
const H = 60;
function canvasWith(draw) {
  const ink = new Float32Array(W * H);
  draw((x, y, v = 1) => {
    if (x >= 0 && y >= 0 && x < W && y < H) ink[y * W + x] = v;
  });
  return ink;
}
// horizontal stroke 4 px thick on rows 40..43, x 10..69, plus a 3×3 "dot" at (30,20)
const sample = () =>
  canvasWith((set) => {
    for (let y = 40; y < 44; y++) for (let x = 10; x < 70; x++) set(x, y);
    for (let y = 20; y < 23; y++) for (let x = 30; x < 33; x++) set(x, y);
  });

// anti-aliased straight stroke of width `w` at angle `deg` (8× supersampled)
function stroke(w, deg, size = 120) {
  const ink = new Float32Array(size * size);
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) {
          const px = x + (i + 0.5) / 8 - size / 2;
          const py = y + (j + 0.5) / 8 - size / 2;
          if (Math.abs(-px * s + py * c) <= w / 2 && Math.abs(px * c + py * s) <= size * 0.4) v++;
        }
      ink[y * size + x] = v / 64;
    }
  return ink;
}

test('stroke width estimate is accurate and independent of stroke direction', () => {
  for (const w of [3, 4, 6]) {
    for (const deg of [0, 30, 45, 90]) {
      const est = estimateStrokeWidth(stroke(w, deg), 120, 120);
      assert.ok(Math.abs(est - w) / w < 0.06, `w=${w} deg=${deg} estimated ${est.toFixed(2)}`);
    }
  }
});

test('dilate thickens, erode thins, both monotonic', () => {
  const ink = sample();
  const d = dilate(ink, W, H, 1);
  const e = erode(ink, W, H, 1);
  assert.ok(inkSum(d) > inkSum(ink));
  assert.ok(inkSum(e) < inkSum(ink));
  for (let i = 0; i < ink.length; i++) assert.ok(d[i] >= ink[i] && e[i] <= ink[i]);
});

test('thinning is capped so dots and thin strokes survive', () => {
  const ink = sample();
  const thin = adjustThickness(ink, W, H, -10); // absurd request
  assert.ok(thin[21 * W + 31] > 0.5, 'dot centre kept');
  assert.ok(thin[41 * W + 40] > 0.5, 'stroke centre kept');
});

test('crispen keeps every component (dots are not removed)', () => {
  const ink = sample().map((v) => v * 0.8); // soft, scaled-looking ink
  const c = crispen(ink, 1);
  assert.ok(c[21 * W + 31] > 0.9);
  assert.deepEqual(inkBox(c, W, H), inkBox(ink, W, H));
});

test('ink box covers the dot as well as the main stroke', () => {
  assert.deepEqual(inkBox(sample(), W, H), { x: 10, y: 20, w: 60, h: 24 });
});

test('anchors are found on the baseline stroke, ignoring parts outside the band', () => {
  const ink = canvasWith((set) => {
    for (let y = 40; y < 44; y++) for (let x = 10; x < 70; x++) set(x, y);
    for (let y = 5; y < 8; y++) for (let x = 2; x < 78; x++) set(x, y); // arm sticking out above
  });
  const { entry, exit } = detectAnchors(ink, W, H, { baseline: 42, bandUp: 8, bandDown: 4 });
  assert.deepEqual(exit, { x: 10, y: 42 });
  assert.deepEqual(entry, { x: 70, y: 42 });
});

test('transparent PNG pixels: coverage follows alpha of dark ink only', () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 128, 255, 255, 255, 255, 0, 0, 0, 0]);
  const ink = inkFromRGBA(rgba);
  assert.ok(Math.abs(ink[0] - 1) < 1e-6);
  assert.ok(Math.abs(ink[1] - 128 / 255) < 1e-6);
  assert.equal(ink[2], 0); // white opaque pixel is paper, not ink
  assert.equal(ink[3], 0);
});

test('opaque scans: white paper is not ink, black is', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const ink = inkFromRGBA(rgba);
  assert.equal(ink[0], 0);
  assert.equal(ink[1], 1);
});
