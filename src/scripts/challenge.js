/**
 * Challenge logic (pure, no DOM): pick a word, split it into letters,
 * scramble them, and check an arrangement.
 */

const MARKS = /[ً-ٰٟۖ-ۭ]/; // harakat and other combining marks

/** Validate and normalise the word list loaded from src/data/words.json. */
export function parseWordList(data) {
  const list = Array.isArray(data) ? data : data?.words;
  if (!Array.isArray(list)) throw new Error('words.json must contain a "words" array');
  const words = [...new Set(list.map((w) => String(w).normalize('NFC').trim()).filter((w) => splitLetters(w).length >= 2))];
  if (!words.length) throw new Error('words.json has no usable words (each needs at least 2 letters)');
  return words;
}

/** Split a word into letters; diacritics stay attached to their letter. */
export function splitLetters(word) {
  const letters = [];
  for (const ch of Array.from(String(word).normalize('NFC'))) {
    if (/\s/.test(ch)) continue;
    if (MARKS.test(ch) && letters.length) letters[letters.length - 1] += ch;
    else letters.push(ch);
  }
  return letters;
}

/** Pick a random word, avoiding `previous` whenever another word exists. */
export function pickWord(words, previous = null, random = Math.random) {
  const pool = words.length > 1 ? words.filter((w) => w !== previous) : words;
  return pool[Math.floor(random() * pool.length)];
}

/** Fisher–Yates shuffle; never returns the correct order when another order exists. */
export function scramble(letters, random = Math.random) {
  const original = letters.join('\u0000');
  const distinct = new Set(letters).size > 1;
  for (let attempt = 0; attempt < 50; attempt++) {
    const out = letters.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (!distinct || out.join('\u0000') !== original) return out;
  }
  // deterministic fallback: rotate by one
  return [...letters.slice(1), letters[0]];
}

/** A new challenge: the answer letters (kept private by the caller) and the scrambled tiles. */
export function createChallenge(words, previous = null, random = Math.random) {
  const word = pickWord(words, previous, random);
  const answer = splitLetters(word);
  const tiles = scramble(answer, random).map((letter, i) => ({ id: `t${i}`, letter }));
  return { word, answer, tiles };
}

/** True when the letters, in reading order, spell the answer. */
export function isCorrect(answer, arrangement) {
  return arrangement.length === answer.length && arrangement.every((l, i) => l === answer[i]);
}
