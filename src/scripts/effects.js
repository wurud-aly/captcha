/**
 * Post-processing pipeline (extension point for future distortion).
 *
 * The engine calls applyEffects() after the word is drawn and before guides.
 * No distortion is implemented in this version on purpose. A future effect
 * (warp, rotation jitter, noise lines ...) only needs to be registered here and
 * listed in composition.json -> render.effects; the composer and the letter
 * pipeline stay untouched.
 *
 *   registerEffect('wave', (ctx, { width, height, rng, params, layout }) => { ... });
 *   // composition.json: "effects": [{ "name": "wave", "params": { "amplitude": 3 } }]
 *
 * Each effect receives:
 *   ctx     2D context of the final CAPTCHA canvas
 *   width, height  canvas size in device pixels
 *   rng     seeded random generator (same seed -> same output)
 *   params  the effect's parameters from configuration
 *   layout  composed layout (piece placements, joins, bounds) in device pixels
 */

const registry = new Map();

export function registerEffect(name, fn) {
  if (typeof fn !== 'function') throw new TypeError('effect must be a function');
  registry.set(name, fn);
}

export function hasEffect(name) {
  return registry.has(name);
}

export function applyEffects(list, context) {
  const applied = [];
  for (const item of list || []) {
    const fn = registry.get(item.name);
    if (!fn) {
      console.warn(`[effects] unknown effect "${item.name}" skipped`);
      continue;
    }
    fn(context.ctx, { ...context, params: item.params || {} });
    applied.push(item.name);
  }
  return applied;
}

// Reference no-op effect documenting the interface.
registerEffect('identity', () => {});
