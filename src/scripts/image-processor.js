/**
 * Image processing for letter rasters.
 *
 * Everything works on an "ink mask": a Float32Array of coverage values in [0,1],
 * one per pixel. The original PNG files are never modified; processing happens
 * on in-memory copies and every operation is optional and parameterised.
 *
 * Pure functions (testable in Node):
 *   inkFromRGBA, adjustThickness, dilate, erode, crispen, inkBox, inkSum,
 *   estimateStrokeWidth, detectAnchors
 * Canvas helpers (browser only):
 *   readInk, inkToCanvas
 */

/**
 * Convert RGBA pixels to ink coverage.
 *  - transparent PNG (like the supplied letters): coverage = alpha × darkness
 *  - opaque scan on white paper: coverage from luminance with soft levels
 * @param {Uint8ClampedArray} rgba
 */
export function inkFromRGBA(rgba, { mode = 'auto', paperLevel = 0.85, inkLevel = 0.25 } = {}) {
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  let transparent = false;
  if (mode === 'auto') {
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] < 250) {
        transparent = true;
        break;
      }
    }
  } else {
    transparent = mode === 'alpha';
  }
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const a = rgba[i * 4 + 3] / 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (transparent) {
      out[i] = a * clamp01((1 - lum) / 0.7);
    } else {
      out[i] = clamp01((paperLevel - lum) / (paperLevel - inkLevel));
    }
  }
  return out;
}

/** Anti-aliased grey-scale dilation with a disk of (fractional) radius r, in pixels. */
export function dilate(ink, w, h, r) {
  if (r <= 0) return ink.slice();
  const R = Math.ceil(r);
  const offsets = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      // centre always counts; a neighbour at distance d contributes the part of
      // the radius that reaches past it (r = 0.5 adds a half-covered 1 px ring)
      const d = Math.hypot(dx, dy);
      const wgt = d === 0 ? 1 : clamp01(r + 1 - d);
      if (wgt > 0) offsets.push(dx, dy, wgt);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = 0; k < offsets.length; k += 3) {
        const xx = x + offsets[k];
        const yy = y + offsets[k + 1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const v = ink[yy * w + xx] * offsets[k + 2];
        if (v > m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

export function erode(ink, w, h, r) {
  if (r <= 0) return ink.slice();
  const inv = ink.map((v) => 1 - v);
  return dilate(inv, w, h, r).map((v) => 1 - v);
}

/**
 * Change stroke thickness by `delta` pixels (total width change).
 * Positive -> thicker (dilate by delta/2), negative -> thinner (erode).
 * Erosion is limited to `maxErode` so thin pen strokes and dots never vanish.
 */
export function adjustThickness(ink, w, h, delta, { maxErode = 0.8 } = {}) {
  if (!delta) return ink;
  if (delta > 0) return dilate(ink, w, h, delta / 2);
  return erode(ink, w, h, Math.min(maxErode, -delta / 2));
}

/**
 * Sharpen soft edges produced by up-scaling. amount 0 = unchanged, 1 = strong.
 * A linear contrast stretch on coverage: shapes and dots are kept, only the
 * anti-aliasing ramp gets shorter.
 */
export function crispen(ink, amount) {
  if (!amount) return ink;
  const lo = 0.3 * amount;
  const hi = 1 - 0.3 * amount;
  const out = new Float32Array(ink.length);
  for (let i = 0; i < ink.length; i++) out[i] = clamp01((ink[i] - lo) / (hi - lo));
  return out;
}

export function inkBox(ink, w, h, threshold = 0.02) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ink[y * w + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function inkSum(ink) {
  let s = 0;
  for (let i = 0; i < ink.length; i++) s += ink[i];
  return s;
}

/**
 * Stroke width estimate: 2 × inkArea / perimeter, where the perimeter is the
 * integrated gradient magnitude (Sobel) of the anti-aliased coverage map.
 * Unlike pixel-edge counting this is orientation independent, so straight
 * typed strokes and curved handwritten strokes are measured on the same scale
 * (≈3 % error for strokes ≥ 3 px; slight under-estimate from stroke end caps).
 * Same formula as tools/analyze_letters.py.
 */
export function estimateStrokeWidth(ink, w, h) {
  let area = 0;
  let grad = 0;
  const f = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : ink[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ink[y * w + x];
      area += v;
      const gx = (f(x + 1, y - 1) + 2 * f(x + 1, y) + f(x + 1, y + 1) - f(x - 1, y - 1) - 2 * f(x - 1, y) - f(x - 1, y + 1)) / 8;
      const gy = (f(x - 1, y + 1) + 2 * f(x, y + 1) + f(x + 1, y + 1) - f(x - 1, y - 1) - 2 * f(x, y - 1) - f(x + 1, y - 1)) / 8;
      grad += Math.hypot(gx, gy);
    }
  }
  return grad > 0 ? (2 * area) / grad : 0;
}

/**
 * Find connection points on a letter raster: the right-most (entry) and
 * left-most (exit) ink inside a horizontal band around the baseline.
 * Restricting to the band ignores dots, kāf arms and other parts that stick
 * out sideways above or below the connecting stroke.
 */
export function detectAnchors(ink, w, h, { baseline, bandUp, bandDown, threshold = 0.35 }) {
  const y0 = Math.max(0, Math.floor(baseline - bandUp));
  const y1 = Math.min(h - 1, Math.ceil(baseline + bandDown));
  const columnHit = (x) => {
    let sum = 0;
    let wy = 0;
    for (let y = y0; y <= y1; y++) {
      const v = ink[y * w + x];
      if (v > threshold) {
        sum += v;
        wy += v * (y + 0.5);
      }
    }
    return sum > 0 ? wy / sum : null;
  };
  let entry = null;
  for (let x = w - 1; x >= 0; x--) {
    const y = columnHit(x);
    if (y !== null) {
      entry = { x: x + 1, y };
      break;
    }
  }
  let exit = null;
  for (let x = 0; x < w; x++) {
    const y = columnHit(x);
    if (y !== null) {
      exit = { x, y };
      break;
    }
  }
  return { entry, exit };
}

/* ---------------- canvas helpers (browser) ---------------- */

export function readInk(canvas, options) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return inkFromRGBA(data, options);
}

/** Paint an ink mask in a single colour onto a new canvas (transparent background). */
export function inkToCanvas(ink, w, h, color, createCanvas) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const [r, g, b] = parseColor(color);
  for (let i = 0; i < ink.length; i++) {
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(clamp01(ink[i]) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function parseColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [20, 24, 32];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Suggest baseline and connection points for a NEW letter image (used by the
 * admin dashboard when a sample is uploaded; the owner can then correct them).
 * Uses the largest ink component (ignores dots): its left-most point is the
 * exit, its right-most point the entry. The baseline is the mean of the
 * connection heights, or the lower part of the body for isolated letters.
 * @returns {{baseline:number, entry:{x:number,y:number}|null, exit:{x:number,y:number}|null}}
 */
export function suggestAnchors(ink, w, h, form, threshold = 0.15) {
  const label = new Int32Array(w * h).fill(-1);
  let best = { size: 0, pixels: null };
  for (let i = 0; i < ink.length; i++) {
    if (label[i] !== -1 || ink[i] <= threshold) continue;
    const pixels = [];
    const stack = [i];
    label[i] = i;
    while (stack.length) {
      const p = stack.pop();
      pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (label[q] === -1 && ink[q] > threshold) {
            label[q] = i;
            stack.push(q);
          }
        }
      }
    }
    if (pixels.length > best.size) best = { size: pixels.length, pixels };
  }
  if (!best.pixels) return { baseline: h / 2, entry: null, exit: null };
  let minX = w;
  let maxX = -1;
  let maxY = -1;
  for (const p of best.pixels) {
    const x = p % w;
    const y = (p / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const meanY = (pred) => {
    let s = 0;
    let n = 0;
    for (const p of best.pixels) {
      if (pred(p % w)) {
        s += (p / w) | 0;
        n++;
      }
    }
    return Math.round((s / n) * 10) / 10;
  };
  const exit = { x: minX, y: meanY((x) => x <= minX + 1) };
  const entry = { x: maxX, y: meanY((x) => x >= maxX - 1) };
  const wantsEntry = form === 'medial' || form === 'final';
  const wantsExit = form === 'medial' || form === 'initial';
  const ys = [wantsEntry ? entry.y : null, wantsExit ? exit.y : null].filter((v) => v !== null);
  const baseline = ys.length ? Math.round((ys.reduce((a, b) => a + b, 0) / ys.length) * 10) / 10 : Math.round(maxY - 4);
  return { baseline, entry: wantsEntry ? entry : null, exit: wantsExit ? exit : null };
}
