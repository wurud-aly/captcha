import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectStore } from '../../server/lib/store.mjs';
import { tempProject, letterPng } from './helpers.mjs';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const originals = (dir) =>
  Object.fromEntries(
    readdirSync(join(dir, 'public/assets/handwritten'))
      .filter((f) => f.endsWith('.png'))
      .map((f) => [f, sha(join(dir, 'public/assets/handwritten', f))]),
  );

async function withStore(fn) {
  const p = tempProject();
  try {
    await fn(new ProjectStore(p.dir, { dataDir: join(p.dir, '.data') }), p.dir);
  } finally {
    p.cleanup();
  }
}

test('saving unchanged data is lossless', () =>
  withStore(async (store, dir) => {
    const before = readFileSync(join(dir, 'src/data/letters.json'), 'utf8');
    const d = await store.read();
    await store.save({ baseVersion: d.version, letters: d.letters, words: d.words, composition: d.composition });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'src/data/letters.json'), 'utf8')), JSON.parse(before));
  }));

test('upload: validated, stored under uploads/ with a new name, originals untouched', () =>
  withStore(async (store, dir) => {
    const orig = originals(dir);
    const d = await store.read();
    const png = await letterPng();
    d.letters.samples.push({
      id: 'hw-13', file: 'pending:abcdef123', status: 'identified', character: 'ب', form: 'initial', confidence: 'high',
      writerId: 'writer-01', baseline: 57, anchors: { entry: null, exit: { x: 15, y: 57 } }, adjust: { scale: 1, offsetX: 0, offsetY: 0, thickness: 0 },
      image: { width: 1, height: 1 }, inkBox: { x: 0, y: 0, w: 1, h: 1 }, // client values are ignored
    });
    const r = await store.save({ baseVersion: d.version, ...d, images: [{ ref: 'pending:abcdef123', data: png.toString('base64') }] });
    assert.equal(r.written.length, 1);
    assert.match(r.written[0], /^public\/assets\/handwritten\/uploads\/hw-13-[0-9a-f]{12}\.png$/);
    const saved = (await store.read()).letters.samples.find((s) => s.id === 'hw-13');
    assert.deepEqual(saved.image, { width: 120, height: 90 }, 'measured from the file, not the client');
    assert.deepEqual(saved.inkBox, { x: 15, y: 30, w: 90, h: 28 });
    assert.deepEqual(originals(dir), orig, 'original 12 images unchanged');
  }));

test('replace: new file gets a new name; the previous file stays on disk and is recorded', () =>
  withStore(async (store, dir) => {
    const orig = originals(dir);
    const d = await store.read();
    const s = d.letters.samples.find((x) => x.id === 'hw-08');
    s.file = 'pending:replace01';
    s.baseline = 57;
    s.anchors = { entry: null, exit: { x: 15, y: 57 } };
    await store.save({ baseVersion: d.version, ...d, images: [{ ref: 'pending:replace01', data: (await letterPng()).toString('base64') }] });
    const after = (await store.read()).letters.samples.find((x) => x.id === 'hw-08');
    assert.match(after.file, /uploads\/hw-08-/);
    assert.deepEqual(after.source.previousFiles, ['public/assets/handwritten/letter-08.png']);
    assert.ok(existsSync(join(dir, 'public/assets/handwritten/letter-08.png')));
    assert.deepEqual(originals(dir), orig);
    // other letters untouched
    const others = (await store.read()).letters.samples.filter((x) => x.id !== 'hw-08');
    assert.deepEqual(others, d.letters.samples.filter((x) => x.id !== 'hw-08'));
  }));

test('delete removes the library entry only; the image file is kept', () =>
  withStore(async (store, dir) => {
    const d = await store.read();
    d.letters.samples = d.letters.samples.filter((s) => s.id !== 'hw-01');
    await store.save({ baseVersion: d.version, ...d });
    assert.equal((await store.read()).letters.samples.length, 11);
    assert.ok(existsSync(join(dir, 'public/assets/handwritten/letter-01.png')));
  }));

test('rejects invalid images, paths, characters, words and stale versions', () =>
  withStore(async (store) => {
    const d = await store.read();
    const save = (mut, images) => {
      const x = structuredClone(d);
      mut(x);
      return store.save({ baseVersion: d.version, ...x, images });
    };
    await assert.rejects(save((x) => (x.letters.samples[0].file = '../../etc/passwd')), /not allowed|escapes/);
    await assert.rejects(save((x) => (x.letters.samples[0].file = 'src/data/words.json')), /not allowed/);
    await assert.rejects(save((x) => (x.letters.samples[1].character = 'X')), /Arabic letter/);
    await assert.rejects(save((x) => (x.letters.samples[1].character = '<script>')), /Arabic letter/);
    await assert.rejects(save((x) => x.words.words.push({ id: 'bad', word: 'abc', characters: [] })), /Arabic letters only/);
    await assert.rejects(save((x) => x.words.words.push({ id: 'Bad Id', word: 'باب', characters: [] })), /Invalid word id/);
    await assert.rejects(save((x) => (x.words.words[0].characters[1] = { style: 'handwritten', sample: 'hw-02' })), /needs medial/);
    await assert.rejects(save((x) => (x.words.words = [])), /at least one/);
    await assert.rejects(
      save((x) => (x.letters.samples[0].file = 'pending:opaque01'), [{ ref: 'pending:opaque01', data: Buffer.from('nope').toString('base64') }]),
      /Not a PNG/,
    );
    await assert.rejects(store.save({ ...d, baseVersion: 'stale' }), /changed since/);
  }));

test('unknown fields are stripped and numbers clamped (no arbitrary data written)', () =>
  withStore(async (store) => {
    const d = await store.read();
    d.letters.samples[1].evil = '<img onerror=alert(1)>';
    d.letters.samples[1].adjust.scale = 999;
    d.composition.layout.overlap = 1e9;
    d.composition.typed.fontFile = 'https://evil.example/font.ttf';
    await store.save({ baseVersion: d.version, ...d });
    const r = await store.read();
    assert.equal(r.letters.samples[1].evil, undefined);
    assert.equal(r.letters.samples[1].adjust.scale, 3);
    assert.equal(r.composition.layout.overlap, 12);
    assert.equal(r.composition.typed.fontFile, 'public/assets/fonts/Cairo-Light.ttf');
  }));

test('every save makes a backup that can be restored', () =>
  withStore(async (store) => {
    const d = await store.read();
    const x = structuredClone(d);
    x.words.words.push({ id: 'bab', word: 'باب', characters: [] });
    await store.save({ baseVersion: d.version, ...x });
    assert.equal((await store.read()).words.words.length, 4);
    const [latest] = await store.listBackups();
    assert.deepEqual(latest.words, ['شبكات', 'حاسب', 'فهد']);
    await store.restore(latest.id);
    assert.equal((await store.read()).words.words.length, 3);
    assert.equal((await store.listBackups()).length, 2, 'restore backs up the current state first');
    await assert.rejects(store.restore('../../etc'), /Invalid backup id/);
  }));
