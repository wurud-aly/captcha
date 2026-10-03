import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWordList, splitLetters, pickWord, scramble, createChallenge, isCorrect } from '../../src/scripts/challenge.js';

const WORDS = parseWordList(JSON.parse(readFileSync(new URL('../../src/data/words.json', import.meta.url), 'utf8')));
const seeded = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const sorted = (a) => [...a].sort().join('');

test('word list loads from src/data/words.json', () => {
  assert.deepEqual(WORDS, ['شبكات', 'حاسب', 'فهد']);
});

test('words are split into individual Arabic letters', () => {
  assert.deepEqual(splitLetters('شبكات'), ['ش', 'ب', 'ك', 'ا', 'ت']);
  assert.deepEqual(splitLetters('حاسب'), ['ح', 'ا', 'س', 'ب']);
  assert.deepEqual(splitLetters('فهد'), ['ف', 'ه', 'د']);
  assert.deepEqual(splitLetters('مُدرّس'), ['مُ', 'د', 'رّ', 'س'], 'diacritics stay on their letter');
});

test('scrambled tiles contain exactly the letters of the word, nothing more', () => {
  for (let s = 1; s < 300; s++) {
    const c = createChallenge(WORDS, null, seeded(s));
    assert.ok(WORDS.includes(c.word));
    assert.equal(sorted(c.tiles.map((t) => t.letter)), sorted(splitLetters(c.word)));
    assert.equal(c.tiles.length, splitLetters(c.word).length);
  }
});

test('the scrambled order is never the correct order', () => {
  for (let s = 1; s < 2000; s++) {
    const letters = splitLetters(WORDS[s % WORDS.length]);
    assert.notDeepEqual(scramble(letters, seeded(s)), letters);
  }
  assert.notDeepEqual(scramble(['ب', 'ب', 'ا'], () => 0.999), ['ب', 'ب', 'ا']);
});

test('the previous word is never picked again when others exist', () => {
  for (let s = 1; s < 500; s++) {
    const prev = WORDS[s % WORDS.length];
    assert.notEqual(pickWord(WORDS, prev, seeded(s)), prev);
  }
  assert.equal(pickWord(['فهد'], 'فهد'), 'فهد', 'single-word list still works');
});

test('every word is reachable and letter positions vary between challenges', () => {
  const rnd = seeded(7);
  const seen = new Set();
  const orders = new Set();
  let prev = null;
  for (let i = 0; i < 300; i++) {
    const c = createChallenge(WORDS, prev, rnd);
    seen.add(c.word);
    if (c.word === 'شبكات') orders.add(c.tiles.map((t) => t.letter).join(''));
    prev = c.word;
  }
  assert.equal(seen.size, WORDS.length);
  assert.ok(orders.size > 10, `only ${orders.size} different orders`);
});

test('verification accepts only the exact reading order', () => {
  const answer = splitLetters('حاسب');
  assert.equal(isCorrect(answer, ['ح', 'ا', 'س', 'ب']), true);
  assert.equal(isCorrect(answer, ['ب', 'س', 'ا', 'ح']), false, 'reversed is wrong');
  assert.equal(isCorrect(answer, ['ح', 'س', 'ا', 'ب']), false);
  assert.equal(isCorrect(answer, ['ح', 'ا', 'س']), false);
  assert.equal(isCorrect(splitLetters('ببا'), ['ب', 'ب', 'ا']), true, 'identical letters are interchangeable');
});

test('invalid word lists are rejected', () => {
  assert.throws(() => parseWordList({}), /words/);
  assert.throws(() => parseWordList({ words: ['ب', ' '] }), /no usable/);
  assert.deepEqual(parseWordList({ words: ['فهد', 'فهد', ' حاسب '] }), ['فهد', 'حاسب']);
});
