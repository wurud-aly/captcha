/**
 * Draft model: every edit in the dashboard changes a local working copy of
 * letters.json / words.json / composition.json. Nothing reaches the server
 * until "Save and apply". Supports undo / redo / discard.
 *
 * Uploaded images live here too (as blob URLs + base64) under "pending:" refs
 * until they are saved.
 */
const clone = (v) => structuredClone(v);
const MAX_UNDO = 150;

export class Draft {
  constructor(saved) {
    this.listeners = new Set();
    this.images = new Map(); // ref -> {url, data, name}
    this.reset(saved);
  }

  reset(saved) {
    this.saved = clone({ letters: saved.letters, words: saved.words, composition: saved.composition });
    this.version = saved.version;
    this.state = clone(this.saved);
    this.undoStack = [];
    this.redoStack = [];
    this.lastKey = null;
    this.lastTime = 0;
    this.emit({ structural: true, reason: 'reset' });
  }

  get() {
    return this.state;
  }

  /**
   * Apply a change. Rapid changes with the same `key` (e.g. dragging one slider)
   * are merged into a single undo step.
   * @param {(state:object) => void} mutate
   * @param {{key?:string, structural?:boolean}} opts structural: the view must re-render
   */
  change(mutate, { key = null, structural = false } = {}) {
    const t = Date.now();
    const merge = key && key === this.lastKey && t - this.lastTime < 1200;
    if (!merge) {
      this.undoStack.push(clone(this.state));
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastKey = key;
    this.lastTime = t;
    mutate(this.state);
    this.emit({ structural, reason: 'change' });
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(clone(this.state));
    this.state = this.undoStack.pop();
    this.lastKey = null;
    this.emit({ structural: true, reason: 'undo' });
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(clone(this.state));
    this.state = this.redoStack.pop();
    this.lastKey = null;
    this.emit({ structural: true, reason: 'redo' });
  }

  discard() {
    this.state = clone(this.saved);
    this.undoStack = [];
    this.redoStack = [];
    this.lastKey = null;
    this.emit({ structural: true, reason: 'discard' });
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  addImage(ref, entry) {
    this.images.set(ref, entry);
  }

  /** Changed entities compared with the saved version. */
  changes() {
    const out = [];
    const byId = (list) => new Map(list.map((x) => [x.id, JSON.stringify(x)]));
    const diff = (kind, a, b) => {
      for (const [id, v] of b) if (!a.has(id)) out.push({ kind, id, op: 'added' });
        else if (a.get(id) !== v) out.push({ kind, id, op: 'changed' });
      for (const id of a.keys()) if (!b.has(id)) out.push({ kind, id, op: 'removed' });
    };
    diff('letter', byId(this.saved.letters.samples), byId(this.state.letters.samples));
    diff('word', byId(this.saved.words.words), byId(this.state.words.words));
    if (JSON.stringify(this.saved.letters.writers) !== JSON.stringify(this.state.letters.writers)) out.push({ kind: 'writers', id: 'writers', op: 'changed' });
    if (JSON.stringify(this.saved.composition) !== JSON.stringify(this.state.composition)) out.push({ kind: 'composition', id: 'composition', op: 'changed' });
    return out;
  }

  isDirty() {
    return this.changes().length > 0;
  }

  /** Request body for POST /admin/api/save (only uploads still in use are sent). */
  payload() {
    const used = new Set(this.state.letters.samples.map((s) => s.file).filter((f) => f.startsWith('pending:')));
    return {
      baseVersion: this.version,
      letters: this.state.letters,
      words: this.state.words,
      composition: this.state.composition,
      images: [...used].map((ref) => ({ ref, data: this.images.get(ref).data, name: this.images.get(ref).name })),
    };
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(info) {
    this.listeners.forEach((fn) => fn(info));
  }
}
