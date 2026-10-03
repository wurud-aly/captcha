/**
 * Live preview: the REAL public CAPTCHA engine fed with draft data, so what the
 * dashboard shows is exactly what the public site will render after saving.
 */
import { CaptchaEngine } from '../../src/scripts/captcha-engine.js';
import { LetterDatabase } from '../../src/scripts/letter-database.js';
import { WordDatabase } from '../../src/scripts/word-database.js';
import { defaultSettings } from '../../src/scripts/settings.js';

export const SITE_BASE = new URL('/', location.href).href;

export class LivePreview {
  /**
   * @param {() => object} getState returns {letters, words, composition}
   * @param {Map} images draft image map (pending refs -> {url})
   */
  constructor(getState, images = new Map()) {
    this.getState = getState;
    this.images = images;
    this.error = null;
    this.pending = null;
    this.version = 0;
    const s = getState();
    const letters = new LetterDatabase(s.letters);
    this.engine = new CaptchaEngine({
      letters,
      words: new WordDatabase(s.words, letters),
      composition: structuredClone(s.composition),
      baseUrl: SITE_BASE,
      imageUrl: (sample) => this.urlFor(sample),
    });
  }

  urlFor(sample) {
    if (sample.file.startsWith('pending:')) return this.images.get(sample.file)?.url || '';
    return new URL(sample.file, SITE_BASE).href;
  }

  async init() {
    await this.engine.load();
  }

  /** Push the latest state into the engine (coalesced). Resolves when images are ready. */
  sync() {
    const v = ++this.version;
    const run = async () => {
      if (v !== this.version) return;
      const s = this.getState();
      try {
        const letters = new LetterDatabase(s.letters);
        const words = new WordDatabase(s.words, letters);
        await this.engine.setData({ letters, words, composition: structuredClone(s.composition) });
        this.error = null;
      } catch (e) {
        this.error = e;
      }
    };
    this.pending = (this.pending || Promise.resolve()).then(run, run);
    return this.pending;
  }

  settings({ guides = false } = {}) {
    return { ...defaultSettings(this.getState().composition), showGuides: guides };
  }

  /** Render one word; returns the engine result or null when the word does not exist. */
  render(canvas, wordId, { guides = false, seed = 7, dpr = Math.min(2, window.devicePixelRatio || 1), setAnswer = false } = {}) {
    if (!this.engine.words.get(wordId)) return null;
    return this.engine.render(canvas, { wordId, settings: this.settings({ guides }), seed, dpr, setAnswer });
  }

  /** Words whose current plan uses a given sample. */
  wordsUsing(sampleId) {
    const out = [];
    for (const w of this.engine.words.all()) {
      try {
        if (this.engine.words.resolve(w.id).some((l) => l.sample?.id === sampleId)) out.push(w);
      } catch {
        /* invalid word in draft */
      }
    }
    return out;
  }
}
