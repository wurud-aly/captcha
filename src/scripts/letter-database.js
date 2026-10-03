/**
 * Handwritten character database (pure, no DOM).
 *
 * Wraps src/data/letters.json. The engine never reads the JSON directly; it asks
 * this class for samples by character + contextual form. Adding samples, writers
 * or variants only requires new JSON entries — no engine changes.
 */

const REQUIRED_ANCHORS = {
  isolated: [],
  initial: ['exit'],
  medial: ['entry', 'exit'],
  final: ['entry'],
};

export class LetterDatabase {
  /** @param {object} data parsed letters.json */
  constructor(data) {
    if (!data || !Array.isArray(data.samples)) throw new Error('letters.json: "samples" array missing');
    this.data = data;
    this.writers = data.writers || [];
    this.samples = data.samples.map((s) => Object.freeze(normalizeSample(s)));
    this.byId = new Map(this.samples.map((s) => [s.id, s]));
    if (this.byId.size !== this.samples.length) throw new Error('letters.json: duplicate sample ids');
  }

  all() {
    return this.samples;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  /** Only identified samples can be used to render a character. */
  isUsable(sample) {
    return Boolean(sample && sample.status === 'identified' && sample.character);
  }

  /**
   * Find usable samples for a character in a contextual form.
   * @param {{character:string, form:string, writerId?:string}} q
   */
  find({ character, form, writerId } = {}) {
    return this.samples.filter(
      (s) =>
        this.isUsable(s) &&
        s.character === character &&
        (!form || s.form === form) &&
        (!writerId || s.writerId === writerId),
    );
  }

  has(character, form) {
    return this.find({ character, form }).length > 0;
  }

  /** Characters (with forms) that have at least one usable handwritten sample. */
  coverage() {
    const map = {};
    for (const s of this.samples) {
      if (!this.isUsable(s)) continue;
      (map[s.character] ||= new Set()).add(s.form);
    }
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]));
  }

  /** Structural validation; returns a list of human-readable problems. */
  validate() {
    const problems = [];
    for (const s of this.samples) {
      if (!s.file) problems.push(`${s.id}: missing file`);
      if (!['identified', 'unknown'].includes(s.status)) problems.push(`${s.id}: status must be identified|unknown`);
      if (s.status === 'identified' && !s.character) problems.push(`${s.id}: identified sample without character`);
      if (s.status === 'unknown' && s.character) problems.push(`${s.id}: unknown sample must not have a character`);
      if (!REQUIRED_ANCHORS[s.form]) problems.push(`${s.id}: invalid form "${s.form}"`);
      for (const a of REQUIRED_ANCHORS[s.form] || []) {
        if (!s.anchors[a]) problems.push(`${s.id}: ${s.form} form requires anchors.${a}`);
      }
      if (!(s.image.width > 0 && s.image.height > 0)) problems.push(`${s.id}: image size missing`);
    }
    return problems;
  }
}

function normalizeSample(s) {
  return {
    style: 'handwritten',
    variant: 1,
    candidates: [],
    notes: '',
    ...s,
    image: { width: 0, height: 0, ...(s.image || {}) },
    inkBox: s.inkBox || null,
    anchors: { entry: null, exit: null, ...(s.anchors || {}) },
    adjust: { offsetX: 0, offsetY: 0, scale: 1, thickness: 0, ...(s.adjust || {}) },
  };
}
