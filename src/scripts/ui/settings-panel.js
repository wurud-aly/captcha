/**
 * Experiment settings panel. Built from SETTING_SPECS / CHARACTER_SPECS so new
 * parameters only need a spec entry and a translation string.
 */
import { SETTING_SPECS, CHARACTER_SPECS, clampSetting } from '../settings.js';
import { formGlyphLabel } from '../arabic-joining.js';
import { t } from '../i18n.js';
import { h, formatNumber, copyText } from './dom.js';

export class SettingsPanel {
  /**
   * @param {HTMLElement} root
   * @param {{store:object, engine:import('../captcha-engine.js').CaptchaEngine,
   *          getContext:() => {wordId:string|null, random:boolean},
   *          onReset:() => void}} deps
   */
  constructor(root, { lettersRoot, store, engine, getContext, onReset }) {
    this.root = root;
    this.lettersGroup = lettersRoot;
    this.store = store;
    this.engine = engine;
    this.getContext = getContext;
    this.onReset = onReset;
    this.selectedLetter = 0;
    this.lastWord = null;
    this.letterKey = null;
    this.syncers = [];
    this.letterSyncers = [];
    this.build();
    store.subscribe(() => this.sync());
  }

  build() {
    this.root.replaceChildren();
    this.syncers = [];

    const layout = h('div', { class: 'settings-group' }, h('h3', { class: 'settings-group__title', text: t('groupLayout') }));
    layout.append(
      this.slider('size', t('size')),
      this.slider('spacing', t('spacing'), { hint: t('spacingHint') }),
      this.slider('overlap', t('overlap'), { hint: t('overlapHint'), signed: true }),
      this.select('baselineMode', t('baselineMode'), [
        ['joins', t('baselineJoins')],
        ['baseline', t('baselineShared')],
      ]),
      this.slider('verticalOffset', t('verticalOffset'), { signed: true, digits: 0 }),
      this.select(
        'background',
        t('background'),
        SETTING_SPECS.background.options.map((o) => [o, t(`bg_${o}`)]),
      ),
    );

    const stroke = h('div', { class: 'settings-group' }, h('h3', { class: 'settings-group__title', text: t('groupStroke') }));
    this.readout = h('p', { class: 'stroke-readout', 'aria-live': 'polite' });
    stroke.append(
      this.slider('typedStroke', t('typedStroke'), { signed: true, className: 'is-typed', digits: 2 }),
      this.slider('handStroke', t('handStroke'), { signed: true, digits: 2 }),
      this.readout,
      h('button', { class: 'btn btn--small', type: 'button', id: 'match-stroke', onclick: () => this.matchStroke() }, t('matchStroke')),
    );

    const copyBtn = h('button', { class: 'btn btn--small btn--quiet', type: 'button', id: 'copy-json' }, t('copyJson'));
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(JSON.stringify(this.exportJSON(), null, 2));
      if (ok) {
        copyBtn.textContent = t('copied');
        setTimeout(() => (copyBtn.textContent = t('copyJson')), 1400);
      }
    });
    const actions = h(
      'div',
      { class: 'settings-actions' },
      h('button', { class: 'btn btn--small', type: 'button', id: 'reset-all', onclick: () => this.onReset() }, t('resetAll')),
      copyBtn,
    );

    this.root.append(layout, stroke, actions);
    this.letterKey = null;
    this.sync();
  }

  slider(key, label, { hint, signed = false, className = '', digits = 1, specs = SETTING_SPECS, read, write } = {}) {
    const spec = specs[key];
    const id = `set-${key}`;
    const value = h('span', { class: 'field__value' });
    const input = h('input', {
      type: 'range',
      id,
      min: spec.min,
      max: spec.max,
      step: spec.step,
      class: className,
    });
    const getter = read || (() => this.store.get()[key]);
    const setter = write || ((v) => this.store.set({ [key]: clampSetting(key, v) }));
    input.addEventListener('input', () => setter(Number(input.value)));
    const update = () => {
      const v = getter();
      if (document.activeElement !== input) input.value = v;
      input.style.setProperty('--fill', `${((v - spec.min) / (spec.max - spec.min)) * 100}%`);
      value.textContent = formatNumber(v, { unit: spec.unit, signed, digits });
    };
    this.syncers.push(update);
    return h(
      'div',
      { class: 'field' },
      h('div', { class: 'field__row' }, h('label', { for: id, text: label }), value),
      input,
      hint ? h('p', { class: 'field__hint', text: hint }) : null,
    );
  }

  select(key, label, options) {
    const id = `set-${key}`;
    const sel = h('select', { class: 'select', id }, options.map(([v, l]) => h('option', { value: v, text: l })));
    sel.addEventListener('change', () => this.store.set({ [key]: clampSetting(key, sel.value) }));
    this.syncers.push(() => {
      sel.value = this.store.get()[key];
    });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), sel);
  }

  sync() {
    this.syncers.forEach((fn) => fn());
    this.renderLetters();
    // measuring re-rasterises every letter: debounce while sliders move
    clearTimeout(this.readoutTimer);
    this.readoutTimer = setTimeout(() => this.updateReadout(), 160);
  }

  updateReadout() {
    if (!this.engine.fontReady) return;
    const m = this.engine.measureStrokes(this.store.get());
    this.readout.textContent = t('strokeReadout', { hand: m.hand.toFixed(2), typed: m.typed.toFixed(2) });
  }

  matchStroke() {
    const s = this.store.get();
    const v = this.engine.recommendTypedStroke(s);
    this.store.set({ typedStroke: clampSetting('typedStroke', Math.round(v * 100) / 100) });
  }

  currentLetter() {
    const { wordId } = this.getContext();
    const plan = this.engine.plan(wordId, this.store.get());
    return plan[this.selectedLetter] || plan[0];
  }

  /**
   * Rebuild the letter editor only when its structure changes (word, selected
   * letter, style, sample). Value changes just update the existing controls so
   * a slider is never replaced while it is being dragged.
   */
  renderLetters(force = false) {
    const g = this.lettersGroup;
    if (!g) return;
    const { wordId, random } = this.getContext();
    if (wordId !== this.lastWord) {
      this.selectedLetter = 0;
      this.lastWord = wordId;
    }
    const plan = random || !wordId ? null : this.engine.plan(wordId, this.store.get());
    const key = JSON.stringify([random, wordId, this.selectedLetter, plan?.map((l) => [l.style, l.sample?.id])]);
    if (!force && key === this.letterKey) {
      this.letterSyncers.forEach((fn) => fn());
      return;
    }
    this.letterKey = key;
    this.letterSyncers = [];

    g.replaceChildren();
    if (!plan) {
      g.append(h('p', { class: 'letters-locked', text: t('lettersLocked') }));
      return;
    }
    const strip = h('div', { class: 'letter-strip', role: 'group', 'aria-label': t('groupLetters') });
    plan.forEach((l) => {
      strip.append(
        h(
          'button',
          {
            type: 'button',
            class: 'letter-chip',
            lang: 'ar',
            dataset: { style: l.style, index: String(l.index) },
            'aria-pressed': String(l.index === this.selectedLetter),
            title: `${l.char} – ${t(`form_${l.form}`)} – ${t(l.style)}`,
            onclick: () => {
              this.selectedLetter = l.index;
              this.renderLetters();
              g.querySelector(`.letter-chip[data-index="${l.index}"]`)?.focus();
            },
          },
          h('span', { class: 'letter-chip__glyph' }, formGlyphLabel(l.char, l.form)),
          h('span', { class: 'letter-chip__source', dir: 'ltr' }, l.style === 'handwritten' ? l.sample.id : t('sourceCairo')),
        ),
      );
    });
    g.append(strip);
    const editor = h('div', { class: 'letter-editor' });
    const colA = h('div', { class: 'letter-editor__col' });
    const colB = h('div', { class: 'letter-editor__col' });
    editor.append(colA, colB);
    g.append(editor);

    const l = plan[this.selectedLetter] || plan[0];
    const index = l.index;
    const setChar = (patch) => this.store.setCharacter(wordId, index, patch);
    const canHand = l.handwrittenOptions.length > 0;

    const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': t('letterType') });
    for (const style of ['handwritten', 'typed']) {
      seg.append(
        h(
          'button',
          {
            type: 'button',
            dataset: { style },
            'aria-pressed': String(l.style === style),
            disabled: style === 'handwritten' && !canHand,
            onclick: () => setChar({ style }),
          },
          t(style),
        ),
      );
    }
    colA.append(h('div', { class: 'field' }, h('span', { text: t('letterType') }), seg));
    if (!canHand) colA.append(h('p', { class: 'note', text: t('noSample') }));

    if (l.style === 'handwritten' && l.handwrittenOptions.length > 1) {
      const id = 'set-letter-sample';
      const sel = h(
        'select',
        { class: 'select', id },
        l.handwrittenOptions.map((s) => h('option', { value: s.id, text: `${s.id} (${s.image.width}×${s.image.height})` })),
      );
      sel.value = l.sample?.id;
      sel.addEventListener('change', () => setChar({ sample: sel.value }));
      colA.append(h('div', { class: 'field' }, h('label', { for: id, text: t('sampleLabel') }), sel));
    }

    const charSlider = (key, label, opts = {}) =>
      this.slider(key, label, {
        ...opts,
        specs: CHARACTER_SPECS,
        read: () => this.currentLetter().adjust[key],
        write: (v) => setChar({ [key]: clampSetting(key, v, CHARACTER_SPECS) }),
      });
    const before = this.syncers.length;
    colA.append(charSlider('scale', t('charScale')));
    g.append(
      h('button', { class: 'btn btn--small btn--quiet letter-reset', type: 'button', onclick: () => this.store.resetCharacters(wordId) }, t('resetLetters')),
    );
    colB.append(
      charSlider('offsetX', t('offsetX'), { signed: true, digits: 0 }),
      charSlider('offsetY', t('offsetY'), { signed: true, digits: 0 }),
    );
    // keep letter-slider updaters separate from the global ones
    this.letterSyncers = this.syncers.splice(before);
    this.letterSyncers.forEach((fn) => fn());
  }

  /** Current tuning as JSON fragments matching composition.json / words.json. */
  exportJSON() {
    const s = this.store.get();
    return {
      'composition.json': {
        typed: { thickness: s.typedStroke },
        handwritten: { thickness: s.handStroke },
        layout: { size: s.size, spacing: s.spacing, overlap: s.overlap, baselineMode: s.baselineMode, verticalOffset: s.verticalOffset },
        render: { background: s.background },
      },
      'words.json (per-letter overrides by word id and letter index)': s.characters,
    };
  }
}
