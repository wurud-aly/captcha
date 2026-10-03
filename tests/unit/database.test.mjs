import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LetterDatabase } from '../../src/scripts/letter-database.js';
import { WordDatabase } from '../../src/scripts/word-database.js';
import { analyzeWord } from '../../src/scripts/arabic-joining.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const json = (p) => JSON.parse(readFileSync(ROOT + p, 'utf8'));
const lettersData = json('src/data/letters.json');
const wordsData = json('src/data/words.json');
const letters = new LetterDatabase(lettersData);
const words = new WordDatabase(wordsData, letters);

function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${path} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

test('exactly 12 handwritten samples, unique ids and files', () => {
  assert.equal(letters.all().length, 12);
  assert.equal(new Set(letters.all().map((s) => s.file)).size, 12);
});

test('every sample image exists and its size matches letters.json', () => {
  for (const s of letters.all()) {
    const path = ROOT + s.file;
    assert.ok(existsSync(path), `missing ${s.file}`);
    assert.deepEqual(pngSize(path), { width: s.image.width, height: s.image.height }, s.id);
  }
});

test('letters.json passes structural validation', () => {
  assert.deepEqual(letters.validate(), []);
});

test('unknown samples have no character and are never usable', () => {
  const unknown = letters.all().filter((s) => s.status === 'unknown');
  assert.ok(unknown.length >= 1);
  for (const s of unknown) {
    assert.equal(s.character, null);
    assert.equal(letters.isUsable(s), false);
  }
});

test('ink box lies inside the image (no cropped letter parts)', () => {
  for (const s of letters.all()) {
    const b = s.inkBox;
    assert.ok(b.x > 0 && b.y > 0, `${s.id} ink touches top/left edge`);
    assert.ok(b.x + b.w < s.image.width && b.y + b.h < s.image.height, `${s.id} ink touches bottom/right edge`);
  }
});

test('anchors exist for every connecting side and sit on the ink', () => {
  for (const s of letters.all()) {
    for (const a of [s.anchors.entry, s.anchors.exit].filter(Boolean)) {
      const b = s.inkBox;
      assert.ok(a.x >= b.x - 1 && a.x <= b.x + b.w + 1 && a.y >= b.y - 1 && a.y <= b.y + b.h + 1, `${s.id} anchor off ink`);
    }
  }
});

test('words.json validates against joining rules and the letter database', () => {
  assert.deepEqual(words.validate(), []);
});

test('the three initial words are present', () => {
  assert.deepEqual(words.all().map((w) => w.word), ['شبكات', 'حاسب', 'فهد']);
});

test('every handwritten assignment uses a sample of the same letter AND form', () => {
  for (const w of words.all()) {
    const forms = analyzeWord(w.word);
    for (const l of words.resolve(w.id)) {
      assert.equal(l.form, forms[l.index].form);
      if (l.style === 'handwritten') {
        assert.equal(l.sample.character, l.char, `${w.id}[${l.index}]`);
        assert.equal(l.sample.form, l.form, `${w.id}[${l.index}]`);
      }
      assert.equal(l.warning, null, `${w.id}[${l.index}] ${l.warning}`);
    }
  }
});

test('each configured word mixes handwritten and typed letters', () => {
  for (const w of words.all()) {
    const styles = new Set(words.resolve(w.id).map((l) => l.style));
    assert.deepEqual([...styles].sort(), ['handwritten', 'typed'], w.id);
  }
});

test('overrides switch styles; impossible handwritten requests fall back with a warning', () => {
  const plan = words.resolve('shabakat', { 1: { style: 'handwritten' }, 2: { style: 'handwritten' } });
  assert.equal(plan[1].style, 'handwritten'); // medial ب exists (hw-06)
  assert.equal(plan[1].sample.id, 'hw-06');
  assert.equal(plan[2].style, 'typed'); // no identified medial ك
  assert.match(plan[2].warning, /No handwritten medial/);
});

test('every one of the 12 images is used or explicitly marked unknown', () => {
  const coverage = letters.coverage();
  for (const s of letters.all()) {
    if (s.status === 'identified') assert.ok(coverage[s.character].includes(s.form));
  }
  // every identified sample is selectable by at least one letter of the word list
  const selectable = new Set();
  for (const w of words.all()) for (const l of words.resolve(w.id)) l.handwrittenOptions.forEach((s) => selectable.add(s.id));
  for (const s of letters.all().filter((x) => x.status === 'identified')) assert.ok(selectable.has(s.id), `${s.id} unreachable`);
});
