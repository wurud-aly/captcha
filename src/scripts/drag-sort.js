/**
 * Sortable row of letter tiles.
 *
 * - Pointer Events: one code path for mouse, touch and pen.
 * - Drag a tile: it follows the pointer and the other tiles slide aside (FLIP animation).
 * - Tap one tile, then another: they swap (an alternative to dragging).
 * - Keyboard: ArrowRight / ArrowLeft move the focused tile one place.
 * Works in right-to-left layouts: DOM order is reading order (first letter on the right).
 */

const DRAG_THRESHOLD = 5; // px before a press becomes a drag
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function makeSortable(container, { onChange = () => {}, onAnnounce = () => {} } = {}) {
  let locked = false;
  let drag = null;
  let selected = null;

  const items = () => [...container.querySelectorAll('.tile')];
  const order = () => items().map((el) => el.dataset.letter);

  /** Animate every tile except `skip` from its old position to its new one. */
  function flip(mutate, skip = null) {
    const first = new Map(items().map((el) => [el, el.getBoundingClientRect()]));
    mutate();
    if (reduceMotion()) return;
    for (const el of items()) {
      if (el === skip) continue;
      const a = first.get(el);
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (dx || dy) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
          duration: 200,
          easing: 'cubic-bezier(.2,.7,.2,1)',
        });
      }
    }
  }

  /** Layout position of an element (ignores its transform). */
  function layoutOrigin(el) {
    const c = container.getBoundingClientRect();
    return { x: c.left + container.clientLeft + el.offsetLeft, y: c.top + container.clientTop + el.offsetTop };
  }

  function place(el) {
    const o = layoutOrigin(el);
    const x = drag.px - drag.gx - o.x;
    const y = drag.py - drag.gy - o.y;
    el.style.transform = `translate(${x}px, ${y}px) scale(1.08)`;
  }

  /** Where should the dragged tile go, given the pointer? (nearest tile centre) */
  function reposition(el) {
    let best = null;
    let bestD = Infinity;
    for (const other of items()) {
      if (other === el) continue;
      const r = other.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(drag.px - cx, (drag.py - cy) * 1.5);
      if (d < bestD) {
        bestD = d;
        best = { other, cx };
      }
    }
    if (!best) return;
    const rtl = getComputedStyle(container).direction === 'rtl';
    // In RTL the earlier (reading-order) side of a tile is its right half.
    const before = rtl ? drag.px > best.cx : drag.px < best.cx;
    const ref = before ? best.other : best.other.nextElementSibling;
    if (ref === el || el.nextElementSibling === ref) return;
    flip(() => container.insertBefore(el, ref), el);
    drag.moved = true;
  }

  function onDown(e) {
    const el = e.target.closest('.tile');
    if (!el || locked || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    drag = { el, id: e.pointerId, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, active: false, moved: false };
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.px = e.clientX;
    drag.py = e.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.px - drag.sx, drag.py - drag.sy) < DRAG_THRESHOLD) return;
      drag.active = true;
      clearSelection();
      drag.el.classList.remove('enter');
      drag.el.classList.add('is-dragging');
      container.classList.add('is-sorting');
    }
    e.preventDefault();
    reposition(drag.el);
    place(drag.el);
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, active, moved } = drag;
    if (active) {
      const from = el.style.transform;
      el.style.transform = '';
      el.classList.remove('is-dragging');
      container.classList.remove('is-sorting');
      if (!reduceMotion()) {
        el.animate([{ transform: from }, { transform: 'translate(0, 0) scale(1)' }], { duration: 180, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
      drag = null;
      if (moved) changed(el);
    } else {
      drag = null;
      if (e.type === 'pointerup') tap(el);
    }
  }

  function tap(el) {
    if (!selected) {
      select(el);
      return;
    }
    if (selected === el) {
      clearSelection();
      return;
    }
    const a = selected;
    clearSelection();
    flip(() => {
      const marker = document.createComment('');
      container.replaceChild(marker, a);
      container.replaceChild(a, el);
      container.replaceChild(el, marker);
    });
    changed(a);
  }

  function select(el) {
    selected = el;
    el.classList.add('is-selected');
    el.setAttribute('aria-pressed', 'true');
  }

  function clearSelection() {
    if (!selected) return;
    selected.classList.remove('is-selected');
    selected.setAttribute('aria-pressed', 'false');
    selected = null;
  }

  function onKey(e) {
    const el = e.target.closest('.tile');
    if (!el || locked) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tap(el);
      el.focus();
      return;
    }
    const rtl = getComputedStyle(container).direction === 'rtl';
    let step = 0;
    if (e.key === 'ArrowRight') step = rtl ? -1 : 1;
    if (e.key === 'ArrowLeft') step = rtl ? 1 : -1;
    if (!step) return;
    e.preventDefault();
    clearSelection();
    const list = items();
    const i = list.indexOf(el);
    const j = i + step;
    if (j < 0 || j >= list.length) return;
    flip(() => container.insertBefore(el, step < 0 ? list[j] : list[j].nextElementSibling));
    el.focus();
    changed(el);
  }

  function changed(el) {
    const list = items();
    list.forEach((t, i) => t.setAttribute('aria-label', `${t.dataset.letter}، ${i + 1} / ${list.length}`));
    onAnnounce(el.dataset.letter, list.indexOf(el) + 1, list.length);
    onChange(order());
  }

  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  container.addEventListener('keydown', onKey);
  container.addEventListener('dragstart', (e) => e.preventDefault()); // no native image/text drag

  return {
    order,
    setLocked(v) {
      locked = v;
      clearSelection();
      items().forEach((t) => t.setAttribute('aria-disabled', String(v)));
    },
    reset() {
      drag = null;
      selected = null;
      locked = false;
    },
  };
}
