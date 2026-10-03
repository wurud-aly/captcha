/** Preview CAPTCHA: saved (live) version next to the draft, with an answer test. */
import { h, t, section } from '../ui.js';

export function renderCaptcha(root, ctx) {
  const { draft, preview, savedPreview } = ctx;
  const words = draft.get().words.words;
  let choice = ctx.viewState.previewWord || 'random';
  let wordId = null;
  let seed = (Math.random() * 2 ** 32) >>> 0;

  const savedCanvas = h('canvas', { class: 'adm-canvas adm-canvas--wide', id: 'preview-saved' });
  const draftCanvas = h('canvas', { class: 'adm-canvas adm-canvas--wide', id: 'preview-draft' });
  const savedNote = h('p', { class: 'adm-muted' });
  const diffNote = h('p', { class: 'adm-muted', id: 'preview-diffnote' });

  const pick = () => {
    if (choice !== 'random') return choice;
    const ids = words.map((w) => w.id);
    return ids[Math.floor(Math.random() * ids.length)];
  };
  const draw = () => {
    const r = preview.render(draftCanvas, wordId, { seed, setAnswer: true });
    const s = savedPreview.render(savedCanvas, wordId, { seed });
    savedNote.textContent = s ? '' : t('wordMissing');
    savedCanvas.hidden = !s;
    diffNote.textContent = draft.isDirty() ? '' : t('noChanges');
    return r;
  };
  ctx.onPreview(draw);

  const select = h('select', { class: 'select adm-select-inline', id: 'preview-word' }, h('option', { value: 'random' }, t('randomWord')), ...words.map((w) => h('option', { value: w.id }, w.word)));
  select.value = choice;
  select.addEventListener('change', () => {
    choice = select.value;
    ctx.viewState.previewWord = choice;
    wordId = pick();
    draw();
  });
  const gen = h('button', { type: 'button', class: 'btn', id: 'preview-generate' }, t('generate'));
  gen.addEventListener('click', () => {
    seed = (Math.random() * 2 ** 32) >>> 0;
    wordId = pick();
    status.textContent = '';
    draw();
  });

  const input = h('input', { class: 'answer__input', id: 'preview-answer', lang: 'ar', dir: 'rtl', placeholder: t('answerPlaceholder'), autocomplete: 'off' });
  const status = h('p', { class: 'status', id: 'preview-status', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'answer', novalidate: true }, input, h('button', { class: 'btn btn--primary', type: 'submit' }, t('verify')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = preview.engine.verify(input.value);
    status.className = `status status--${ok ? 'success' : 'error'}`;
    status.textContent = ok ? t('correct') : t('wrong');
  });

  root.replaceChildren(
    h(
      'div',
      { class: 'adm-head' },
      h('div', {}, h('h1', { class: 'adm-h1' }, t('previewTitle')), h('p', { class: 'adm-muted' }, t('previewIntro'))),
      h('a', { class: 'btn btn--quiet', href: '/', target: '_blank', rel: 'noopener' }, t('openSite')),
    ),
    h('div', { class: 'adm-row adm-row--wrap' }, h('label', { class: 'visually-hidden', for: 'preview-word' }, t('previewWord')), select, gen),
    h(
      'div',
      { class: 'adm-two' },
      section(t('savedVersion'), null, h('div', { class: 'stage adm-stage' }, savedCanvas), savedNote),
      section(t('draftVersion'), null, h('div', { class: 'stage adm-stage' }, draftCanvas), diffNote, h('h3', { class: 'settings-group__title' }, t('testAnswer')), form, status),
    ),
  );
  wordId = pick();
  draw();
}
