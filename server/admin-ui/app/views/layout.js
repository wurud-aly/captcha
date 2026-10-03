/** Layout view: global composition settings (composition.json) with live preview. */
import { SETTING_SPECS } from '../../../src/scripts/settings.js';
import { h, t, slider, selectField, section } from '../ui.js';

export function renderLayout(root, ctx) {
  const { draft, preview } = ctx;
  const words = draft.get().words.words;
  let wordId = words.some((w) => w.id === ctx.viewState.layoutWord) ? ctx.viewState.layoutWord : words[0].id;
  const guides = { on: ctx.viewState.layoutGuides ?? false };
  const canvas = h('canvas', { class: 'adm-canvas adm-canvas--wide adm-canvas--hero', id: 'layout-preview' });
  const readout = h('p', { class: 'stroke-readout', 'aria-live': 'polite' });
  let readoutTimer = 0;
  const draw = () => {
    preview.render(canvas, wordId, { guides: guides.on });
    // measuring re-rasterises every letter: debounce while sliders move
    clearTimeout(readoutTimer);
    readoutTimer = setTimeout(() => {
      if (!readout.isConnected) return;
      const m = preview.engine.measureStrokes({ ...preview.settings() });
      readout.textContent = t('strokeReadout', { hand: m.hand.toFixed(2), typed: m.typed.toFixed(2) });
    }, 250);
  };
  ctx.onPreview(draw);

  const sliders = [];
  const comp = (path) => path.split('.').reduce((o, k) => o[k], draft.get().composition);
  const setComp = (path, v) =>
    draft.change((s) => {
      const keys = path.split('.');
      const last = keys.pop();
      keys.reduce((o, k) => o[k], s.composition)[last] = v;
    }, { key: `comp:${path}` });
  const sl = (path, labelKey, spec, unit = 'px', digits = 1, signed = false) => {
    const x = slider({ id: `comp-${path.replace('.', '-')}`, label: t(labelKey), ...spec, unit, digits, signed, get: () => comp(path), set: (v) => setComp(path, v) });
    sliders.push(x);
    return x.el;
  };
  const S = SETTING_SPECS;
  const sel = (path, labelKey, options) =>
    selectField({ id: `comp-${path.replace('.', '-')}`, label: t(labelKey), options, value: comp(path), onChange: (v) => setComp(path, v) });

  const wordSelect = selectField({
    id: 'layout-word',
    label: t('previewWord'),
    options: words.map((w) => [w.id, w.word]),
    value: wordId,
    onChange: (v) => {
      wordId = v;
      ctx.viewState.layoutWord = v;
      draw();
    },
  });
  const guidesToggle = h('input', { type: 'checkbox', id: 'layout-guides' });
  guidesToggle.checked = guides.on;
  guidesToggle.addEventListener('change', () => {
    guides.on = guidesToggle.checked;
    ctx.viewState.layoutGuides = guides.on;
    draw();
  });

  const match = h('button', { type: 'button', class: 'btn btn--small', id: 'layout-match' }, t('matchStroke'));
  match.addEventListener('click', () => {
    const v = Math.round(preview.engine.recommendTypedStroke(preview.settings()) * 100) / 100;
    setComp('typed.thickness', Math.max(S.typedStroke.min, Math.min(S.typedStroke.max, v)));
    sliders.forEach((s) => s.sync());
  });

  const color = h('input', { type: 'color', id: 'comp-ink', class: 'adm-color' });
  color.value = comp('render.inkColor');
  color.addEventListener('input', () => setComp('render.inkColor', color.value));

  root.replaceChildren(
    h('div', { class: 'adm-head' }, h('div', {}, h('h1', { class: 'adm-h1' }, t('layoutTitle')), h('p', { class: 'adm-muted' }, t('layoutIntro')))),
    section(
      t('previewTitle'),
      null,
      h('div', { class: 'stage adm-stage' }, canvas),
      h('div', { class: 'adm-row adm-row--wrap' }, h('div', { class: 'adm-grow' }, wordSelect), h('label', { class: 'switch' }, guidesToggle, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', {}, t('showGuides')))),
    ),
    h(
      'div',
      { class: 'adm-two' },
      section(
        t('g_layout'),
        null,
        sl('layout.size', 'size', S.size, '×', 2),
        sl('layout.spacing', 'spacing', S.spacing, 'px', 0),
        sl('layout.overlap', 'overlap', S.overlap, 'px', 1, true),
        sel('layout.baselineMode', 'baselineMode', [['joins', t('baselineJoins')], ['baseline', t('baselineShared')]]),
        sl('layout.verticalOffset', 'verticalOffset', S.verticalOffset, 'px', 0, true),
      ),
      h(
        'div',
        { class: 'adm-stack' },
        section(
          t('g_typed'),
          null,
          sl('typed.fontSize', 'fontSize', { min: 40, max: 200, step: 1 }, 'px', 0),
          sl('typed.thickness', 'typedThickness', S.typedStroke, 'px', 2, true),
          readout,
          match,
        ),
        section(
          t('g_hand'),
          null,
          sl('handwritten.scale', 'handScale', { min: 0.3, max: 3, step: 0.05 }, '×', 2),
          sl('handwritten.thickness', 'handThickness', S.handStroke, 'px', 2, true),
          sl('handwritten.edgeCrispness', 'crisp', { min: 0, max: 1, step: 0.05 }, '', 2),
        ),
        section(
          t('g_render'),
          null,
          sel('render.background', 'background', S.background.options.map((o) => [o, t(`bg_${o}`)])),
          h('label', { class: 'field adm-colorfield', for: 'comp-ink' }, h('span', {}, t('inkColor')), color),
        ),
      ),
    ),
  );
  draw();
}
