/**
 * Handwritten character gallery + preview dialog. Uses the original image files
 * exactly as supplied (no processing), so what you see here is the raw asset.
 */
import { formGlyphLabel } from '../arabic-joining.js';
import { t } from '../i18n.js';
import { h } from './dom.js';
import { readInk, estimateStrokeWidth } from '../image-processor.js';

export class Gallery {
  /**
   * @param {{grid:HTMLElement, dialog:HTMLDialogElement, content:HTMLElement,
   *          letters:import('../letter-database.js').LetterDatabase,
   *          engine:import('../captcha-engine.js').CaptchaEngine, baseUrl:string}} deps
   */
  constructor({ grid, dialog, content, letters, engine, baseUrl }) {
    Object.assign(this, { grid, dialog, content, letters, engine, baseUrl });
    this.showAnchors = true;
    this.current = null;
    this.strokeCache = new Map();
    dialog.querySelector('#preview-close')?.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close(); // click on backdrop
    });
  }

  render() {
    this.grid.replaceChildren(
      ...this.letters.all().map((s) => {
        const known = s.status === 'identified';
        const tile = h(
          'button',
          {
            type: 'button',
            class: `tile${known ? '' : ' tile--unknown'}`,
            dataset: { sample: s.id },
            'aria-label': `${s.id}: ${known ? s.character : t('unknown')}${t('listSep')}${t(`form_${s.form}`)}`,
            onclick: () => this.open(s),
          },
          h('span', { class: 'tile__image' }, h('img', { src: new URL(s.file, this.baseUrl).href, alt: '', width: s.image.width, height: s.image.height, loading: 'lazy' })),
          h(
            'span',
            { class: 'tile__body' },
            h(
              'span',
              { class: 'tile__head' },
              known
                ? h('span', { class: 'tile__glyph', lang: 'ar', dir: 'rtl' }, formGlyphLabel(s.character, s.form))
                : h('span', { class: 'tile__glyph' }, t('unknown')),
              h('span', { class: 'tile__id' }, s.id),
            ),
            h('span', { class: 'tile__meta' }, `${t('handwritten')}${t('listSep')}${t(`form_${s.form}`)}`),
            h('span', { class: 'tile__dims' }, `${s.image.width} × ${s.image.height} px`),
          ),
        );
        return h('li', {}, tile);
      }),
    );
    if (this.dialog.open && this.current) this.open(this.current);
  }

  open(sample) {
    this.current = sample;
    const s = sample;
    const known = s.status === 'identified';
    const canvas = h('canvas', { class: 'preview__canvas', width: 680, height: 680, role: 'img', 'aria-label': `${s.id}` });
    const toggle = h('input', { type: 'checkbox', id: 'anchors-toggle' });
    toggle.checked = this.showAnchors;
    toggle.addEventListener('change', () => {
      this.showAnchors = toggle.checked;
      this.draw(canvas, s);
    });

    const conf = t(`conf_${s.confidence}`);
    const status = known ? `${t('identified')} (${conf})` : `${t('unknown')} (${conf})`;
    const candidates = (s.candidates || []).map((c) => formGlyphLabel(c.character, c.form)).join(' / ');

    const rows = [
      [t('d_character'), known ? h('span', { lang: 'ar', class: 'ar' }, s.character) : candidates ? t('probable', { list: candidates }) : t('unknown')],
      [t('d_form'), t(`form_${s.form}`)],
      [t('d_status'), status],
      [t('d_size'), `${s.image.width} × ${s.image.height} px`],
      [t('d_ink'), s.inkBox ? `${s.inkBox.w} × ${s.inkBox.h} px` : '–'],
      [t('d_stroke'), `${this.stroke(s).toFixed(2)} px`],
      [t('d_writer'), this.letters.writers.find((w) => w.id === s.writerId)?.label || s.writerId],
      [t('d_file'), h('span', { dir: 'ltr' }, s.file.split('/').pop())],
    ];
    const dl = h('dl', { class: 'details' });
    for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v));
    if (s.notes) dl.append(h('dt', {}, t('d_notes')), h('dd', { class: 'notes', lang: 'en', dir: 'ltr' }, s.notes));

    this.content.replaceChildren(
      h(
        'div',
        { class: 'preview__layout' },
        h('div', {}, canvas, h('label', { class: 'switch' }, toggle, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), h('span', {}, t('showAnchors')))),
        h(
          'div',
          {},
          h('p', { class: 'preview__glyph', lang: known ? 'ar' : 'en', dir: known ? 'rtl' : 'ltr' }, known ? formGlyphLabel(s.character, s.form) : t('unknown')),
          dl,
        ),
      ),
    );
    this.draw(canvas, s);
    if (!this.dialog.open) this.dialog.showModal();
  }

  stroke(s) {
    if (!this.strokeCache.has(s.id)) {
      const img = this.engine.imageFor(s.id);
      const c = document.createElement('canvas');
      c.width = s.image.width;
      c.height = s.image.height;
      c.getContext('2d').drawImage(img, 0, 0);
      this.strokeCache.set(s.id, estimateStrokeWidth(readInk(c), c.width, c.height));
    }
    return this.strokeCache.get(s.id);
  }

  /** Original image, uniformly scaled; optional overlay of the stored metrics. */
  draw(canvas, s) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(0, 0, W, W);
    const img = this.engine.imageFor(s.id);
    const scale = (W * 0.92) / Math.max(s.image.width, s.image.height);
    const ox = (W - s.image.width * scale) / 2;
    const oy = (W - s.image.height * scale) / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ox, oy, s.image.width * scale, s.image.height * scale);
    if (!this.showAnchors) return;
    const X = (x) => ox + x * scale;
    const Y = (y) => oy + y * scale;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(214,64,64,.7)';
    ctx.beginPath();
    ctx.moveTo(X(0), Y(s.baseline));
    ctx.lineTo(X(s.image.width), Y(s.baseline));
    ctx.stroke();
    ctx.setLineDash([]);
    if (s.inkBox) {
      ctx.strokeStyle = s.status === 'identified' ? '#14958a' : '#7a8597';
      ctx.strokeRect(X(s.inkBox.x), Y(s.inkBox.y), s.inkBox.w * scale, s.inkBox.h * scale);
    }
    for (const [a, c] of [[s.anchors.entry, '#2563eb'], [s.anchors.exit, '#c2410c']]) {
      if (!a) continue;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(X(a.x), Y(a.y), 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
