/**
 * Glyph factory: turns one letter into a "piece" (raster + metrics) for the
 * composer. Handwritten pieces come from the original images; typed pieces are
 * shaped with Cairo Light in the required contextual form.
 *
 * All pieces leave this module in the same shape so the composer never needs
 * to know where a letter came from.
 */
import { shapingText } from './arabic-joining.js';
import {
  readInk,
  inkToCanvas,
  adjustThickness,
  crispen,
  inkBox,
  inkSum,
  estimateStrokeWidth,
  detectAnchors,
} from './image-processor.js';

export const defaultCreateCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

export class GlyphFactory {
  /**
   * @param {object} composition parsed composition.json
   * @param {{createCanvas?:Function}} [opts]
   */
  constructor(composition, { createCanvas = defaultCreateCanvas } = {}) {
    this.composition = composition;
    this.createCanvas = createCanvas;
    this.cache = new Map();
  }

  /**
   * @param {object} sample  letter-database sample
   * @param {HTMLImageElement|ImageBitmap} image  the original image
   * @param {number} scale   original px -> output px
   * @param {{thickness:number, inkColor:string}} opts thickness in output px
   */
  handwritten(sample, image, scale, { thickness = 0, inkColor }) {
    const key = `h|${sample.id}|${scale.toFixed(4)}|${thickness.toFixed(2)}|${inkColor}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const pad = Math.ceil(Math.abs(thickness)) + 3;
    const w = Math.ceil(sample.image.width * scale) + 2 * pad;
    const h = Math.ceil(sample.image.height * scale) + 2 * pad;
    const raster = this.createCanvas(w, h);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Uniform scale only: no rotation, no mirroring, no aspect change.
    ctx.drawImage(image, pad, pad, sample.image.width * scale, sample.image.height * scale);

    let ink = readInk(raster);
    const original = inkSum(ink);
    // Up-scaling softens edges; restore some crispness proportionally.
    const crisp = this.composition.handwritten?.edgeCrispness ?? 0;
    if (scale > 1 && crisp > 0) ink = crispen(ink, Math.min(1, crisp * (scale - 1)));
    ink = adjustThickness(ink, w, h, thickness);

    const map = (pt) => (pt ? { x: pad + pt.x * scale, y: pad + pt.y * scale } : null);
    const piece = {
      kind: 'handwritten',
      sampleId: sample.id,
      scale, // original px -> raster px
      pad, // transparent margin around the scaled image
      canvas: inkToCanvas(ink, w, h, inkColor, this.createCanvas),
      width: w,
      height: h,
      inkBox: inkBox(ink, w, h),
      baseline: pad + sample.baseline * scale,
      entry: map(sample.anchors.entry),
      exit: map(sample.anchors.exit),
      strokeWidth: estimateStrokeWidth(ink, w, h),
      inkCoverage: inkSum(ink),
      sourceCoverage: original,
    };
    this.remember(key, piece);
    return piece;
  }

  /**
   * @param {string} char
   * @param {string} form isolated|initial|medial|final
   * @param {number} fontSize output px
   * @param {{thickness:number, inkColor:string}} opts thickness in output px
   */
  typed(char, form, fontSize, { thickness = 0, inkColor }) {
    const t = this.composition.typed;
    const key = `t|${char}|${form}|${fontSize.toFixed(3)}|${thickness.toFixed(2)}|${inkColor}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const text = shapingText(char, form);
    const font = `${t.fontWeight || 300} ${fontSize}px "${t.fontFamily}"`;
    const probe = this.createCanvas(4, 4).getContext('2d');
    probe.font = font;
    probe.direction = 'rtl';
    probe.textAlign = 'left'; // must match the drawing call below
    probe.textBaseline = 'alphabetic';
    const m = probe.measureText(text);

    const grow = Math.max(0, thickness);
    const pad = Math.ceil(grow) + 4;
    const left = Math.ceil(m.actualBoundingBoxLeft);
    const right = Math.ceil(m.actualBoundingBoxRight);
    const asc = Math.ceil(m.actualBoundingBoxAscent);
    const desc = Math.ceil(m.actualBoundingBoxDescent);
    const w = left + right + 2 * pad;
    const h = asc + desc + 2 * pad;
    const raster = this.createCanvas(w, h);
    const ctx = raster.getContext('2d', { willReadFrequently: true });
    ctx.font = font;
    ctx.direction = 'rtl';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    const ox = pad + left;
    const oy = pad + asc;
    ctx.fillText(text, ox, oy);
    if (thickness !== 0) {
      // Vector stroke-width change along the glyph outline:
      //   thicker: paint an outline stroke of width |t|  (adds |t|/2 per side)
      //   thinner: erase an outline stroke of width |t|  (removes |t|/2 per side)
      // Thinning is capped so the thinnest parts of the glyph survive.
      const maxThin = fontSize * (t.maxThinning ?? 0.035);
      ctx.save();
      ctx.globalCompositeOperation = thickness > 0 ? 'source-over' : 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.lineJoin = 'round';
      ctx.lineWidth = thickness > 0 ? thickness : Math.min(-thickness, maxThin);
      ctx.strokeText(text, ox, oy);
      ctx.restore();
    }

    const ink = readInk(raster, { mode: 'alpha' });

    const anchors = detectAnchors(ink, w, h, {
      baseline: oy,
      bandUp: fontSize * (t.anchorBand?.up ?? 0.2),
      bandDown: fontSize * (t.anchorBand?.down ?? 0.06),
    });
    const piece = {
      kind: 'typed',
      canvas: inkToCanvas(ink, w, h, inkColor, this.createCanvas),
      width: w,
      height: h,
      inkBox: inkBox(ink, w, h),
      baseline: oy,
      entry: form === 'medial' || form === 'final' ? anchors.entry : null,
      exit: form === 'medial' || form === 'initial' ? anchors.exit : null,
      strokeWidth: estimateStrokeWidth(ink, w, h),
      inkCoverage: inkSum(ink),
    };
    this.remember(key, piece);
    return piece;
  }

  /** Small bounded cache: slider drags create many variants. */
  remember(key, piece) {
    this.cache.set(key, piece);
    if (this.cache.size > 240) this.cache.delete(this.cache.keys().next().value);
  }

  clear() {
    this.cache.clear();
  }
}
