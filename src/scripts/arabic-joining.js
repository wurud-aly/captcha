/**
 * Arabic joining analysis (pure, no DOM).
 *
 * Every Arabic letter has a Unicode joining type:
 *   D  dual-joining   – connects to the previous AND the next letter (ب ت س ...)
 *   R  right-joining  – connects only to the previous letter (ا د ذ ر ز و ...)
 *   U  non-joining    – never connects (ء, Latin, digits, spaces ...)
 *   C  join-causing   – tatweel / ZWJ: behaves like a dual joiner
 *   T  transparent    – harakat (diacritics); skipped when deciding joins
 *
 * From the joining types we derive the contextual form of each letter:
 *   isolated | initial | medial | final
 * Logical order is the stored string order (first letter = right-most on screen).
 */

const DUAL = 'بتثجحخسشصضطظعغفقكلمنهيئىٮٯڤڨکگی';
const RIGHT = 'اأإآٱدذرزوؤةۀ';
const CAUSING = 'ـ‍'; // tatweel, zero-width joiner

export const FORMS = Object.freeze(['isolated', 'initial', 'medial', 'final']);

export function joiningType(ch) {
  if (!ch) return 'U';
  if (DUAL.includes(ch)) return 'D';
  if (RIGHT.includes(ch)) return 'R';
  if (CAUSING.includes(ch)) return 'C';
  const cp = ch.codePointAt(0);
  // Arabic combining marks (harakat, shadda, sukun, superscript alef ...)
  if ((cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || (cp >= 0x06d6 && cp <= 0x06ed)) return 'T';
  return 'U';
}

/** Can this letter connect to the letter that FOLLOWS it (visually on its left)? */
export function joinsForward(ch) {
  const t = joiningType(ch);
  return t === 'D' || t === 'C';
}

/** Can this letter connect to the letter that PRECEDES it (visually on its right)? */
export function joinsBackward(ch) {
  const t = joiningType(ch);
  return t === 'D' || t === 'R' || t === 'C';
}

export function isNonConnecting(ch) {
  return joiningType(ch) === 'R';
}

export function formFromJoins(joinsPrev, joinsNext) {
  if (joinsPrev && joinsNext) return 'medial';
  if (joinsPrev) return 'final';
  if (joinsNext) return 'initial';
  return 'isolated';
}

/**
 * Split a word into letters and compute the contextual form of each.
 * Transparent marks are attached to the preceding letter and do not break joins.
 * @param {string} word
 * @returns {{index:number,char:string,marks:string,joiningType:string,joinsPrev:boolean,joinsNext:boolean,form:string}[]}
 */
export function analyzeWord(word) {
  const letters = [];
  for (const ch of Array.from(word.normalize('NFC'))) {
    if (joiningType(ch) === 'T' && letters.length) {
      letters[letters.length - 1].marks += ch;
    } else {
      letters.push({ char: ch, marks: '', joiningType: joiningType(ch) });
    }
  }
  return letters.map((l, i) => {
    const prev = letters[i - 1];
    const next = letters[i + 1];
    const joinsPrev = Boolean(prev) && joinsForward(prev.char) && joinsBackward(l.char);
    const joinsNext = Boolean(next) && joinsForward(l.char) && joinsBackward(next.char);
    return { index: i, ...l, joinsPrev, joinsNext, form: formFromJoins(joinsPrev, joinsNext) };
  });
}

/**
 * Text that forces the font to shape a single letter in a given form.
 * ZWJ (U+200D) is invisible but makes the shaper treat the letter as connected.
 */
export function shapingText(ch, form) {
  const ZWJ = '‍';
  switch (form) {
    case 'initial': return ch + ZWJ;
    case 'medial': return ZWJ + ch + ZWJ;
    case 'final': return ZWJ + ch;
    default: return ch;
  }
}

export const FORM_LABELS = {
  isolated: { en: 'isolated', ar: 'منفصل' },
  initial: { en: 'initial', ar: 'بداية' },
  medial: { en: 'medial', ar: 'وسط' },
  final: { en: 'final', ar: 'نهاية' },
};

/** Show the shape of a form with tatweel, e.g. ـبـ — used for labels only. */
export function formGlyphLabel(ch, form) {
  const T = 'ـ';
  switch (form) {
    case 'initial': return ch + T;
    case 'medial': return T + ch + T;
    case 'final': return T + ch;
    default: return ch;
  }
}
