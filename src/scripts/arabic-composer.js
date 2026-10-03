/**
 * Arabic character composition engine (pure geometry, no DOM).
 *
 * Input: one "piece" per letter, in logical order (first letter = right-most).
 * A piece is a raster of a single letter (handwritten image or typed glyph)
 * described by its metrics, all in piece-local pixels:
 *
 *   width, height  raster size
 *   inkBox         {x, y, w, h} tight box around every ink pixel (dots included)
 *   baseline       y of the line the letter sits / joins on
 *   entry          {x, y} right-hand connection point (letter joins the previous one)
 *   exit           {x, y} left-hand connection point (letter joins the next one)
 *   joinsPrev / joinsNext   from the Arabic joining rules
 *   offsetX / offsetY       manual fine-tuning
 *
 * Layout rules (right-to-left):
 *   1. The first letter's ink starts at x = 0 and the word grows towards -x.
 *   2. A letter that joins the previous one is placed so its entry point lands
 *      on the previous letter's exit point, pushed right by `overlap` so the two
 *      strokes overlap instead of leaving a hairline gap.
 *        baselineMode "joins":    the entry y snaps to the exit y (true connection)
 *        baselineMode "baseline": the letter keeps its own baseline on the shared line
 *   3. A letter after a non-connecting letter (ا د ذ ر ز و) starts a new
 *      group; its ink is placed `spacing` px to the left of all ink placed so far,
 *      so disconnected parts never collide.
 *   4. In "joins" mode every connected group is moved vertically so the mean
 *      of its letters' baselines sits on the shared baseline (y = 0). This stops
 *      slanted handwriting from drifting off the line.
 *
 * Offsets are applied to the letter and carried along by the letters joined after
 * it, so manual tuning never tears an existing connection apart.
 */

export function composeWord(pieces, options = {}) {
  const overlap = options.overlap ?? 0;
  const spacing = options.spacing ?? 10;
  const mode = options.baselineMode === 'baseline' ? 'baseline' : 'joins';

  const placements = [];
  const groups = [];
  const joins = [];
  let inkLeft = Infinity; // left-most ink x of everything placed so far

  pieces.forEach((p, i) => {
    const prev = pieces[i - 1];
    const prevPos = placements[i - 1];
    let x;
    let y;
    let connected = false;

    if (i === 0) {
      x = -(p.inkBox.x + p.inkBox.w);
      y = -p.baseline;
      groups.push([i]);
    } else if (p.joinsPrev && prev && prev.joinsNext) {
      connected = true;
      const prevExit = anchorOf(prev, 'exit');
      const entry = anchorOf(p, 'entry');
      const ex = prevPos.x + prevExit.x;
      const ey = prevPos.y + prevExit.y;
      x = ex + overlap - entry.x;
      y = mode === 'joins' ? ey - entry.y : -p.baseline;
      groups[groups.length - 1].push(i);
    } else {
      x = inkLeft - spacing - (p.inkBox.x + p.inkBox.w);
      y = -p.baseline;
      groups.push([i]);
    }

    x += p.offsetX || 0;
    y += p.offsetY || 0;
    placements.push({ x, y, connected, group: groups.length - 1 });
    inkLeft = Math.min(inkLeft, x + p.inkBox.x);
  });

  if (mode === 'joins') {
    for (const g of groups) {
      if (g.length < 2) continue;
      const mean = g.reduce((s, i) => s + placements[i].y + pieces[i].baseline, 0) / g.length;
      // keep the manual vertical offset of the first letter in the group
      const target = pieces[g[0]].offsetY || 0;
      const dy = target - mean;
      for (const i of g) placements[i].y += dy;
    }
  }

  pieces.forEach((p, i) => {
    if (!placements[i].connected) return;
    const a = placements[i - 1];
    const b = placements[i];
    const exit = anchorOf(pieces[i - 1], 'exit');
    const entry = anchorOf(p, 'entry');
    joins.push({
      from: i - 1,
      to: i,
      exit: { x: a.x + exit.x, y: a.y + exit.y },
      entry: { x: b.x + entry.x, y: b.y + entry.y },
    });
  });

  const bounds = inkBounds(pieces, placements);
  return { placements, groups, joins, bounds };
}

/** Anchor with a geometric fallback (bottom corner of the ink box). */
export function anchorOf(piece, which) {
  const a = piece[which];
  if (a) return a;
  const b = piece.inkBox;
  return which === 'exit' ? { x: b.x, y: piece.baseline } : { x: b.x + b.w, y: piece.baseline };
}

export function inkBounds(pieces, placements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  pieces.forEach((p, i) => {
    const { x, y } = placements[i];
    minX = Math.min(minX, x + p.inkBox.x);
    minY = Math.min(minY, y + p.inkBox.y);
    maxX = Math.max(maxX, x + p.inkBox.x + p.inkBox.w);
    maxY = Math.max(maxY, y + p.inkBox.y + p.inkBox.h);
  });
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Fit a composed word into a frame: uniform down-scaling only (never up-scale,
 * never distort proportions), centred, with an optional vertical offset.
 */
export function fitToFrame(bounds, frame, verticalOffset = 0) {
  const availW = frame.width - 2 * frame.padding;
  const availH = frame.height - 2 * frame.padding;
  const scale = Math.min(1, availW / bounds.width, availH / bounds.height);
  const tx = frame.width / 2 - (bounds.minX + bounds.width / 2) * scale;
  const ty = frame.height / 2 - (bounds.minY + bounds.height / 2) * scale + verticalOffset;
  return { scale, tx, ty };
}
