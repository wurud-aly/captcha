/**
 * Word configuration (pure, no DOM).
 *
 * Wraps src/data/words.json and resolves a word into a render plan:
 * for every letter -> contextual form, writing style and handwritten sample.
 * New words are added in JSON only.
 */
import { analyzeWord } from './arabic-joining.js';

export class WordDatabase {
  /**
   * @param {object} data parsed words.json
   * @param {import('./letter-database.js').LetterDatabase} letters
   */
  constructor(data, letters) {
    if (!data || !Array.isArray(data.words)) throw new Error('words.json: "words" array missing');
    this.letters = letters;
    this.words = data.words;
    this.byId = new Map(this.words.map((w) => [w.id, w]));
  }

  all() {
    return this.words;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  ids() {
    return this.words.map((w) => w.id);
  }

  /**
   * Resolve a word into per-letter render instructions.
   * @param {string} wordId
   * @param {Record<number, {style?:string, sample?:string, scale?:number, offsetX?:number, offsetY?:number}>} overrides
   *        per-letter overrides from the experiment settings panel
   */
  resolve(wordId, overrides = {}) {
    const word = this.get(wordId);
    if (!word) throw new Error(`Unknown word id "${wordId}"`);
    const analysis = analyzeWord(word.word);
    const config = word.characters || [];

    return analysis.map((letter) => {
      const cfg = config[letter.index] || {};
      const ov = overrides[letter.index] || {};
      const candidates = this.letters.find({ character: letter.char, form: letter.form });
      const requestedStyle = ov.style || cfg.style || 'typed';
      const requestedSample = ov.sample || cfg.sample || null;

      let style = requestedStyle;
      let sample = null;
      let warning = null;

      if (style === 'handwritten') {
        sample = requestedSample ? this.letters.get(requestedSample) : candidates[0] || null;
        if (sample && !candidates.includes(sample)) {
          warning = `Sample ${sample.id} is not a usable ${letter.form} "${letter.char}"`;
          sample = null;
        }
        if (!sample) {
          warning ||= `No handwritten ${letter.form} sample for "${letter.char}"`;
          style = 'typed';
        }
      }

      return {
        index: letter.index,
        char: letter.char,
        marks: letter.marks,
        form: letter.form,
        joinsPrev: letter.joinsPrev,
        joinsNext: letter.joinsNext,
        style,
        sample,
        handwrittenOptions: candidates,
        warning,
        adjust: {
          scale: num(ov.scale, cfg.adjust?.scale, 1),
          offsetX: num(ov.offsetX, cfg.adjust?.offsetX, 0),
          offsetY: num(ov.offsetY, cfg.adjust?.offsetY, 0),
          thickness: num(ov.thickness, cfg.adjust?.thickness, 0),
        },
      };
    });
  }

  /** Check every word against the joining rules and the letter database. */
  validate() {
    const problems = [];
    for (const w of this.words) {
      const analysis = analyzeWord(w.word);
      const chars = w.characters || [];
      if (chars.length !== analysis.length) {
        problems.push(`${w.id}: ${chars.length} character entries for ${analysis.length} letters`);
        continue;
      }
      analysis.forEach((l, i) => {
        const c = chars[i];
        if (c.char !== l.char) problems.push(`${w.id}[${i}]: expected "${l.char}", config has "${c.char}"`);
        if (c.form && c.form !== l.form) problems.push(`${w.id}[${i}]: form "${c.form}" should be "${l.form}"`);
        if (!['handwritten', 'typed'].includes(c.style)) problems.push(`${w.id}[${i}]: style must be handwritten|typed`);
        if (c.style === 'handwritten') {
          const s = c.sample ? this.letters.get(c.sample) : null;
          if (c.sample && !s) problems.push(`${w.id}[${i}]: sample "${c.sample}" not found`);
          else if (s && (s.character !== l.char || s.form !== l.form || s.status !== 'identified'))
            problems.push(`${w.id}[${i}]: sample ${s.id} is ${s.form} "${s.character}", needs ${l.form} "${l.char}"`);
          else if (!s && !this.letters.has(l.char, l.form))
            problems.push(`${w.id}[${i}]: no handwritten ${l.form} "${l.char}" available`);
        }
      });
    }
    return problems;
  }
}

function num(...values) {
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}
