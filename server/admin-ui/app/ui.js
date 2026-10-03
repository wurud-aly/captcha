/** Shared dashboard UI helpers (no inline styles: the admin CSP forbids them). */
import { h, formatNumber } from '../../src/scripts/ui/dom.js';
import { at } from '../static/admin-i18n.js';

export { h, formatNumber };

let toastTimer = 0;
export function toast(message, kind = 'info', ms = 4200) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `adm-toast adm-toast--${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/** Modal confirmation. Resolves true only when the owner confirms. */
export function confirmDialog(title, ...bodyNodes) {
  const dlg = document.getElementById('confirm-dialog');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').replaceChildren(...bodyNodes.filter(Boolean).map((n) => (typeof n === 'string' ? h('p', {}, n) : n)));
  dlg.returnValue = '';
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
    document.getElementById('confirm-cancel').focus();
  });
}

/**
 * Labelled range slider bound to a getter/setter.
 * @returns {{el:HTMLElement, sync:() => void}}
 */
export function slider({ id, label, min, max, step, unit = 'px', signed = false, digits = 1, get, set, hint }) {
  const value = h('span', { class: 'field__value' });
  const input = h('input', { type: 'range', id, min, max, step });
  const sync = () => {
    const v = Number(get());
    if (document.activeElement !== input) input.value = v;
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    value.textContent = formatNumber(v, { unit, signed, digits });
  };
  input.addEventListener('input', () => {
    set(Number(input.value));
    sync();
  });
  sync();
  const el = h('div', { class: 'field' }, h('div', { class: 'field__row' }, h('label', { for: id }, label), value), input, hint ? h('p', { class: 'field__hint' }, hint) : null);
  return { el, sync, input };
}

export function selectField({ id, label, options, value, onChange }) {
  const sel = h('select', { class: 'select', id }, options.map(([v, l, disabled]) => h('option', { value: v, disabled: Boolean(disabled) }, l)));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return h('div', { class: 'field' }, h('label', { for: id }, label), sel);
}

export function numberInput({ id, label, value, min, max, step = 0.5, onChange, disabled = false }) {
  const input = h('input', { class: 'adm-input adm-input--num', type: 'number', id, min, max, step, dir: 'ltr', disabled });
  input.value = value ?? '';
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  });
  return h('label', { class: 'adm-num', for: id }, h('span', {}, label), input);
}

export function segmented({ label, options, value, onChange }) {
  const g = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const [v, l, disabled] of options) {
    g.append(h('button', { type: 'button', dataset: { style: v }, 'aria-pressed': String(v === value), disabled: Boolean(disabled), onclick: () => onChange(v) }, l));
  }
  return h('div', { class: 'field' }, h('span', {}, label), g);
}

export function section(title, intro, ...children) {
  return h('section', { class: 'panel adm-section' }, h('h2', { class: 'panel__title' }, title), intro ? h('p', { class: 'adm-muted' }, intro) : null, ...children);
}

export function badge(text, kind = '') {
  return h('span', { class: `adm-badge ${kind ? `adm-badge--${kind}` : ''}` }, text);
}

export function t(key, vars) {
  return at(key, vars);
}

/** Paint a light checkerboard so transparency is visible. */
export function checkerboard(ctx, w, hgt, size = 12) {
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, w, hgt);
  ctx.fillStyle = '#e6e1d6';
  for (let y = 0; y < hgt; y += size) for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) ctx.fillRect(x, y, size, size);
}

export function randomRef() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return `pending:${[...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)}`;
}
