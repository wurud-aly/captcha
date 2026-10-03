/**
 * CAPTCHA engine: loads assets, builds letter pieces, runs the composer and
 * paints the final image onto a canvas. Verification is local (prototype).
 *
 * Pipeline per render:
 *   word config ──resolve──▶ plan (form, style, sample per letter)
 *   plan ──GlyphFactory──▶ pieces (raster + metrics)
 *   pieces ──composeWord──▶ layout (RTL placement, joins)
 *   background → pieces → effects (future distortion) → optional guides
 */
import { GlyphFactory, defaultCreateCanvas } from './glyph-factory.js';
import { composeWord, fitToFrame } from './arabic-composer.js';
import { paintBackground, mulberry32 } from './backgrounds.js';
import { applyEffects } from './effects.js';

export class CaptchaEngine {
  /**
   * @param {{letters:import('./letter-database.js').LetterDatabase,
   *          words:import('./word-database.js').WordDatabase,
   *          composition:object, baseUrl?:string,
   *          imageUrl?:(sample:object) => string}} deps
   *   imageUrl: optional hook that maps a sample to the URL of its image
   *             (the admin dashboard uses it to preview unsaved uploads).
   */
  constructor({ letters, words, composition, baseUrl = document.baseURI, imageUrl = null }) {
    this.letters = letters;
    this.words = words;
    this.composition = composition;
    this.baseUrl = baseUrl;
    this.imageUrl = imageUrl || ((s) => new URL(s.file, this.baseUrl).href);
    this.factory = new GlyphFactory(composition);
    this.images = new Map();
    this.fontReady = false;
    let answer = null; // kept in a closure, never written to the DOM
    this._setAnswer = (w) => {
      answer = w;
    };
    this._check = (input) => answer !== null && normalizeAnswer(input) === normalizeAnswer(answer);
  }

  /** Load the local Cairo Light font and every handwritten image. */
  async load() {
    const t = this.composition.typed;
    const url = new URL(t.fontFile, this.baseUrl).href;
    const face = new FontFace(t.fontFamily, `url("${url}")`, { weight: String(t.fontWeight || 300) });
    await face.load();
    document.fonts.add(face);
    this.fontReady = document.fonts.check(`${t.fontWeight || 300} 40px "${t.fontFamily}"`, 'شبكات');
    if (!this.fontReady) throw new Error(`Font "${t.fontFamily}" did not load`);
    await this.syncImages();
  }

  /** Load images that are missing or whose file changed; drop removed samples. */
  async syncImages() {
    const ids = new Set();
    await Promise.all(
      this.letters.all().map(async (s) => {
        ids.add(s.id);
        const src = this.imageUrl(s);
        const cached = this.images.get(s.id);
        if (cached && cached.src === src) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        await img.decode().catch(() => {
          throw new Error(`Image failed to load: ${s.file}`);
        });
        if (img.naturalWidth !== s.image.width || img.naturalHeight !== s.image.height) {
          console.warn(`[engine] ${s.id}: image is ${img.naturalWidth}×${img.naturalHeight}, letters.json says ${s.image.width}×${s.image.height}`);
        }
        this.images.set(s.id, img);
      }),
    );
    for (const id of [...this.images.keys()]) if (!ids.has(id)) this.images.delete(id);
  }

  /**
   * Swap in new configuration (used by the admin live preview). The font and
   * unchanged images are reused; rendered letter pieces are rebuilt.
   */
  async setData({ letters, words, composition }) {
    if (letters) this.letters = letters;
    if (words) this.words = words;
    if (composition) {
      this.composition = composition;
      this.factory.composition = composition;
    }
    this.factory.clear();
    await this.syncImages();
  }

  imageFor(sampleId) {
    return this.images.get(sampleId) || null;
  }

  /** Per-letter plan for a word given the current experiment settings. */
  plan(wordId, settings) {
    return this.words.resolve(wordId, settings.characters?.[wordId] || {});
  }

  /**
   * Build the piece for one planned letter.
   * @param {object} letter plan entry
   * @param {object} settings experiment settings
   * @param {number} k output px per logical px (size × device pixel ratio)
   */
  buildPiece(letter, settings, k) {
    const C = this.composition;
    const ink = C.render?.inkColor || '#1d2430';
    let piece;
    if (letter.style === 'handwritten' && letter.sample) {
      const s = letter.sample;
      const scale = k * (C.handwritten?.scale ?? 1) * s.adjust.scale * letter.adjust.scale;
      const thickness = (settings.handStroke + s.adjust.thickness + letter.adjust.thickness) * k;
      piece = this.factory.handwritten(s, this.imageFor(s.id), scale, { thickness, inkColor: ink });
      piece = { ...piece, offsetX: (s.adjust.offsetX * scale) + letter.adjust.offsetX * k, offsetY: (s.adjust.offsetY * scale) + letter.adjust.offsetY * k };
    } else {
      const size = C.typed.fontSize * letter.adjust.scale * k;
      const thickness = (settings.typedStroke + letter.adjust.thickness) * k;
      piece = this.factory.typed(letter.char, letter.form, size, { thickness, inkColor: ink });
      piece = { ...piece, offsetX: letter.adjust.offsetX * k, offsetY: letter.adjust.offsetY * k };
    }
    return { ...piece, char: letter.char, form: letter.form, joinsPrev: letter.joinsPrev, joinsNext: letter.joinsNext };
  }

  /**
   * Render a word to a canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {{wordId:string, settings:object, seed?:number, dpr?:number, setAnswer?:boolean}} opts
   */
  render(canvas, { wordId, settings, seed = 1, dpr = 1, setAnswer = true }) {
    const C = this.composition;
    const W = Math.round(C.canvas.width * dpr);
    const H = Math.round(C.canvas.height * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');

    const k = settings.size * dpr;
    const plan = this.plan(wordId, settings);
    const pieces = plan.map((l) => this.buildPiece(l, settings, k));
    const layout = composeWord(pieces, {
      overlap: settings.overlap * k,
      spacing: settings.spacing * k,
      baselineMode: settings.baselineMode,
    });
    const fit = fitToFrame(layout.bounds, { width: W, height: H, padding: C.canvas.padding * dpr }, settings.verticalOffset * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    paintBackground(settings.background, ctx, W, H, seed, dpr);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    pieces.forEach((p, i) => {
      const pos = layout.placements[i];
      ctx.drawImage(p.canvas, fit.tx + pos.x * fit.scale, fit.ty + pos.y * fit.scale, p.width * fit.scale, p.height * fit.scale);
    });

    applyEffects(C.render?.effects, { ctx, width: W, height: H, rng: mulberry32(seed ^ 0x9e3779b9), layout, fit });

    if (settings.showGuides) drawGuides(ctx, pieces, layout, fit, dpr, C.render?.guides || {});
    if (setAnswer) this._setAnswer(this.words.get(wordId).word);

    return { plan, pieces, layout, fit, k, dpr };
  }

  verify(input) {
    return this._check(input);
  }

  /**
   * Median stroke widths (logical px at size 1) of every identified handwritten
   * sample and of every typed letter form used by the word list, for the
   * current stroke settings.
   */
  measureStrokes(settings, typedStroke = settings.typedStroke) {
    const k = 2; // measure at 2× for sub-pixel accuracy
    const C = this.composition;
    const hand = this.letters
      .all()
      .filter((s) => this.letters.isUsable(s))
      .map((s) => {
        const scale = k * (C.handwritten?.scale ?? 1) * s.adjust.scale;
        const th = (settings.handStroke + s.adjust.thickness) * k;
        return this.factory.handwritten(s, this.imageFor(s.id), scale, { thickness: th, inkColor: '#000000' }).strokeWidth / k;
      });
    const forms = new Map();
    for (const w of this.words.all()) for (const l of this.words.resolve(w.id)) forms.set(`${l.char}|${l.form}`, l);
    const typed = [...forms.values()].map(
      (l) => this.factory.typed(l.char, l.form, C.typed.fontSize * k, { thickness: typedStroke * k, inkColor: '#000000' }).strokeWidth / k,
    );
    return { hand: median(hand), typed: median(typed) };
  }

  /** Typed stroke adjustment that makes typed strokes match the handwriting. */
  recommendTypedStroke(settings) {
    const { hand, typed } = this.measureStrokes(settings, 0);
    let rec = hand - typed;
    // one correction step: outline thinning is not perfectly linear
    const after = this.measureStrokes(settings, rec).typed;
    rec += hand - after;
    return rec;
  }

  clearCache() {
    this.factory.clear();
  }
}

/** Normalise user input: trim, drop spaces/tatweel/harakat, unify alef forms. */
export function normalizeAnswer(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[\sـ‌‍ً-ٰٟ]/g, '')
    .replace(/[أإآٱ]/g, 'ا');
}

function median(values) {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function drawGuides(ctx, pieces, layout, fit, dpr, colors) {
  const tx = (x) => fit.tx + x * fit.scale;
  const ty = (y) => fit.ty + y * fit.scale;
  ctx.save();
  ctx.lineWidth = 1 * dpr;
  // shared baseline
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.strokeStyle = colors.baseline || 'rgba(220,60,60,.6)';
  ctx.beginPath();
  ctx.moveTo(tx(layout.bounds.minX) - 12 * dpr, ty(0));
  ctx.lineTo(tx(layout.bounds.maxX) + 12 * dpr, ty(0));
  ctx.stroke();
  ctx.setLineDash([]);
  pieces.forEach((p, i) => {
    const pos = layout.placements[i];
    ctx.strokeStyle = p.kind === 'handwritten' ? colors.handwritten || '#18a091' : colors.typed || '#d29a2a';
    ctx.strokeRect(tx(pos.x + p.inkBox.x), ty(pos.y + p.inkBox.y), p.inkBox.w * fit.scale, p.inkBox.h * fit.scale);
    for (const [a, c] of [[p.entry, colors.entry || '#2f6fdd'], [p.exit, colors.exit || '#c2410c']]) {
      if (!a) continue;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(tx(pos.x + a.x), ty(pos.y + a.y), 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

export { defaultCreateCanvas };
