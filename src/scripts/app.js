/**
 * Application controller: wires configuration, engine and interface together.
 * Contains no composition logic of its own.
 */
import { loadAllData } from './data-loader.js';
import { LetterDatabase } from './letter-database.js';
import { WordDatabase } from './word-database.js';
import { CaptchaEngine } from './captcha-engine.js';
import { defaultSettings, createStore } from './settings.js';
import { setLanguage, getLanguage, t } from './i18n.js';
import { SettingsPanel } from './ui/settings-panel.js';
import { Gallery } from './ui/gallery.js';
import { h } from './ui/dom.js';

const $ = (sel) => document.querySelector(sel);
const RANDOM = 'random';

const ui = {
  canvas: $('#captcha-canvas'),
  stage: document.querySelector('.stage'),
  loading: $('#stage-loading'),
  picker: document.querySelector('.word-picker'),
  refresh: $('#refresh-btn'),
  download: $('#download-btn'),
  guides: $('#guides-toggle'),
  legend: $('#legend'),
  randomHint: $('#random-hint'),
  form: $('#answer-form'),
  input: $('#answer-input'),
  status: $('#status'),
  warnings: $('#warnings'),
  lang: $('#lang-toggle'),
};

const app = {
  mode: RANDOM, // RANDOM or a word id
  wordId: null, // word currently rendered
  seed: newSeed(),
  last: null,
};

function newSeed() {
  return (Math.random() * 2 ** 32) >>> 0;
}

function pickRandomWord(words, avoid) {
  const ids = words.ids();
  const pool = ids.length > 1 ? ids.filter((id) => id !== avoid) : ids;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function main() {
  initLanguage();
  const base = document.baseURI;
  let data;
  let engine;
  try {
    data = await loadAllData(base);
    const letters = new LetterDatabase(data.letters);
    const words = new WordDatabase(data.words, letters);
    for (const p of [...letters.validate(), ...words.validate()]) console.warn('[config]', p);
    engine = new CaptchaEngine({ letters, words, composition: data.composition, baseUrl: base });
    await engine.load();
  } catch (err) {
    console.error(err);
    ui.loading.textContent = t('loadError', { msg: err.message });
    return;
  }
  ui.loading.hidden = true;

  const defaults = defaultSettings(data.composition);
  const store = createStore(defaults);
  const { words, letters } = engine;

  // ----- word picker -----
  const options = [{ id: RANDOM, label: () => t('randomWord'), lang: null }, ...words.all().map((w) => ({ id: w.id, label: () => w.word, lang: 'ar' }))];
  const buildPicker = () => {
    ui.picker.querySelectorAll('.word-picker__option').forEach((b) => b.remove());
    for (const o of options) {
      ui.picker.append(
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'word-picker__option',
            lang: o.lang || false,
            dir: o.lang ? 'rtl' : false,
            dataset: { word: o.id },
            'aria-checked': String(app.mode === o.id),
            onclick: () => selectMode(o.id),
          },
          o.label(),
        ),
      );
    }
  };

  // ----- rendering (coalesced to one frame) -----
  let frame = 0;
  const scheduleRender = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };
  function render() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    app.last = engine.render(ui.canvas, { wordId: app.wordId, settings: store.get(), seed: app.seed, dpr });
    const random = app.mode === RANDOM;
    const warnings = random ? [] : app.last.plan.filter((l) => l.warning).map((l) => t('warningFallback', { char: l.char, msg: l.warning }));
    ui.warnings.hidden = warnings.length === 0;
    ui.warnings.textContent = warnings.join(' ');
    ui.legend.hidden = !store.get().showGuides;
    ui.randomHint.hidden = !random || store.get().showGuides;
  }

  function newCaptcha({ keepWord = false } = {}) {
    if (app.mode === RANDOM && !keepWord) app.wordId = pickRandomWord(words, app.wordId);
    app.seed = newSeed();
    clearStatus();
    ui.input.value = '';
    scheduleRender();
  }

  function selectMode(mode) {
    app.mode = mode;
    app.wordId = mode === RANDOM ? pickRandomWord(words, app.wordId) : mode;
    ui.picker.querySelectorAll('.word-picker__option').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.word === mode)));
    newCaptcha({ keepWord: true });
    panel.sync();
  }

  // ----- verification -----
  function clearStatus() {
    ui.status.textContent = '';
    ui.status.className = 'status';
    ui.input.removeAttribute('aria-invalid');
  }
  function showStatus(kind, msg) {
    ui.status.className = `status status--${kind}`;
    ui.status.textContent = msg;
    void ui.status.offsetWidth; // restart the small entrance animation
    ui.status.classList.add('is-new');
  }
  ui.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = ui.input.value.trim();
    if (!value) {
      ui.input.setAttribute('aria-invalid', 'true');
      showStatus('error', t('errorEmpty'));
      ui.input.focus();
      return;
    }
    if (engine.verify(value)) {
      ui.input.removeAttribute('aria-invalid');
      showStatus('success', t('success'));
    } else {
      ui.input.setAttribute('aria-invalid', 'true');
      showStatus('error', t('errorWrong'));
    }
  });
  ui.input.addEventListener('input', () => {
    if (ui.input.getAttribute('aria-invalid')) clearStatus();
  });

  // ----- tools -----
  ui.refresh.addEventListener('click', () => {
    ui.refresh.classList.remove('is-spinning');
    void ui.refresh.offsetWidth;
    ui.refresh.classList.add('is-spinning');
    newCaptcha();
  });
  ui.guides.addEventListener('change', () => store.set({ showGuides: ui.guides.checked }));
  ui.download.addEventListener('click', () => {
    ui.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = h('a', { href: URL.createObjectURL(blob), download: `arabic-hybrid-captcha-${app.seed}.png` });
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
    }, 'image/png');
  });

  // ----- panels -----
  const panel = new SettingsPanel($('#settings-root'), {
    lettersRoot: $('#letters-root'),
    store,
    engine,
    getContext: () => ({ wordId: app.mode === RANDOM ? null : app.wordId, random: app.mode === RANDOM }),
    onReset: () => {
      store.reset(defaults);
      ui.guides.checked = false;
    },
  });
  const gallery = new Gallery({
    grid: $('#gallery-grid'),
    dialog: $('#preview-dialog'),
    content: $('#preview-content'),
    letters,
    engine,
    baseUrl: base,
  });
  gallery.render();
  store.subscribe(scheduleRender);

  ui.lang.addEventListener('click', () => {
    const next = getLanguage() === 'ar' ? 'en' : 'ar';
    setLanguage(next);
    try {
      localStorage.setItem('ahc-lang', next);
    } catch {
      /* storage unavailable: language just isn't remembered */
    }
    buildPicker();
    panel.build();
    gallery.render();
    if (ui.status.textContent) clearStatus();
    scheduleRender();
  });

  window.addEventListener('resize', () => {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    if (app.last && app.last.dpr !== dpr) scheduleRender();
  });

  buildPicker();
  selectMode(RANDOM);

  // Debug hook for automated tests and research (?debug in the URL).
  if (new URLSearchParams(location.search).has('debug')) {
    window.__ahc = { engine, store, app, render: () => render() };
  }
  document.documentElement.dataset.ready = 'true';
}

function initLanguage() {
  let lang = 'en';
  try {
    lang = localStorage.getItem('ahc-lang') || 'en';
  } catch {
    lang = 'en';
  }
  const q = new URLSearchParams(location.search).get('lang');
  if (q) lang = q;
  setLanguage(lang);
}

main();
