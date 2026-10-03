/**
 * CAPTCHA backgrounds. Procedural and seeded, so a given seed always produces
 * the same image (useful for experiments) while refresh changes the seed.
 * Backgrounds stay light and low-contrast: they never cover letter strokes.
 *
 * To add one: register a painter (ctx, width, height, rng, unit) below and add
 * its key to SETTING_SPECS.background.options in settings.js.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const painters = {
  plain(ctx, w, h) {
    ctx.fillStyle = '#fbfaf7';
    ctx.fillRect(0, 0, w, h);
  },

  paper(ctx, w, h, rng, unit) {
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(0, 0, w, h);
    // soft uneven tone
    for (let i = 0; i < 6; i++) {
      const g = ctx.createRadialGradient(rng() * w, rng() * h, 0, rng() * w, rng() * h, (0.3 + rng() * 0.5) * w);
      g.addColorStop(0, `rgba(255,252,244,${0.25 + rng() * 0.2})`);
      g.addColorStop(1, 'rgba(255,252,244,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // fibres
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const len = (6 + rng() * 22) * unit;
      const ang = rng() * Math.PI;
      ctx.strokeStyle = `rgba(120,100,70,${0.04 + rng() * 0.05})`;
      ctx.lineWidth = (0.4 + rng() * 0.6) * unit;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
  },

  ruled(ctx, w, h, rng, unit) {
    ctx.fillStyle = '#f6f5f0';
    ctx.fillRect(0, 0, w, h);
    const gap = 26 * unit;
    const off = rng() * gap;
    ctx.strokeStyle = 'rgba(70,120,170,0.16)';
    ctx.lineWidth = 1 * unit;
    for (let y = off; y < h; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  },

  speckle(ctx, w, h, rng, unit) {
    ctx.fillStyle = '#f3f1ec';
    ctx.fillRect(0, 0, w, h);
    const n = Math.round((w * h) / (90 * unit * unit));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(40,45,60,${0.05 + rng() * 0.12})`;
      const r = (0.3 + rng() * 0.9) * unit;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
  },
};

export function paintBackground(name, ctx, w, h, seed, unit = 1) {
  const painter = painters[name] || painters.plain;
  painter(ctx, w, h, mulberry32(seed), unit);
}

export function registerBackground(name, painter) {
  painters[name] = painter;
}

export function backgroundNames() {
  return Object.keys(painters);
}
