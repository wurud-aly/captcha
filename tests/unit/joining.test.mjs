import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWord, joiningType, shapingText, formGlyphLabel } from '../../src/scripts/arabic-joining.js';

const forms = (w) => analyzeWord(w).map((l) => `${l.char}:${l.form}`);

test('شبكات: ش initial, ب medial, ك medial, ا final, ت isolated (alif does not connect forward)', () => {
  assert.deepEqual(forms('شبكات'), ['ش:initial', 'ب:medial', 'ك:medial', 'ا:final', 'ت:isolated']);
});

test('حاسب: ح initial, ا final, س initial (after alif), ب final', () => {
  assert.deepEqual(forms('حاسب'), ['ح:initial', 'ا:final', 'س:initial', 'ب:final']);
});

test('فهد: ف initial, ه medial, د final', () => {
  assert.deepEqual(forms('فهد'), ['ف:initial', 'ه:medial', 'د:final']);
});

test('letters are kept in logical (reading) order', () => {
  assert.deepEqual(analyzeWord('شبكات').map((l) => l.char).join(''), 'شبكات');
});

test('joining types', () => {
  for (const ch of 'بتحسشفكه') assert.equal(joiningType(ch), 'D', ch);
  for (const ch of 'ادذرزو') assert.equal(joiningType(ch), 'R', ch);
  assert.equal(joiningType('ء'), 'U');
  assert.equal(joiningType('َ'), 'T');
});

test('non-connecting letters force the next letter to start a new group', () => {
  assert.deepEqual(forms('دار'), ['د:isolated', 'ا:isolated', 'ر:isolated']);
  assert.deepEqual(forms('بدر'), ['ب:initial', 'د:final', 'ر:isolated']);
});

test('harakat are transparent and do not break joins', () => {
  const a = analyzeWord('بَب');
  assert.equal(a.length, 2);
  assert.equal(a[0].marks, 'َ');
  assert.deepEqual(a.map((l) => l.form), ['initial', 'final']);
});

test('shaping text uses ZWJ to force contextual forms', () => {
  assert.equal(shapingText('ب', 'medial'), '‍ب‍');
  assert.equal(shapingText('ب', 'initial'), 'ب‍');
  assert.equal(shapingText('ب', 'final'), '‍ب');
  assert.equal(shapingText('ب', 'isolated'), 'ب');
  assert.equal(formGlyphLabel('ب', 'medial'), 'ـبـ');
});
