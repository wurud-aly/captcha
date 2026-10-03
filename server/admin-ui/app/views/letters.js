/**
 * Letters view: library grid, upload, and the per-image editor.
 * Original image files are never modified; everything edited here is stored in
 * letters.json (identification, baseline/connection points, display adjustments).
 */
import { formGlyphLabel, FORMS } from '../../../src/scripts/arabic-joining.js';
import { inkFromRGBA, inkBox, estimateStrokeWidth, inkSum, suggestAnchors } from '../../../src/scripts/image-processor.js';
import { h, t, toast, confirmDialog, slider, selectField, numberInput, segmented, section, badge, checkerboard, randomRef } from '../ui.js';

export const ARABIC_LETTERS = 'ا أ إ آ ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي ى ة ؤ ئ'.split(' ');
const MAX_BYTES = 2 * 1024 * 1024;

/* ------------------------------------------------------------ image checks */

/** Validate a PNG in the browser (the server repeats every check). */
export async function inspectPng(file) {
  if (file.size > MAX_BYTES) throw new Error(t('err_too_big'));
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => head[i] === b)) throw new Error(t('err_not_png'));
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(t('err_not_png'));
  }
  const w = img.naturalWidth;
  const hgt = img.naturalHeight;
  if (w < 16 || hgt < 16 || w > 1200 || hgt > 1200) {
    URL.revokeObjectURL(url);
    throw new Error(t('err_dims'));
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, hgt).data;
  let border = 0;
  let clear = 0;
  for (let y = 0; y < hgt; y++)
    for (let x = 0; x < w; x++)
      if (x === 0 || y === 0 || x === w - 1 || y === hgt - 1) {
        border++;
        if (rgba[(y * w + x) * 4 + 3] < 16) clear++;
      }
  if (clear / border < 0.95) {
    URL.revokeObjectURL(url);
    throw new Error(t('err_not_transparent'));
  }
  const ink = inkFromRGBA(rgba);
  if (inkSum(ink) < 20) {
    URL.revokeObjectURL(url);
    throw new Error(t('err_empty'));
  }
  const data = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
  return { url, data, name: file.name, width: w, height: hgt, ink, img };
}

/** Measurements for the draft (the server recomputes them from the file on save). */
function measure(info, form) {
  const { ink, width, height } = info;
  const anchors = suggestAnchors(ink, width, height, form);
  return {
    image: { width, height },
    inkBox: inkBox(ink, width, height),
    analysis: { strokeWidth: Math.round(estimateStrokeWidth(ink, width, height) * 100) / 100, inkCoverage: Math.round(inkSum(ink) * 10) / 10 },
    baseline: anchors.baseline,
    anchors: { entry: anchors.entry, exit: anchors.exit },
  };
}

function inkOfImage(img, w, hgt) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return inkFromRGBA(ctx.getImageData(0, 0, w, hgt).data);
}

function nextSampleId(state) {
  let n = state.letters.samples.length + 1;
  const ids = new Set(state.letters.samples.map((s) => s.id));
  while (ids.has(`hw-${String(n).padStart(2, '0')}`)) n++;
  return `hw-${String(n).padStart(2, '0')}`;
}

const label = (s) => (s.status === 'identified' && s.character ? formGlyphLabel(s.character, s.form) : t('unknown'));

/* ------------------------------------------------------------ view */

export function renderLetters(root, ctx, param) {
  if (param === 'new') return renderUpload(root, ctx);
  const state = ctx.draft.get();
  const sample = param && state.letters.samples.find((s) => s.id === param);
  if (sample) return renderEditor(root, ctx, sample.id);
  return renderLibrary(root, ctx);
}

function renderLibrary(root, ctx) {
  const state = ctx.draft.get();
  const saved = new Map(ctx.draft.saved.letters.samples.map((s) => [s.id, JSON.stringify(s)]));
  const savedFiles = new Map(ctx.draft.saved.letters.samples.map((s) => [s.id, s.file]));
  const filter = ctx.viewState.letterFilter || 'all';
  const grid = h('ul', { class: 'adm-grid', id: 'letter-grid' });
  for (const s of state.letters.samples) {
    if (filter !== 'all' && s.status !== filter) continue;
    const used = ctx.preview.wordsUsing(s.id).map((w) => w.word);
    const isNew = !saved.has(s.id);
    const status = isNew ? badge(t('badgeNew'), 'new') : savedFiles.get(s.id) !== s.file ? badge(t('badgeReplaced'), 'changed') : saved.get(s.id) !== JSON.stringify(s) ? badge(t('badgeChanged'), 'changed') : null;
    grid.append(
      h(
        'li',
        {},
        h(
          'a',
          { class: `tile${s.status === 'identified' ? '' : ' tile--unknown'}`, href: `#letters/${s.id}`, dataset: { sample: s.id } },
          h('span', { class: 'tile__image' }, h('img', { src: ctx.preview.urlFor(s), alt: '', width: s.image.width, height: s.image.height })),
          h(
            'span',
            { class: 'tile__body' },
            h('span', { class: 'tile__head' }, h('span', { class: 'tile__glyph', lang: 'ar' }, label(s)), h('span', { class: 'tile__id' }, s.id)),
            h('span', { class: 'tile__meta' }, t(`form_${s.form}`), status),
            h('span', { class: 'tile__dims' }, used.length ? t('usedIn', { list: used.join('، ') }) : t('notUsed')),
          ),
        ),
      ),
    );
  }
  const filters = h('div', { class: 'segmented adm-filter', role: 'group' });
  for (const [v, k] of [['all', 'filterAll'], ['identified', 'filterIdentified'], ['unknown', 'filterUnknown']]) {
    filters.append(
      h('button', { type: 'button', 'aria-pressed': String(filter === v), onclick: () => ((ctx.viewState.letterFilter = v), ctx.rerender()) }, t(k)),
    );
  }
  root.replaceChildren(
    h(
      'div',
      { class: 'adm-head' },
      h('div', {}, h('h1', { class: 'adm-h1' }, t('lettersTitle')), h('p', { class: 'adm-muted' }, t('lettersIntro'))),
      h('a', { class: 'btn btn--primary', href: '#letters/new', id: 'upload-link' }, t('upload')),
    ),
    filters,
    grid,
  );
}

/* ------------------------------------------------------------ upload */

function renderUpload(root, ctx) {
  const state = ctx.draft.get();
  let info = null;
  const form = { character: 'ب', form: 'initial', writerId: state.letters.writers[0]?.id || 'writer-01', confidence: 'high' };
  const fileInput = h('input', { type: 'file', id: 'upload-file', accept: 'image/png,.png', class: 'adm-file' });
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const canvas = h('canvas', { class: 'adm-canvas adm-canvas--square', width: 480, height: 480 });
  const addBtn = h('button', { class: 'btn btn--primary', type: 'button', id: 'add-letter', disabled: true }, t('addToLibrary'));

  const draw = () => {
    const c = canvas.getContext('2d');
    checkerboard(c, canvas.width, canvas.height);
    if (!info) return;
    const sc = Math.min(canvas.width / info.width, canvas.height / info.height) * 0.92;
    c.drawImage(info.img, (canvas.width - info.width * sc) / 2, (canvas.height - info.height * sc) / 2, info.width * sc, info.height * sc);
  };
  draw();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    addBtn.disabled = true;
    try {
      info = await inspectPng(file);
      status.className = 'status status--success';
      status.textContent = t('checksOk', { w: info.width, h: info.height });
      addBtn.disabled = false;
    } catch (e) {
      info = null;
      status.className = 'status status--error';
      status.textContent = e.message;
    }
    draw();
  });

  addBtn.addEventListener('click', () => {
    if (!info) return;
    const ref = randomRef();
    ctx.draft.addImage(ref, { url: info.url, data: info.data, name: info.name });
    const id = nextSampleId(ctx.draft.get());
    const m = measure(info, form.form);
    ctx.draft.change(
      (s) => {
        s.letters.samples.push({
          id,
          file: ref,
          style: 'handwritten',
          status: 'identified',
          character: form.character,
          form: form.form,
          confidence: form.confidence,
          writerId: form.writerId,
          variant: 1,
          ...m,
          adjust: { offsetX: 0, offsetY: 0, scale: 1, thickness: 0 },
          notes: '',
          source: { collection: 'admin-upload' },
        });
      },
      { structural: true },
    );
    location.hash = `#letters/${id}`;
  });

  root.replaceChildren(
    h('div', { class: 'adm-head' }, h('div', {}, h('a', { class: 'adm-link', href: '#letters' }, t('back')), h('h1', { class: 'adm-h1' }, t('newLetterTitle')))),
    h(
      'div',
      { class: 'adm-two' },
      section(t('chooseFile'), t('uploadRules'), h('label', { class: 'btn adm-filebtn', for: 'upload-file' }, t('chooseFile')), fileInput, status, canvas),
      section(
        t('identification'),
        null,
        selectField({ id: 'new-char', label: t('letter'), options: ARABIC_LETTERS.map((c) => [c, c]), value: form.character, onChange: (v) => (form.character = v) }),
        selectField({ id: 'new-form', label: t('form'), options: FORMS.map((f) => [f, t(`form_${f}`)]), value: form.form, onChange: (v) => (form.form = v) }),
        selectField({ id: 'new-conf', label: t('confidence'), options: ['high', 'medium', 'low'].map((c) => [c, t(`conf_${c}`)]), value: form.confidence, onChange: (v) => (form.confidence = v) }),
        selectField({ id: 'new-writer', label: t('writer'), options: state.letters.writers.map((w) => [w.id, w.label]), value: form.writerId, onChange: (v) => (form.writerId = v) }),
        addBtn,
      ),
    ),
  );
}

/* ------------------------------------------------------------ editor */

function renderEditor(root, ctx, id) {
  const { draft, preview } = ctx;
  const get = () => draft.get().letters.samples.find((s) => s.id === id);
  const s = get();
  const tool = { mode: ctx.viewState.letterTool || 'none' };
  const set = (patch, key, structural = false) =>
    draft.change((st) => Object.assign(st.letters.samples.find((x) => x.id === id), patch), { key: key && `${id}:${key}`, structural });
  const setDeep = (fn, key, structural = false) => draft.change((st) => fn(st.letters.samples.find((x) => x.id === id)), { key: key && `${id}:${key}`, structural });

  /* --- before canvas (original image + editable geometry) --- */
  const before = h('canvas', { class: 'adm-canvas adm-canvas--square adm-canvas--edit', width: 520, height: 520, id: 'before-canvas' });
  const fit = () => {
    const cur = get();
    const sc = (before.width * 0.9) / Math.max(cur.image.width, cur.image.height);
    return { sc, ox: (before.width - cur.image.width * sc) / 2, oy: (before.height - cur.image.height * sc) / 2 };
  };
  const drawBefore = () => {
    const cur = get();
    const c = before.getContext('2d');
    checkerboard(c, before.width, before.height, 16);
    const img = preview.engine.imageFor(cur.id);
    const { sc, ox, oy } = fit();
    if (img) c.drawImage(img, ox, oy, cur.image.width * sc, cur.image.height * sc);
    const X = (x) => ox + x * sc;
    const Y = (y) => oy + y * sc;
    c.lineWidth = 2;
    if (cur.inkBox) {
      c.strokeStyle = 'rgba(20,149,138,.8)';
      c.strokeRect(X(cur.inkBox.x), Y(cur.inkBox.y), cur.inkBox.w * sc, cur.inkBox.h * sc);
    }
    c.setLineDash([8, 6]);
    c.strokeStyle = 'rgba(214,64,64,.85)';
    c.beginPath();
    c.moveTo(X(0), Y(cur.baseline));
    c.lineTo(X(cur.image.width), Y(cur.baseline));
    c.stroke();
    c.setLineDash([]);
    for (const [a, col] of [[cur.anchors.entry, '#2563eb'], [cur.anchors.exit, '#c2410c']]) {
      if (!a) continue;
      c.fillStyle = col;
      c.beginPath();
      c.arc(X(a.x), Y(a.y), 9, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#fff';
      c.stroke();
    }
  };
  before.addEventListener('click', (e) => {
    if (tool.mode === 'none') return;
    const r = before.getBoundingClientRect();
    const { sc, ox, oy } = fit();
    const x = Math.round((((e.clientX - r.left) / r.width) * before.width - ox) / sc * 10) / 10;
    const y = Math.round((((e.clientY - r.top) / r.height) * before.height - oy) / sc * 10) / 10;
    const cur = get();
    const cx = Math.max(0, Math.min(cur.image.width, x));
    const cy = Math.max(0, Math.min(cur.image.height, y));
    if (tool.mode === 'baseline') set({ baseline: cy }, 'baseline');
    else setDeep((x2) => (x2.anchors = { ...x2.anchors, [tool.mode]: { x: cx, y: cy } }), tool.mode);
    syncAll();
  });

  /* --- after canvas (processed piece as it is drawn in the CAPTCHA) --- */
  const after = h('canvas', { class: 'adm-canvas adm-canvas--square', width: 520, height: 520, id: 'after-canvas' });
  const drawAfter = () => {
    const cur = get();
    const c = after.getContext('2d');
    c.fillStyle = '#efe9dc';
    c.fillRect(0, 0, after.width, after.height);
    const img = preview.engine.imageFor(cur.id);
    if (!img) return;
    const comp = draft.get().composition;
    const k = 2;
    const scale = k * (comp.handwritten?.scale ?? 1) * cur.adjust.scale;
    const piece = preview.engine.factory.handwritten(cur, img, scale, {
      thickness: ((comp.handwritten?.thickness ?? 0) + cur.adjust.thickness) * k,
      inkColor: comp.render?.inkColor || '#1d2430',
    });
    const fitScale = Math.min(1, (after.width * 0.9) / piece.width, (after.height * 0.9) / piece.height);
    const ox = (after.width - piece.width * fitScale) / 2 + cur.adjust.offsetX * k * fitScale;
    const oy = (after.height - piece.height * fitScale) / 2 + cur.adjust.offsetY * k * fitScale;
    c.drawImage(piece.canvas, ox, oy, piece.width * fitScale, piece.height * fitScale);
    c.setLineDash([6, 6]);
    c.strokeStyle = 'rgba(214,64,64,.55)';
    c.beginPath();
    c.moveTo(0, oy + piece.baseline * fitScale);
    c.lineTo(after.width, oy + piece.baseline * fitScale);
    c.stroke();
    c.setLineDash([]);
  };

  /* --- in context: every word that uses this sample --- */
  const contextBox = h('div', { class: 'adm-context', id: 'letter-context' });
  const drawContext = () => {
    const words = preview.wordsUsing(id);
    if (!words.length) {
      contextBox.replaceChildren(h('p', { class: 'adm-muted' }, t('notUsed')));
      return;
    }
    contextBox.replaceChildren(
      ...words.map((w) => {
        const cv = h('canvas', { class: 'adm-canvas adm-canvas--wide' });
        preview.render(cv, w.id, { guides: true });
        return h('figure', { class: 'adm-fig' }, cv, h('figcaption', { lang: 'ar' }, w.word));
      }),
    );
  };

  const sliders = [];
  const syncAll = () => {
    drawBefore();
    drawAfter();
    sliders.forEach((x) => x.sync());
    numbers.replaceChildren(...geometryInputs());
  };
  ctx.onPreview(() => {
    drawBefore();
    drawAfter();
    drawContext();
  });

  /* --- tools --- */
  const toolBar = h('div', { class: 'segmented adm-tools', role: 'group', 'aria-label': t('tools') });
  const needs = (form, k) => (k === 'entry' ? form === 'medial' || form === 'final' : form === 'medial' || form === 'initial');
  for (const [mode, key] of [['none', 'toolNone'], ['baseline', 'toolBaseline'], ['entry', 'toolEntry'], ['exit', 'toolExit']]) {
    toolBar.append(
      h(
        'button',
        {
          type: 'button',
          dataset: { tool: mode },
          'aria-pressed': String(tool.mode === mode),
          disabled: (mode === 'entry' || mode === 'exit') && !needs(s.form, mode),
          onclick: (e) => {
            tool.mode = mode;
            ctx.viewState.letterTool = mode;
            toolBar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            before.dataset.tool = mode;
          },
        },
        t(key),
      ),
    );
  }
  before.dataset.tool = tool.mode;
  const autoBtn = h('button', { type: 'button', class: 'btn btn--small', id: 'auto-detect' }, t('autoDetect'));
  autoBtn.addEventListener('click', () => {
    const cur = get();
    const img = preview.engine.imageFor(cur.id);
    const a = suggestAnchors(inkOfImage(img, cur.image.width, cur.image.height), cur.image.width, cur.image.height, cur.form);
    set({ baseline: a.baseline, anchors: { entry: a.entry, exit: a.exit } }, null);
    syncAll();
  });

  /* --- geometry numbers --- */
  const numbers = h('div', { class: 'adm-geo' });
  function geometryInputs() {
    const cur = get();
    const out = [
      numberInput({ id: 'geo-baseline', label: t('baseline'), value: cur.baseline, min: 0, max: cur.image.height, onChange: (v) => (set({ baseline: v }, 'baseline'), syncAll()) }),
    ];
    for (const k of ['entry', 'exit']) {
      const a = cur.anchors[k];
      const ok = needs(cur.form, k);
      out.push(
        h(
          'div',
          { class: 'adm-geo__pair' },
          h('span', { class: `adm-dotlabel adm-dotlabel--${k}` }, t(k)),
          ok
            ? [
                numberInput({ id: `geo-${k}-x`, label: 'x', value: a?.x ?? '', min: 0, max: cur.image.width, onChange: (v) => (setDeep((x) => (x.anchors[k] = { x: v, y: x.anchors[k]?.y ?? x.baseline }), k), syncAll()) }),
                numberInput({ id: `geo-${k}-y`, label: 'y', value: a?.y ?? '', min: 0, max: cur.image.height, onChange: (v) => (setDeep((x) => (x.anchors[k] = { x: x.anchors[k]?.x ?? 0, y: v }), k), syncAll()) }),
              ]
            : h('span', { class: 'adm-muted' }, t('notNeeded')),
        ),
      );
    }
    return out;
  }
  numbers.replaceChildren(...geometryInputs());

  /* --- identification --- */
  const charOptions = [['', t('unknownOption')], ...ARABIC_LETTERS.map((c) => [c, c])];
  const ident = section(
    t('identification'),
    null,
    selectField({
      id: 'edit-char',
      label: t('letter'),
      options: charOptions,
      value: s.status === 'identified' ? s.character : '',
      onChange: (v) => set(v ? { status: 'identified', character: v } : { status: 'unknown', character: null }, null, true),
    }),
    selectField({
      id: 'edit-form',
      label: t('form'),
      options: FORMS.map((f) => [f, t(`form_${f}`)]),
      value: s.form,
      onChange: (v) =>
        setDeep(
          (x) => {
            x.form = v;
            const img = preview.engine.imageFor(x.id);
            const a = suggestAnchors(inkOfImage(img, x.image.width, x.image.height), x.image.width, x.image.height, v);
            x.anchors = { entry: needs(v, 'entry') ? x.anchors.entry || a.entry : null, exit: needs(v, 'exit') ? x.anchors.exit || a.exit : null };
          },
          null,
          true,
        ),
    }),
    selectField({ id: 'edit-conf', label: t('confidence'), options: ['high', 'medium', 'low'].map((c) => [c, t(`conf_${c}`)]), value: s.confidence, onChange: (v) => set({ confidence: v }, null) }),
    selectField({ id: 'edit-writer', label: t('writer'), options: draft.get().letters.writers.map((w) => [w.id, w.label]), value: s.writerId, onChange: (v) => set({ writerId: v }, null) }),
    (() => {
      const ta = h('textarea', { class: 'adm-input adm-textarea', id: 'edit-notes', rows: 3, maxlength: 1000, dir: 'auto' });
      ta.value = s.notes || '';
      ta.addEventListener('input', () => set({ notes: ta.value }, 'notes'));
      return h('label', { class: 'field', for: 'edit-notes' }, h('span', {}, t('notes')), ta);
    })(),
  );

  /* --- display adjustments (stored separately from the image) --- */
  const adj = (key, labelKey, min, max, step, unit, digits = 1, signed = true) => {
    const sl = slider({
      id: `adj-${key}`,
      label: t(labelKey),
      min,
      max,
      step,
      unit,
      digits,
      signed,
      get: () => get().adjust[key],
      set: (v) => setDeep((x) => (x.adjust = { ...x.adjust, [key]: v }), `adj-${key}`),
    });
    sliders.push(sl);
    return sl.el;
  };
  const display = section(
    t('display'),
    t('displayHint'),
    adj('scale', 'scale', 0.3, 3, 0.05, '×', 2, false),
    adj('offsetX', 'offsetX', -60, 60, 1, 'px', 0),
    adj('offsetY', 'offsetY', -60, 60, 1, 'px', 0),
    adj('thickness', 'thickness', -1, 2, 0.1, 'px', 1),
  );

  /* --- replace / delete --- */
  const replaceInput = h('input', { type: 'file', accept: 'image/png,.png', id: 'replace-file', class: 'adm-file' });
  replaceInput.addEventListener('change', async () => {
    const file = replaceInput.files[0];
    if (!file) return;
    try {
      const info = await inspectPng(file);
      const ref = randomRef();
      draft.addImage(ref, { url: info.url, data: info.data, name: info.name });
      const m = measure(info, get().form);
      setDeep((x) => Object.assign(x, { file: ref }, m), null, true);
      toast(t('replaced'), 'info', 7000);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
  const delBtn = h('button', { type: 'button', class: 'btn adm-danger', id: 'delete-letter' }, t('delete'));
  delBtn.addEventListener('click', async () => {
    const used = preview.wordsUsing(id);
    const ok = await confirmDialog(
      t('deleteTitle', { id }),
      t('deleteBody'),
      used.length ? t('deleteAffects', { list: used.map((w) => w.word).join('، ') }) : null,
      t('deleteKeepsFile'),
    );
    if (!ok) return;
    const affected = new Set(used.map((w) => w.id));
    draft.change(
      (st) => {
        st.letters.samples = st.letters.samples.filter((x) => x.id !== id);
        for (const w of st.words.words) {
          if (!affected.has(w.id)) continue;
          // letters that resolved to the deleted sample become typed
          const plan = preview.engine.words.resolve(w.id);
          plan.forEach((l, i) => {
            if (l.sample?.id === id) {
              w.characters[i].style = 'typed';
              delete w.characters[i].sample;
            }
          });
        }
      },
      { structural: true },
    );
    location.hash = '#letters';
  });

  root.replaceChildren(
    h(
      'div',
      { class: 'adm-head' },
      h(
        'div',
        {},
        h('a', { class: 'adm-link', href: '#letters' }, t('back')),
        h('h1', { class: 'adm-h1' }, h('span', { lang: 'ar', class: 'adm-glyph' }, label(s)), ' ', t('editLetter', { id })),
        h('p', { class: 'adm-muted', dir: 'ltr' }, s.file.startsWith('pending:') ? `${draft.images.get(s.file)?.name || 'upload'} (unsaved)` : s.file),
      ),
      h('div', { class: 'adm-head__actions' }, h('label', { class: 'btn', for: 'replace-file' }, t('replace')), replaceInput, delBtn),
    ),
    h(
      'div',
      { class: 'adm-two' },
      section(t('before'), t('toolHint'), toolBar, before, h('div', { class: 'adm-row' }, autoBtn)),
      section(t('after'), null, after),
    ),
    section(t('inContext'), null, contextBox),
    h('div', { class: 'adm-two' }, h('div', { class: 'adm-stack' }, ident, section(t('geometry'), null, numbers)), display),
  );
  drawBefore();
  drawAfter();
  drawContext();
}
