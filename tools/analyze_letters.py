#!/usr/bin/env python3
"""
Measure handwritten letter images and (optionally) write the measured fields
back into src/data/letters.json.

What it measures (all values in ORIGINAL image pixels, never modified images):
  * image width / height
  * ink bounding box (every pixel with alpha > 0, so dots are always included)
  * connected components (main body + dots / secondary strokes)
  * stroke width estimate  = 2 * inkArea / perimeter (Sobel gradient; orientation independent)
  * suggested connection anchors: leftmost / rightmost point of the largest component

It NEVER changes the identification fields (character, form, status, confidence)
and never touches curated anchors/baselines unless --reset-anchors is passed.
Identification is a human decision and lives only in letters.json.

Requirements: Python 3.9+, Pillow, numpy
Usage:
  python3 tools/analyze_letters.py                 # print a report
  python3 tools/analyze_letters.py --update        # refresh measured fields in letters.json
  python3 tools/analyze_letters.py --update --reset-anchors
"""
import argparse
import json
import os
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LETTERS_JSON = os.path.join(ROOT, "src", "data", "letters.json")


def load_alpha(path):
    """Return ink coverage in [0,1]. Transparent PNGs use alpha; opaque scans use darkness."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32) / 255.0
    alpha = a[..., 3]
    if alpha.min() > 0.99:  # opaque image (e.g. scanned on white paper) -> use luminance
        lum = a[..., :3].mean(axis=2)
        alpha = np.clip((0.85 - lum) / 0.6, 0, 1)
    else:
        lum = a[..., :3].mean(axis=2)
        alpha = alpha * np.clip((1.0 - lum) / 0.7, 0, 1)  # dark ink only
    return im.size, alpha


def components(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    comps = []
    for y in range(h):
        for x in range(w):
            if mask[y, x] and not seen[y, x]:
                q = deque([(y, x)])
                seen[y, x] = True
                pts = []
                while q:
                    cy, cx = q.popleft()
                    pts.append((cy, cx))
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True
                                q.append((ny, nx))
                comps.append(np.array(pts))
    return comps


def stroke_width(alpha):
    """2 * area / perimeter with perimeter = integrated Sobel gradient magnitude of
    the anti-aliased coverage map (orientation independent). Same as image-processor.js."""
    f = np.pad(alpha, 1)
    gx = (f[:-2, 2:] + 2 * f[1:-1, 2:] + f[2:, 2:] - f[:-2, :-2] - 2 * f[1:-1, :-2] - f[2:, :-2]) / 8
    gy = (f[2:, :-2] + 2 * f[2:, 1:-1] + f[2:, 2:] - f[:-2, :-2] - 2 * f[:-2, 1:-1] - f[:-2, 2:]) / 8
    grad = np.hypot(gx, gy).sum()
    return float(2 * alpha.sum() / grad) if grad > 0 else 0.0


def measure(path):
    (w, h), alpha = load_alpha(path)
    ink = alpha > 0.02
    ys, xs = np.nonzero(ink)
    box = {"x": int(xs.min()), "y": int(ys.min()), "w": int(xs.max() - xs.min() + 1), "h": int(ys.max() - ys.min() + 1)}
    comps = components(alpha > 0.15)
    comps.sort(key=len, reverse=True)
    comp_info = []
    for c in comps:
        cy, cx = c[:, 0], c[:, 1]
        comp_info.append({"pixels": int(len(c)), "x": int(cx.min()), "y": int(cy.min()),
                          "w": int(cx.max() - cx.min() + 1), "h": int(cy.max() - cy.min() + 1)})
    main = comps[0]
    my, mx = main[:, 0], main[:, 1]
    lx, rx = mx.min(), mx.max()
    left = {"x": float(lx), "y": round(float(my[mx <= lx + 1].mean()), 1)}
    right = {"x": float(rx), "y": round(float(my[mx >= rx - 1].mean()), 1)}
    return {
        "image": {"width": w, "height": h},
        "inkBox": box,
        "inkCoverage": round(float(alpha.sum()), 1),
        "strokeWidth": round(stroke_width(alpha), 2),
        "components": comp_info,
        "suggestedAnchors": {"left": left, "right": right},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="write measured fields into letters.json")
    ap.add_argument("--reset-anchors", action="store_true", help="overwrite curated anchors with suggestions")
    args = ap.parse_args()

    with open(LETTERS_JSON, encoding="utf-8") as fh:
        db = json.load(fh)

    for s in db["samples"]:
        m = measure(os.path.join(ROOT, s["file"]))
        print(f'{s["id"]:6s} {s.get("character") or "?":2s} {s.get("form","?"):9s} '
              f'size={m["image"]["width"]}x{m["image"]["height"]} ink={m["inkBox"]} '
              f'stroke={m["strokeWidth"]}px comps={len(m["components"])} '
              f'L={m["suggestedAnchors"]["left"]} R={m["suggestedAnchors"]["right"]}')
        if args.update:
            s["image"] = m["image"]
            s["inkBox"] = m["inkBox"]
            s.setdefault("analysis", {})
            s["analysis"]["strokeWidth"] = m["strokeWidth"]
            s["analysis"]["inkCoverage"] = m["inkCoverage"]
            s["analysis"]["components"] = m["components"]
            if args.reset_anchors:
                s["anchors"] = {
                    "entry": m["suggestedAnchors"]["right"] if s.get("form") in ("medial", "final") else None,
                    "exit": m["suggestedAnchors"]["left"] if s.get("form") in ("initial", "medial") else None,
                }

    if args.update:
        with open(LETTERS_JSON, "w", encoding="utf-8") as fh:
            json.dump(db, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("letters.json updated")


if __name__ == "__main__":
    main()
