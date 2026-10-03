/**
 * Project data store for the admin server.
 *
 * Responsibilities
 *  - read the three configuration files (letters, words, composition)
 *  - sanitise and validate everything the dashboard sends (never trust input)
 *  - store uploaded PNGs under public/assets/handwritten/uploads/ with
 *    content-addressed names: existing files are NEVER overwritten or deleted
 *  - write JSON atomically after backing up the current version
 *  - list and restore backups
 *
 * The validation reuses the public engine's own modules (joining rules, letter
 * and word databases), so the server accepts exactly what the CAPTCHA engine
 * can render.
 */
import { readFile, writeFile, rename, mkdir, readdir, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep, posix } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { LetterDatabase } from '../../src/scripts/letter-database.js';
import { WordDatabase } from '../../src/scripts/word-database.js';
import { analyzeWord, joiningType, FORMS } from '../../src/scripts/arabic-joining.js';
import { inkFromRGBA, inkBox, estimateStrokeWidth, inkSum } from '../../src/scripts/image-processor.js';
import { SETTING_SPECS } from '../../src/scripts/settings.js';
import { validateLetterPng, decodePng } from './png.mjs';
import { HttpError } from './http.mjs';

export const DATA_FILES = {
  letters: 'src/data/letters.json',
  words: 'src/data/words.json',
  composition: 'src/data/composition.json',
};
export const HANDWRITTEN_DIR = 'public/assets/handwritten';
export const UPLOAD_DIR = 'public/assets/handwritten/uploads';
const MAX_BACKUPS = 50;
const MAX_IMAGES_PER_SAVE = 20;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ARABIC_WORD_RE = /^[ء-يٱپچڤگی]{1,24}$/;

const bad = (msg) => new HttpError(422, 'invalid_data', msg);
const num = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${name} must be a number`);
  return Math.min(max, Math.max(min, n));
};
const str = (v, max, name, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  return v.slice(0, max);
};
const isArabicLetter = (ch) => typeof ch === 'string' && [...ch].length === 1 && ['D', 'R'].includes(joiningType(ch));

export class ProjectStore {
  constructor(root, { dataDir } = {}) {
    this.root = resolve(root);
    this.dataDir = dataDir ? resolve(dataDir) : join(this.root, 'server', '.data');
    this.backupDir = join(this.dataDir, 'backups');
    this.queue = Promise.resolve();
  }

  path(rel) {
    const p = resolve(this.root, rel);
    if (!p.startsWith(this.root + sep)) throw bad('Path escapes project');
    return p;
  }

  async readRaw() {
    const out = {};
    for (const [k, rel] of Object.entries(DATA_FILES)) out[k] = await readFile(this.path(rel), 'utf8');
    return out;
  }

  static versionOf(raw) {
    return createHash('sha256').update(raw.letters).update('\0').update(raw.words).update('\0').update(raw.composition).digest('hex').slice(0, 16);
  }

  async read() {
    const raw = await this.readRaw();
    return {
      letters: JSON.parse(raw.letters),
      words: JSON.parse(raw.words),
      composition: JSON.parse(raw.composition),
      version: ProjectStore.versionOf(raw),
    };
  }

  /** Serialise writes: one save/restore at a time. */
  exclusive(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Save a complete draft from the dashboard.
   * @param {{baseVersion:string, letters:object, words:object, composition:object,
   *          images?:{ref:string, data:string}[]}} draft  images: base64 PNGs for pending uploads
   */
  save(draft) {
    return this.exclusive(async () => {
      const current = await this.read();
      if (!draft || typeof draft !== 'object') throw bad('Missing data');
      if (draft.baseVersion !== current.version)
        throw new HttpError(409, 'version_conflict', 'The data changed since it was loaded. Reload the dashboard and apply your edits again.');

      // 1. pending uploads -> validated, content-addressed files
      const images = Array.isArray(draft.images) ? draft.images : [];
      if (images.length > MAX_IMAGES_PER_SAVE) throw bad(`At most ${MAX_IMAGES_PER_SAVE} images per save`);
      const pending = new Map();
      for (const img of images) {
        if (!img || typeof img.ref !== 'string' || !/^pending:[A-Za-z0-9_-]{6,40}$/.test(img.ref)) throw bad('Invalid image reference');
        if (typeof img.data !== 'string' || img.data.length > 3 * 1024 * 1024) throw bad('Invalid image data');
        const buf = Buffer.from(img.data, 'base64');
        const check = validateLetterPng(buf);
        if (!check.ok) throw new HttpError(422, 'invalid_image', `${img.name || 'Image'}: ${check.error}`);
        pending.set(img.ref, { buf, check });
      }

      // 2. sanitise configuration
      const letters = this.sanitizeLetters(draft.letters, current.letters);
      const words = this.sanitizeWords(draft.words, current.words);
      const composition = this.sanitizeComposition(draft.composition, current.composition);

      // 3. resolve image files; write new uploads (never overwrite)
      const written = [];
      const usedRefs = new Set();
      for (const s of letters.samples) {
        if (s.file.startsWith('pending:')) {
          const p = pending.get(s.file);
          if (!p) throw bad(`${s.id}: uploaded image missing`);
          usedRefs.add(s.file);
          const hash = createHash('sha256').update(p.buf).digest('hex').slice(0, 12);
          const rel = posix.join(UPLOAD_DIR, `${s.id}-${hash}.png`);
          const abs = this.path(rel);
          await mkdir(this.path(UPLOAD_DIR), { recursive: true });
          if (!existsSync(abs)) {
            await writeFile(abs, p.buf, { flag: 'wx' });
            written.push(rel);
          }
          const prev = current.letters.samples.find((x) => x.id === s.id);
          if (prev && prev.file !== rel) s.source.previousFiles = [...new Set([...(s.source.previousFiles || []), prev.file])].slice(-20);
          s.file = rel;
        }
        this.assertImageFile(s.file);
      }
      for (const ref of pending.keys()) if (!usedRefs.has(ref)) throw bad('An uploaded image is not used by any letter');

      // 4. measurements always come from the actual file, never from the client
      for (const s of letters.samples) {
        const prev = current.letters.samples.find((x) => x.id === s.id && x.file === s.file);
        if (prev && prev.image && prev.inkBox && prev.analysis) {
          Object.assign(s, { image: prev.image, inkBox: prev.inkBox, analysis: prev.analysis });
        } else {
          Object.assign(s, await this.measure(s.file));
        }
        this.checkGeometry(s);
      }

      // 5. validate exactly like the engine does
      const letterDb = new LetterDatabase(letters);
      const problems = [...letterDb.validate(), ...new WordDatabase(words, letterDb).validate()];
      if (problems.length) throw new HttpError(422, 'invalid_data', problems.join('; '), { problems });

      // 6. backup + atomic write
      const backup = await this.backup('before save');
      const out = { letters, words, composition };
      for (const [k, rel] of Object.entries(DATA_FILES)) await this.atomicWrite(this.path(rel), `${JSON.stringify(out[k], null, 2)}\n`);
      const after = await this.read();
      return { version: after.version, backup, written };
    });
  }

  assertImageFile(rel) {
    if (typeof rel !== 'string' || !rel.startsWith(`${HANDWRITTEN_DIR}/`) || !rel.endsWith('.png') || rel.includes('..'))
      throw bad(`Image path not allowed: ${rel}`);
    if (!existsSync(this.path(rel))) throw bad(`Image file not found: ${rel}`);
  }

  async measure(rel) {
    const img = decodePng(await readFile(this.path(rel)));
    const ink = inkFromRGBA(img.rgba);
    const box = inkBox(ink, img.width, img.height);
    return {
      image: { width: img.width, height: img.height },
      inkBox: box,
      analysis: {
        strokeWidth: Math.round(estimateStrokeWidth(ink, img.width, img.height) * 100) / 100,
        inkCoverage: Math.round(inkSum(ink) * 10) / 10,
      },
    };
  }

  checkGeometry(s) {
    const { width, height } = s.image;
    if (!(s.baseline >= 0 && s.baseline <= height)) throw bad(`${s.id}: baseline must be inside the image (0–${height})`);
    for (const k of ['entry', 'exit']) {
      const a = s.anchors[k];
      if (a && !(a.x >= -2 && a.x <= width + 2 && a.y >= -2 && a.y <= height + 2)) throw bad(`${s.id}: ${k} point must be inside the image`);
    }
  }

  sanitizeLetters(input, current) {
    if (!input || !Array.isArray(input.samples)) throw bad('letters.samples must be a list');
    if (input.samples.length > 500) throw bad('Too many samples');
    const writers = Array.isArray(input.writers) ? input.writers : current.writers;
    const cleanWriters = writers.slice(0, 50).map((w, i) => {
      const id = str(w?.id, 40, `writer ${i + 1} id`, { required: true });
      if (!ID_RE.test(id)) throw bad(`Invalid writer id "${id}"`);
      return { id, label: str(w.label, 80, 'writer label') || id, notes: str(w.notes, 300, 'writer notes') };
    });
    const writerIds = new Set(cleanWriters.map((w) => w.id));
    const ids = new Set();
    const samples = input.samples.map((s, i) => {
      if (!s || typeof s !== 'object') throw bad(`Sample ${i + 1} is invalid`);
      const id = str(s.id, 40, 'sample id', { required: true });
      if (!ID_RE.test(id)) throw bad(`Invalid sample id "${id}" (use a-z, 0-9 and -)`);
      if (ids.has(id)) throw bad(`Duplicate sample id ${id}`);
      ids.add(id);
      const status = s.status === 'identified' ? 'identified' : s.status === 'unknown' ? 'unknown' : null;
      if (!status) throw bad(`${id}: status must be identified or unknown`);
      const character = status === 'identified' ? s.character : null;
      if (status === 'identified' && !isArabicLetter(character)) throw bad(`${id}: choose the Arabic letter shown in the image`);
      if (!FORMS.includes(s.form)) throw bad(`${id}: invalid form`);
      const confidence = ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium';
      const writerId = writerIds.has(s.writerId) ? s.writerId : cleanWriters[0]?.id || 'writer-01';
      const point = (p, name) => (p ? { x: num(p.x, -10, 5000, `${id} ${name}.x`), y: num(p.y, -10, 5000, `${id} ${name}.y`) } : null);
      const adjust = s.adjust || {};
      const file = str(s.file, 200, `${id} file`, { required: true });
      const prev = current.samples.find((x) => x.id === id);
      const candidates = Array.isArray(s.candidates)
        ? s.candidates.filter((c) => c && isArabicLetter(c.character) && FORMS.includes(c.form)).slice(0, 6).map((c) => ({ character: c.character, form: c.form }))
        : [];
      const src = s.source && typeof s.source === 'object' ? s.source : {};
      return {
        id,
        file,
        style: 'handwritten',
        status,
        character,
        form: s.form,
        confidence,
        ...(status === 'unknown' && candidates.length ? { candidates } : {}),
        writerId,
        variant: Math.round(num(s.variant ?? 1, 1, 999, `${id} variant`)),
        baseline: num(s.baseline, -10, 5000, `${id} baseline`),
        anchors: { entry: point(s.anchors?.entry, 'entry'), exit: point(s.anchors?.exit, 'exit') },
        adjust: {
          offsetX: num(adjust.offsetX ?? 0, -200, 200, `${id} offsetX`),
          offsetY: num(adjust.offsetY ?? 0, -200, 200, `${id} offsetY`),
          scale: num(adjust.scale ?? 1, 0.3, 3, `${id} scale`),
          thickness: num(adjust.thickness ?? 0, -2, 3, `${id} thickness`),
        },
        notes: str(s.notes, 1000, `${id} notes`),
        source: {
          ...(Number.isInteger(prev?.source?.attachmentOrder) ? { attachmentOrder: prev.source.attachmentOrder } : {}),
          collection: str(src.collection, 80, 'collection') || prev?.source?.collection || 'admin-upload',
          ...(prev?.source?.previousFiles ? { previousFiles: prev.source.previousFiles } : {}),
          ...(prev ? {} : { addedAt: new Date().toISOString() }),
        },
        // image / inkBox / analysis are filled in from the file by save()
      };
    });
    return {
      schemaVersion: current.schemaVersion ?? 1,
      description: current.description,
      writers: cleanWriters,
      fieldGuide: current.fieldGuide,
      samples,
    };
  }

  sanitizeWords(input, current) {
    if (!input || !Array.isArray(input.words)) throw bad('words must be a list');
    if (input.words.length === 0) throw bad('Keep at least one word');
    if (input.words.length > 200) throw bad('Too many words');
    const ids = new Set();
    const texts = new Set();
    const words = input.words.map((w, i) => {
      const id = str(w?.id, 40, `word ${i + 1} id`, { required: true });
      if (!ID_RE.test(id)) throw bad(`Invalid word id "${id}"`);
      if (ids.has(id)) throw bad(`Duplicate word id ${id}`);
      ids.add(id);
      const word = str(w.word, 48, `word ${id}`, { required: true }).normalize('NFC').trim();
      if (!ARABIC_WORD_RE.test(word)) throw bad(`"${word}" must contain Arabic letters only (no spaces, numbers or diacritics)`);
      if (texts.has(word)) throw bad(`The word ${word} is listed twice`);
      texts.add(word);
      const letters = analyzeWord(word);
      const chars = Array.isArray(w.characters) ? w.characters : [];
      return {
        id,
        word,
        meaning: str(w.meaning, 120, `${id} meaning`),
        // char and form are always recomputed from the word itself
        characters: letters.map((l, j) => {
          const c = chars[j] || {};
          const style = c.style === 'handwritten' ? 'handwritten' : 'typed';
          const entry = { char: l.char, form: l.form, style };
          if (style === 'handwritten' && c.sample) {
            const sample = str(c.sample, 40, `${id} sample`);
            if (!ID_RE.test(sample)) throw bad(`${id}: invalid sample id`);
            entry.sample = sample;
          }
          const a = c.adjust || {};
          const adjust = {
            scale: num(a.scale ?? 1, 0.5, 1.8, 'scale'),
            offsetX: num(a.offsetX ?? 0, -40, 40, 'offsetX'),
            offsetY: num(a.offsetY ?? 0, -40, 40, 'offsetY'),
          };
          if (adjust.scale !== 1 || adjust.offsetX || adjust.offsetY) entry.adjust = adjust;
          return entry;
        }),
      };
    });
    return { schemaVersion: current.schemaVersion ?? 1, description: current.description, words };
  }

  sanitizeComposition(input, current) {
    if (!input || typeof input !== 'object') throw bad('composition missing');
    const L = SETTING_SPECS;
    const c = structuredClone(current);
    const i = input;
    c.canvas.width = Math.round(num(i.canvas?.width ?? c.canvas.width, 320, 1600, 'canvas width'));
    c.canvas.height = Math.round(num(i.canvas?.height ?? c.canvas.height, 120, 600, 'canvas height'));
    c.canvas.padding = num(i.canvas?.padding ?? c.canvas.padding, 0, 100, 'canvas padding');
    c.typed.fontSize = num(i.typed?.fontSize ?? c.typed.fontSize, 40, 200, 'font size');
    c.typed.thickness = num(i.typed?.thickness ?? c.typed.thickness, L.typedStroke.min, L.typedStroke.max, 'typed thickness');
    c.handwritten.scale = num(i.handwritten?.scale ?? c.handwritten.scale, 0.3, 3, 'handwritten scale');
    c.handwritten.thickness = num(i.handwritten?.thickness ?? c.handwritten.thickness, L.handStroke.min, L.handStroke.max, 'handwritten thickness');
    c.handwritten.edgeCrispness = num(i.handwritten?.edgeCrispness ?? c.handwritten.edgeCrispness, 0, 1, 'edge crispness');
    for (const k of ['size', 'spacing', 'overlap', 'verticalOffset']) c.layout[k] = num(i.layout?.[k] ?? c.layout[k], L[k].min, L[k].max, k);
    c.layout.baselineMode = L.baselineMode.options.includes(i.layout?.baselineMode) ? i.layout.baselineMode : c.layout.baselineMode;
    c.render.background = L.background.options.includes(i.render?.background) ? i.render.background : c.render.background;
    if (typeof i.render?.inkColor === 'string' && /^#[0-9a-f]{6}$/i.test(i.render.inkColor)) c.render.inkColor = i.render.inkColor.toLowerCase();
    // font file/family, effects and guide colours are not editable from the dashboard
    return c;
  }

  async atomicWrite(abs, text) {
    const tmp = `${abs}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, abs);
  }

  async backup(reason) {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
    const dir = join(this.backupDir, id);
    await mkdir(dir, { recursive: true });
    for (const [k, rel] of Object.entries(DATA_FILES)) await copyFile(this.path(rel), join(dir, `${k}.json`));
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), reason }, null, 2));
    await this.pruneBackups();
    return id;
  }

  async listBackups() {
    if (!existsSync(this.backupDir)) return [];
    const out = [];
    for (const id of (await readdir(this.backupDir)).sort().reverse()) {
      try {
        const meta = JSON.parse(await readFile(join(this.backupDir, id, 'meta.json'), 'utf8'));
        const words = JSON.parse(await readFile(join(this.backupDir, id, 'words.json'), 'utf8'));
        const letters = JSON.parse(await readFile(join(this.backupDir, id, 'letters.json'), 'utf8'));
        out.push({ id, ...meta, words: words.words.map((w) => w.word), samples: letters.samples.length });
      } catch {
        /* skip incomplete backup */
      }
    }
    return out;
  }

  async pruneBackups() {
    const ids = (await readdir(this.backupDir)).sort();
    const { rm } = await import('node:fs/promises');
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_BACKUPS))) await rm(join(this.backupDir, id), { recursive: true, force: true });
  }

  restore(id) {
    return this.exclusive(async () => {
      if (typeof id !== 'string' || !/^[0-9TZ-]+-[0-9a-f]{6}$/.test(id)) throw bad('Invalid backup id');
      const dir = join(this.backupDir, id);
      if (!existsSync(join(dir, 'meta.json'))) throw new HttpError(404, 'not_found', 'Backup not found');
      const data = {};
      for (const k of Object.keys(DATA_FILES)) data[k] = JSON.parse(await readFile(join(dir, `${k}.json`), 'utf8'));
      // the restored version must still be renderable with the files on disk
      for (const s of data.letters.samples) this.assertImageFile(s.file);
      const db = new LetterDatabase(data.letters);
      const problems = [...db.validate(), ...new WordDatabase(data.words, db).validate()];
      if (problems.length) throw new HttpError(422, 'invalid_data', problems.join('; '));
      const backup = await this.backup(`before restoring ${id}`);
      for (const [k, rel] of Object.entries(DATA_FILES)) await this.atomicWrite(this.path(rel), `${JSON.stringify(data[k], null, 2)}\n`);
      return { version: (await this.read()).version, backup };
    });
  }

  /** Files referenced by the current configuration (used by the publisher). */
  async publishableFiles() {
    const { letters } = await this.read();
    const files = new Set(Object.values(DATA_FILES));
    for (const s of letters.samples) files.add(s.file);
    return [...files];
  }

  async fileInfo(rel) {
    const st = await stat(this.path(rel));
    return { size: st.size, mtime: st.mtime.toISOString() };
  }
}
