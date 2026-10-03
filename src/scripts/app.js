/**
 * Arabic letter-arrangement CAPTCHA.
 * Loads the word list, shows the letters of one random word in scrambled
 * order, and checks the user's arrangement.
 */
import { parseWordList, createChallenge, isCorrect } from './challenge.js';
import { makeSortable } from './drag-sort.js';

const TEXT = {
  verify: 'تحقّق',
  verified: 'تم التحقق',
  success: 'تم التحقق بنجاح. أنت إنسان.',
  error: 'إجابة غير صحيحة. حاول مرة أخرى.',
  loadError: 'تعذّر تحميل التحدي. أعد تحميل الصفحة.',
  moved: (letter, pos, total) => `الحرف ${letter} في الموضع ${pos} من ${total}`,
};
const LAST_KEY = 'ahc-last'; // fingerprint of the previous word, never the word itself

const $ = (id) => document.getElementById(id);
const card = $('captcha');
const tilesEl = $('tiles');
const verifyBtn = $('verify');
const resultText = $('result-text');
const live = $('live');

let words = [];
let answer = null; // private to this module; never written to the page
let current = null;

const fingerprint = (w) => {
  let h = 5381;
  for (const ch of w) h = (Math.imul(h, 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
};
const readLast = () => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
const writeLast = (w) => {
  try {
    localStorage.setItem(LAST_KEY, fingerprint(w));
  } catch {
    /* storage unavailable: repeats are still avoided within this page */
  }
};

function setState(state, message = '') {
  card.dataset.state = state;
  resultText.textContent = message;
}

const sortable = makeSortable(tilesEl, {
  onChange() {
    if (card.dataset.state === 'error') setState('ready');
  },
  onAnnounce(letter, pos, total) {
    live.textContent = TEXT.moved(letter, pos, total);
  },
});

function newChallenge() {
  const lastPrint = readLast();
  const previous = current || words.find((w) => fingerprint(w) === lastPrint) || null;
  const challenge = createChallenge(words, previous);
  current = challenge.word;
  answer = challenge.answer;
  writeLast(current);

  sortable.reset();
  tilesEl.replaceChildren(
    ...challenge.tiles.map((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile enter'; // one-shot entrance animation
      b.addEventListener('animationend', () => b.classList.remove('enter'), { once: true });
      b.dataset.letter = t.letter;
      b.textContent = t.letter;
      b.style.setProperty('--i', i);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', `${t.letter}، ${i + 1} / ${challenge.tiles.length}`);
      return b;
    }),
  );
  verifyBtn.disabled = false;
  verifyBtn.textContent = TEXT.verify;
  setState('ready');
}

verifyBtn.addEventListener('click', () => {
  if (!answer || card.dataset.state === 'success') return;
  if (isCorrect(answer, sortable.order())) {
    setState('success', TEXT.success);
    sortable.setLocked(true);
    verifyBtn.disabled = true;
    verifyBtn.textContent = TEXT.verified;
  } else {
    // restart the shake animation even on repeated wrong answers
    card.dataset.state = 'ready';
    void tilesEl.offsetWidth;
    setState('error', TEXT.error);
  }
});

$('new-challenge').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  btn.classList.remove('is-spinning');
  void btn.offsetWidth;
  btn.classList.add('is-spinning');
  if (words.length) newChallenge();
});

async function start() {
  try {
    const res = await fetch(new URL('src/data/words.json', document.baseURI), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    words = parseWordList(await res.json());
    newChallenge();
  } catch (err) {
    console.error(err);
    setState('error', TEXT.loadError);
    verifyBtn.disabled = true;
  }
}

start();
