/** Words view: list, create, edit (letters, styles, samples, adjustments), delete. */
import { analyzeWord, formGlyphLabel } from '../../../src/scripts/arabic-joining.js';
import { CHARACTER_SPECS } from '../../../src/scripts/settings.js';
import { h, t, confirmDialog, slider, selectField, segmented, section, toast } from '../ui.js';

const WORD_RE = /^[ء-يٱپچڤگی]{1,24}$/;

export function validateWordText(text, words, exceptId = null) {
  const w = text.normalize('NFC').trim();
  if (!WORD_RE.test(w)) return t('err_word');
  if (words.some((x) => x.word === w && x.id !== exceptId)) return t('err_word_dup');
  return null;
}

function slugFor(word, words) {
  const map = { ا: 'a', أ: 'a', إ: 'i', آ: 'aa', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', و: 'w', ي: 'y', ى: 'a', ة: 'h', ؤ: 'w', ئ: 'y', ء: 'e' };
  const base = [...word].map((c) => map[c] || '').join('').slice(0, 30) || 'word';
  let id = base;
  let n = 2;
  const ids = new Set(words.map((w) => w.id));
  while (ids.has(id)) id = `${base}-${n++}`;
  return id;
}

/** Rebuild per-letter config for edited text, keeping settings of unchanged letters. */
export function rebuildCharacters(text, old = []) {
  return analyzeWord(text).map((l, i) => {
    const prev = old[i];
    if (prev && prev.char === l.char && prev.form === l.form) return { ...prev };
    return { char: l.char, form: l.form, style: 'typed' };
  });
}

export function renderWords(root, ctx, param) {
  if (param === 'new') return renderNew(root, ctx);
  const word = param && ctx.draft.get().words.words.find((w) => w.id === param);
  if (word) return renderEditor(root, ctx, word.id);
  return renderList(root, ctx);
}

function renderList(root, ctx) {
  const words = ctx.draft.get().words.words;
  const saved = new Map(ctx.draft.saved.words.words.map((w) => [w.id, JSON.stringify(w)]));
  const list = h('ul', { class: 'adm-words', id: 'word-list' });
  const canvases = [];
  for (const w of words) {
    const cv = h('canvas', { class: 'adm-canvas adm-canvas--wide' });
    canvases.push([cv, w.id]);
    const counts = w.characters.reduce((a, c) => ((a[c.style === 'handwritten' ? 'h' : 't'] += 1), a), { h: 0, t: 0 });
    const state = !saved.has(w.id) ? t('badgeNew') : saved.get(w.id) !== JSON.stringify(w) ? t('badgeChanged') : '';
    list.append(
      h(
        'li',
        {},
        h(
          'a',
          { class: 'adm-wordcard', href: `#words/${w.id}`, dataset: { word: w.id } },
          cv,
          h(
            'span',
            { class: 'adm-wordcard__body' },
            h('span', { class: 'adm-wordcard__word', lang: 'ar' }, w.word),
            h('span', { class: 'adm-muted' }, [w.meaning, t('mix', counts)].filter(Boolean).join(' · ')),
            state ? h('span', { class: 'adm-badge adm-badge--changed' }, state) : null,
          ),
        ),
      ),
    );
  }
  const draw = () => canvases.forEach(([cv, id]) => ctx.preview.render(cv, id));
  ctx.onPreview(draw);
  root.replaceChildren(
    h(
      'div',
      { class: 'adm-head' },
      h('div', {}, h('h1', { class: 'adm-h1' }, t('wordsTitle')), h('p', { class: 'adm-muted' }, t('wordsIntro'))),
      h('a', { class: 'btn btn--primary', href: '#words/new', id: 'add-word' }, t('addWord')),
    ),
    list,
  );
  draw();
}

function renderNew(root, ctx) {
  const input = h('input', { class: 'adm-input adm-input--ar', id: 'new-word', lang: 'ar', dir: 'rtl', maxlength: 24, autocomplete: 'off' });
  const meaning = h('input', { class: 'adm-input', id: 'new-meaning', maxlength: 120, dir: 'auto' });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const createBtn = h('button', { class: 'btn btn--primary', type: 'submit', id: 'create-word' }, t('create'));
  const form = h(
    'form',
    { class: 'adm-stack', novalidate: true },
    h('label', { class: 'field', for: 'new-word' }, h('span', {}, t('wordText')), input),
    h('label', { class: 'field', for: 'new-meaning' }, h('span', {}, t('meaning')), meaning),
    h('div', { class: 'adm-row' }, createBtn),
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const words = ctx.draft.get().words.words;
    const err = validateWordText(input.value, words);
    if (err) {
      status.className = 'status status--error';
      status.textContent = err;
      input.focus();
      return;
    }
    const text = input.value.normalize('NFC').trim();
    const id = slugFor(text, words);
    ctx.draft.change((s) => s.words.words.push({ id, word: text, meaning: meaning.value.trim(), characters: rebuildCharacters(text) }), { structural: true });
    location.hash = `#words/${id}`;
  });
  root.replaceChildren(
    h('div', { class: 'adm-head' }, h('div', {}, h('a', { class: 'adm-link', href: '#words' }, t('back')), h('h1', { class: 'adm-h1' }, t('newWord')))),
    section(t('newWord'), t('err_word'), form),
  );
  input.focus();
}

function renderEditor(root, ctx, id) {
  const { draft, preview } = ctx;
  const get = () => draft.get().words.words.find((w) => w.id === id);
  const w = get();
  const sel = Math.min(ctx.viewState.wordLetter?.[id] ?? 0, w.characters.length - 1);
  const guides = { on: ctx.viewState.wordGuides ?? true };
  let seed = 7;

  const canvas = h('canvas', { class: 'adm-canvas adm-canvas--wide adm-canvas--hero', id: 'word-preview' });
  const draw = () => preview.render(canvas, id, { guides: guides.on, seed });
  ctx.onPreview(draw);

  /* text + meaning */
  const text = h('input', { class: 'adm-input adm-input--ar', id: 'edit-word', lang: 'ar', dir: 'rtl', maxlength: 24 });
  text.value = w.word;
  const textStatus = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  text.addEventListener('change', () => {
    const err = validateWordText(text.value, draft.get().words.words, id);
    if (err) {
      textStatus.className = 'status status--error';
      textStatus.textContent = err;
      return;
    }
    const v = text.value.normalize('NFC').trim();
    draft.change((s) => {
      const x = s.words.words.find((y) => y.id === id);
      x.characters = rebuildCharacters(v, x.characters);
      x.word = v;
    }, { structural: true });
  });
  const meaning = h('input', { class: 'adm-input', id: 'edit-meaning', maxlength: 120, dir: 'auto' });
  meaning.value = w.meaning || '';
  meaning.addEventListener('input', () => draft.change((s) => (s.words.words.find((y) => y.id === id).meaning = meaning.value), { key: `${id}:meaning` }));

  /* letters strip */
  const plan = preview.engine.words.get(id) ? preview.engine.words.resolve(id) : [];
  const strip = h('div', { class: 'letter-strip', role: 'group', 'aria-label': t('lettersOfWord') });
  w.characters.forEach((c, i) => {
    const p = plan[i];
    const style = p?.style || c.style;
    strip.append(
      h(
        'button',
        {
          type: 'button',
          class: 'letter-chip',
          lang: 'ar',
          dataset: { style, index: String(i) },
          'aria-pressed': String(i === sel),
          onclick: () => {
            ctx.viewState.wordLetter = { ...(ctx.viewState.wordLetter || {}), [id]: i };
            ctx.rerender();
          },
        },
        h('span', { class: 'letter-chip__glyph' }, formGlyphLabel(c.char, c.form)),
        h('span', { class: 'letter-chip__source', dir: 'ltr' }, style === 'handwritten' && p?.sample ? p.sample.id : 'Cairo Light'),
      ),
    );
  });

  /* selected letter */
  const c = w.characters[sel];
  const options = preview.engine.letters.find({ character: c.char, form: c.form });
  const setChar = (patch, key, structural = false) =>
    draft.change((s) => Object.assign(s.words.words.find((y) => y.id === id).characters[sel], patch), { key: key && `${id}:${sel}:${key}`, structural });
  const letterPanel = [
    segmented({
      label: t('letterType'),
      options: [['handwritten', t('handwritten'), !options.length], ['typed', t('typed')]],
      value: plan[sel]?.style || c.style,
      onChange: (v) => setChar(v === 'handwritten' ? { style: v, sample: c.sample || options[0]?.id } : { style: v, sample: undefined }, null, true),
    }),
    !options.length ? h('p', { class: 'note' }, t('noSample')) : null,
    c.style === 'handwritten' && options.length
      ? selectField({
          id: 'letter-sample',
          label: t('sample'),
          options: options.map((s) => [s.id, `${s.id} (${s.image.width}×${s.image.height})`]),
          value: plan[sel]?.sample?.id || options[0].id,
          onChange: (v) => setChar({ sample: v }, null, true),
        })
      : null,
  ];
  const adjSliders = ['scale', 'offsetX', 'offsetY'].map((key) =>
    slider({
      id: `word-adj-${key}`,
      label: t(key),
      ...CHARACTER_SPECS[key],
      unit: key === 'scale' ? '×' : 'px',
      digits: key === 'scale' ? 2 : 0,
      signed: key !== 'scale',
      get: () => get().characters[sel].adjust?.[key] ?? (key === 'scale' ? 1 : 0),
      set: (v) =>
        draft.change((s) => {
          const ch = s.words.words.find((y) => y.id === id).characters[sel];
          ch.adjust = { scale: 1, offsetX: 0, offsetY: 0, ...(ch.adjust || {}), [key]: v };
        }, { key: `${id}:${sel}:${key}` }),
    }),
  );

  /* actions */
  const guidesToggle = h('input', { type: 'checkbox', id: 'word-guides' });
  guidesToggle.checked = guides.on;
  guidesToggle.addEventListener('change', () => {
    guides.on = guidesToggle.checked;
    ctx.viewState.wordGuides = guides.on;
    draw();
  });
  const regen = h('button', { type: 'button', class: 'btn btn--small' }, t('generate'));
  regen.addEventListener('click', () => {
    seed = (Math.random() * 2 ** 32) >>> 0;
    draw();
  });
  const del = h('button', { type: 'button', class: 'btn adm-danger', id: 'delete-word' }, t('deleteWord'));
  del.addEventListener('click', async () => {
    if (draft.get().words.words.length <= 1) return toast(t('lastWord'), 'error');
    if (!(await confirmDialog(t('deleteWordTitle', { w: get().word }), t('deleteWordBody')))) return;
    draft.change((s) => (s.words.words = s.words.words.filter((y) => y.id !== id)), { structural: true });
    location.hash = '#words';
  });

  root.replaceChildren(
    h(
      'div',
      { class: 'adm-head' },
      h('div', {}, h('a', { class: 'adm-link', href: '#words' }, t('back')), h('h1', { class: 'adm-h1' }, t('editWord'), ' ', h('span', { lang: 'ar', class: 'adm-glyph' }, w.word))),
      h('div', { class: 'adm-head__actions' }, del),
    ),
    section(
      t('previewTitle'),
      null,
      h('div', { class: 'stage adm-stage' }, canvas),
      h(
        'div',
        { class: 'adm-row' },
        h('label', { class: 'switch' }, guidesToggle, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', {}, t('showGuides'))),
        regen,
      ),
    ),
    h(
      'div',
      { class: 'adm-two' },
      section(
        t('lettersOfWord'),
        null,
        h('label', { class: 'field', for: 'edit-word' }, h('span', {}, t('wordText')), text),
        textStatus,
        h('label', { class: 'field', for: 'edit-meaning' }, h('span', {}, t('meaning')), meaning),
        strip,
        ...letterPanel,
      ),
      section(t('letterAdjust'), h('span', { lang: 'ar' }, formGlyphLabel(c.char, c.form)), ...adjSliders.map((s) => s.el)),
    ),
  );
  draw();
}
