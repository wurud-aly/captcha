/**
 * Experiment settings (pure, no DOM).
 *
 * SETTING_SPECS describes every user-adjustable global parameter (range, step,
 * unit). Defaults come from src/data/composition.json so tuned values can be
 * committed without touching code. A tiny observable store keeps UI and engine
 * in sync.
 */

export const SETTING_SPECS = {
  size: { min: 0.6, max: 1.6, step: 0.05, unit: '×' },
  spacing: { min: 0, max: 60, step: 1, unit: 'px' },
  overlap: { min: -6, max: 12, step: 0.5, unit: 'px' },
  verticalOffset: { min: -60, max: 60, step: 1, unit: 'px' },
  typedStroke: { min: -3.5, max: 3, step: 0.1, unit: 'px' },
  handStroke: { min: -1, max: 2, step: 0.1, unit: 'px' },
  baselineMode: { options: ['joins', 'baseline'] },
  background: { options: ['paper', 'plain', 'ruled', 'speckle'] },
};

export const CHARACTER_SPECS = {
  scale: { min: 0.5, max: 1.8, step: 0.05, unit: '×' },
  offsetX: { min: -40, max: 40, step: 1, unit: 'px' },
  offsetY: { min: -40, max: 40, step: 1, unit: 'px' },
};

/** Build the default settings object from composition.json. */
export function defaultSettings(composition) {
  const L = composition.layout || {};
  return {
    size: L.size ?? 1,
    spacing: L.spacing ?? 14,
    overlap: L.overlap ?? 2,
    baselineMode: L.baselineMode ?? 'joins',
    verticalOffset: L.verticalOffset ?? 0,
    typedStroke: composition.typed?.thickness ?? 0,
    handStroke: composition.handwritten?.thickness ?? 0,
    background: composition.render?.background ?? 'paper',
    showGuides: false,
    /** per-word, per-letter overrides: { [wordId]: { [index]: {style, scale, offsetX, offsetY} } } */
    characters: {},
  };
}

export function clampSetting(key, value, specs = SETTING_SPECS) {
  const spec = specs[key];
  if (!spec) return value;
  if (spec.options) return spec.options.includes(value) ? value : spec.options[0];
  const n = Number(value);
  if (!Number.isFinite(n)) return spec.min;
  return Math.min(spec.max, Math.max(spec.min, n));
}

export function createStore(initial) {
  let state = structuredClone(initial);
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn(state));
    },
    setCharacter(wordId, index, patch) {
      const words = { ...state.characters };
      const word = { ...(words[wordId] || {}) };
      word[index] = { ...(word[index] || {}), ...patch };
      words[wordId] = word;
      this.set({ characters: words });
    },
    resetCharacters(wordId) {
      const words = { ...state.characters };
      delete words[wordId];
      this.set({ characters: words });
    },
    reset(next) {
      state = structuredClone(next);
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
