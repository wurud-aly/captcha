import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeWord, fitToFrame } from '../../src/scripts/arabic-composer.js';

// Synthetic pieces: 100×100 rasters with a stroke along y = 70 (baseline)
const piece = (form, extra = {}) => ({
  width: 100,
  height: 100,
  inkBox: { x: 10, y: 30, w: 80, h: 45 },
  baseline: 70,
  entry: form === 'medial' || form === 'final' ? { x: 90, y: 70 } : null,
  exit: form === 'medial' || form === 'initial' ? { x: 10, y: 70 } : null,
  joinsPrev: form === 'medial' || form === 'final',
  joinsNext: form === 'medial' || form === 'initial',
  ...extra,
});

test('connected letters: entry lands exactly on the previous exit (+overlap), right to left', () => {
  const pieces = [piece('initial'), piece('medial'), piece('final')];
  const { placements, joins } = composeWord(pieces, { overlap: 3, spacing: 10 });
  assert.equal(joins.length, 2);
  for (const j of joins) {
    assert.ok(Math.abs(j.entry.x - j.exit.x - 3) < 1e-9, 'horizontal overlap');
    assert.ok(Math.abs(j.entry.y - j.exit.y) < 1e-9, 'vertical alignment');
  }
  assert.ok(placements[0].x > placements[1].x && placements[1].x > placements[2].x, 'RTL order');
});

test('non-connecting letter starts a new group separated by spacing, without ink overlap', () => {
  const pieces = [piece('initial'), piece('final'), piece('isolated')];
  const r = composeWord(pieces, { overlap: 2, spacing: 12 });
  assert.equal(r.groups.length, 2);
  const left = (i) => r.placements[i].x + pieces[i].inkBox.x;
  const right = (i) => left(i) + pieces[i].inkBox.w;
  assert.ok(Math.abs(Math.min(left(0), left(1)) - right(2) - 12) < 1e-9);
});

test('joins mode keeps slanted letters connected and re-centres the group on the baseline', () => {
  const slanted = piece('medial', { entry: { x: 90, y: 80 }, exit: { x: 10, y: 60 } });
  const pieces = [piece('initial'), slanted, piece('final')];
  const r = composeWord(pieces, { overlap: 0, baselineMode: 'joins' });
  for (const j of r.joins) assert.ok(Math.abs(j.entry.y - j.exit.y) < 1e-9);
  const mean = r.placements.reduce((s, p, i) => s + p.y + pieces[i].baseline, 0) / 3;
  assert.ok(Math.abs(mean) < 1e-9);
});

test('baseline mode puts every letter baseline on y = 0', () => {
  const slanted = piece('medial', { entry: { x: 90, y: 80 }, exit: { x: 10, y: 60 } });
  const pieces = [piece('initial'), slanted, piece('final')];
  const r = composeWord(pieces, { baselineMode: 'baseline' });
  r.placements.forEach((p, i) => assert.equal(p.y + pieces[i].baseline, 0));
});

test('offsets move a letter and the letters joined after it, keeping their joins intact', () => {
  const pieces = [piece('initial'), piece('medial', { offsetX: -5 }), piece('final')];
  const r = composeWord(pieces, { overlap: 0, baselineMode: 'baseline' });
  assert.ok(Math.abs(r.joins[0].entry.x - r.joins[0].exit.x + 5) < 1e-9); // the tuned join
  assert.ok(Math.abs(r.joins[1].entry.x - r.joins[1].exit.x) < 1e-9); // later join unaffected
});

test('fitToFrame never up-scales and keeps proportions', () => {
  const small = fitToFrame({ minX: -100, minY: -40, maxX: 0, maxY: 10, width: 100, height: 50 }, { width: 640, height: 220, padding: 20 });
  assert.equal(small.scale, 1);
  const big = fitToFrame({ minX: -2000, minY: -40, maxX: 0, maxY: 10, width: 2000, height: 50 }, { width: 640, height: 220, padding: 20 });
  assert.ok(big.scale < 1 && Math.abs(big.scale - 600 / 2000) < 1e-9);
});
