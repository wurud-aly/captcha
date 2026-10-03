# Test report

Date: 2026-10-03 · Node.js 22.22 · Chromium 141.0.7390.37 (headless, via Playwright 1.56)

Re-run at any time with `npm test`, `npm run test:e2e` and `npm run test:admin`. The browser suites write `tests/e2e/output/report.json` and `admin-report.json` with the same checks and their measured values. All admin tests run on throwaway copies of the project, never on the real data.

## Summary (version 0.2, with the admin dashboard)

| Suite | Checks | Passed | Failed |
|---|---|---|---|
| Engine unit tests (`tests/unit`) | 45 | 45 | 0 |
| Admin server tests (`tests/server`): auth, PNG, data store, HTTP security, publishing, Pages bundle | 36 | 36 | 0 |
| Public site in a browser (`npm run test:e2e`, under `/arabic-hybrid-captcha/`) | 45 | 45 | 0 |
| Admin dashboard in a browser (`npm run test:admin`) | 23 | 23 | 0 |
| **Total** | **149** | **149** | **0** |
| Visual inspection (manual, by eye) | CAPTCHA renders; dashboard desktop, mobile and RTL | see notes | – |

The public-site suite was re-run after the admin changes. It still passes 45/45, so existing functionality is unchanged.

## A. Asset validation

| Check | Result |
|---|---|
| 12 handwritten PNGs present, unique, sizes match `letters.json` (PNG header) | pass |
| Images byte-identical to the supplied attachments (copied, never modified) | pass (`cmp`) |
| Cairo Light present, valid TrueType, embedded name "Cairo Light", weight 300 | pass |
| Font licence (SIL OFL 1.1) shipped next to the font | pass |
| All `index.html` / CSS / JSON / module paths relative and resolving | pass |
| No absolute machine paths, no Google Fonts / CDN references | pass |
| All 12 images load in the browser at their recorded size | pass |
| Cairo Light loads from the local file and is actually used (glyph metrics differ from fallback) | pass |

## B. Rendering

| Check | Result |
|---|---|
| Contextual forms from joining rules (شبكات: initial, medial, medial, final, isolated; حاسب: initial, final, initial, final; فهد: initial, medial, final) | pass |
| Right-to-left order on canvas (letter centres strictly decreasing in x) | pass, all 3 words |
| Joins exact: entry point = previous exit point + overlap, 0 vertical offset | pass, 7 joins |
| No visible gap at joins (darkest pixel near each join, plain background) | pass, ink luminance 0.14 at every join |
| Dots and secondary strokes preserved (connected-component count, original vs rendered) | pass: ش 2, ت 2, ب 2, ف 2 parts kept |
| No cropping (ink never touches raster edge; ink box inside image) | pass |
| No mirroring (correlation with original 0.92–0.93; with mirror image 0.03–0.26) | pass |
| Uniform scaling only, word fits the frame | pass (scale 1.00 for all words) |
| Stroke consistency (max/min stroke width ≤ 1.35) | pass: handwritten 2.74–2.95 px, typed 2.63–2.85 px |

## C. Word generation

| Word | Default plan (H = handwritten sample, T = typed) | Groups / joins | Regenerated 5× |
|---|---|---|---|
| شبكات | ش H hw-10, ب T, ك T, ا H hw-12, ت H hw-09 | 2 / 3 | pass: 5 distinct images; same seed gives identical image |
| حاسب | ح H hw-05, ا H hw-03, س T, ب H hw-02 | 2 / 2 | pass |
| فهد | ف H hw-08, ه T, د H hw-04 | 1 / 2 | pass |

Baseline deviation of letters in each connected group (px, after centring): شبكات [−3.5, 2.2, 2.2, −0.8] [0]; حاسب [0, 0] [1.3, −1.3]; فهد [−7.1, −0.3, 7.4]. The larger فهد spread comes from the handwritten ـد, whose tail sweeps below its connection point.

## D. Interface

| Check | Result |
|---|---|
| Verification: correct, wrong, empty, and normalised input (diacritics, tatweel, spaces) | pass |
| Random mode: hidden word solvable; answer not in the generator markup or canvas label; letter editor locked | pass |
| Word selection (3 words) | pass |
| Every global setting changes the preview (size, spacing, overlap, baseline mode, vertical position, background, typed stroke, handwritten stroke) | pass |
| Guides overlay and legend | pass |
| Per-letter type, sample and scale (ب → hw-06; ك handwritten disabled; alif sample hw-03/hw-12; scale 1.3) | pass |
| "Match typed to handwriting" gives typed 2.76 px = handwritten 2.76 px | pass |
| Gallery: 12 tiles with label, type, dimensions; preview dialog opens and closes | pass (1 tile marked unknown) |
| Desktop 1400×900: no horizontal overflow | pass |
| Mobile 390×844 (emulated): no overflow, verification works, letter chips on one row | pass |
| Arabic UI: `dir="rtl"`, letter chips right to left, toggles back | pass |

## E. Deployment

| Check | Result |
|---|---|
| Served under the sub-path `/arabic-hybrid-captcha/`: no 404s, no failed requests | pass |
| Served at domain root (`/`): loads without console errors | pass |
| Clean session (UI clicks only): no JavaScript errors and no console warnings | pass |
| Debug hook absent without `?debug` | pass |

## F. Admin server and security (`tests/server`, 36 checks, all pass)

| Area | Checks |
|---|---|
| Access control | public page does not mention or link the admin; dashboard redirects to login; dashboard code (`/admin/app/*`) and every API answer 401 without a session; logout ends the session server-side; no configured password → nobody can sign in (503) |
| File disclosure | `server/` sources, credentials, backups, `package.json`, dotfiles and 10 traversal patterns (plain, `%2e%2e`, `%2f`, raw un-normalised paths, also while signed in) are never served |
| Passwords | scrypt hash with random salt, never plain text; wrong, empty, malformed-hash and missing-config cases rejected; weak passwords rejected; password change requires the current password and invalidates all sessions |
| Sessions | random ids, only hashes stored, idle and absolute expiry; cookie `HttpOnly; SameSite=Strict`; `Secure` + `__Host-` prefix when configured for HTTPS |
| CSRF | missing token → 403; foreign `Origin` → 403 (also on login) |
| Brute force | 4 × 401, then 429 from the 5th failure, also for the correct password while locked; `Retry-After` header set |
| Headers / limits | strict CSP without `unsafe-inline`/`unsafe-eval`, `X-Frame-Options: DENY`, `no-store`, `noindex`; oversized body → 413; wrong content type → 415 |
| PNG validation | the 12 supplied images pass; decoder round-trips pixels exactly; non-PNG, truncated, corrupt-CRC, opaque-background, empty, oversized and decompression-bomb files are rejected |
| Data store | unchanged save is lossless; upload stored under `uploads/` with a new content-hashed name; image size and ink box measured from the file (client values ignored); replace keeps the old file and records it; delete keeps the file; the 12 originals are byte-identical after every operation; invalid paths, characters, `<script>`, non-Arabic words, ids, wrong forms, empty word lists and stale versions (409) rejected; unknown fields stripped, numbers clamped, font path not editable; backups made and restorable |
| Publishing | only files differing from GitHub are committed; token only in the server environment, never in API responses; no force-push |
| Pages bundle | contains `index.html`, `.nojekyll`, `public/`, `src/` (12 letters, font, engine) and nothing from `server/`, tests, tools, docs or credentials |

## G. Admin dashboard in a browser (`tests/e2e/admin-e2e.mjs`, 23 checks, all pass)

| Check | Result |
|---|---|
| Signed out → login page (Arabic, RTL); wrong password → error with remaining attempts; correct password → dashboard with 12 letters | pass |
| Letter editor: before (original) and after (as rendered) previews, previews of words using the letter | pass |
| Size and offset sliders update the previews; nothing reaches the server before saving | pass |
| Click-to-set connection point (exit x 31 → 47); undo, redo, discard (with confirmation) | pass |
| Upload: non-PNG and opaque PNG rejected with clear Arabic messages; transparent PNG accepted, assigned ب (initial), shown as new | pass |
| Replace an image (then undo) | pass |
| Delete a letter: Cancel keeps it; Confirm removes it; the dialog states the file is kept | pass |
| Add the word باب (invalid "abc" rejected first); handwritten/typed per letter; sample selection (ب hw-13, ا hw-03); handwritten disabled where no sample exists; per-letter offset updates the preview | pass |
| Delete a word with confirmation | pass |
| Layout: overlap and spacing update the preview | pass |
| Preview CAPTCHA: new word only in the draft; saved and draft differ for فهد; answer test verified | pass |
| Save and apply: words/letters/composition written, upload stored, deleted letter removed, per-word adjustment saved, discarded edits not saved, **12 original images byte-identical** | pass |
| Public CAPTCHA (same server) renders the new word with the uploaded letter and verifies the answer | pass |
| History: backup listed and restored (words back to شبكات، حاسب، فهد) | pass |
| English interface switches to LTR and back | pass |
| Mobile 390 px: 8 dashboard views fit (every element's box checked, which catches RTL overflow) | pass |
| Sign out: API 401, dashboard redirects to login | pass |
| No console errors, CSP violations or server errors during the run | pass |

## Visual inspection notes (manual)

The renders in `tests/e2e/output/render-*.png` were looked at directly:

- **شبكات** reads correctly. The joins ش→ب→ك→ا are seamless, the typed medial ب keeps its dot, the ruqʿa caret over ش reads as its dots, and the stroke weight of typed and handwritten letters is visually consistent.
- **حاسب** is connected correctly, with clear typed teeth on س. Caveat: the handwritten ح (hw-05) has an S-shaped head that can be read as a ك. This is a property of the sample, documented as a known limitation.
- **فهد** reads correctly. The ف dot is kept (it is a very small mark in the original). The handwritten ـد tail dips below the connection line, as it was written.
- Interface: desktop columns are balanced; on mobile the header, letter chips and controls fit; the Arabic UI mirrors correctly.
- Admin dashboard (screenshots in `tests/e2e/output/admin-*.png`): the letter grid, letter editor (checkerboard original with baseline and connection overlay, processed result, in-word previews), word editor, layout, saved-vs-draft preview and history all read correctly in Arabic RTL. One mobile layout bug was found this way and fixed: wide canvases pushed the letter editor past the left edge in RTL. The mobile test now checks every element's box, so it would catch this again.

## Not performed
- **Admin server on a real HTTPS host.** The HTTPS behaviour (Secure / `__Host-` cookie) was tested with the server's option, not on a real public host with a TLS certificate.
- **Publishing against the real GitHub API.** It was tested against a mock of the GitHub Git Data API (same endpoints and payloads); no real token or repository was available here.
- **Interactive password prompt** of `npm run admin:setup` (hidden typing in a real terminal). The non-interactive path and the hash output were tested.

- **Live GitHub Pages deployment.** The sub-path deployment was simulated locally with the same URL structure; the real GitHub upload was not done from here.
- **Other browsers.** Only Chromium was tested. Firefox and Safari were not; the code uses standard Canvas 2D, FontFace and ES modules, but Arabic shaping with ZWJ in canvas should be checked there.
- **Real phones.** Mobile was tested with an emulated 390 px viewport only.
- **Screen-reader testing.** Not performed.
- **CAPTCHA robustness** (OCR or ML solver attacks, human solve-rate studies). Out of scope for this prototype and not performed.
- **`npm install` of Playwright from the registry** could not be run in the build environment (registry policy). The same Playwright 1.56 was used from a local installation; on a normal machine, `npm install` then `npx playwright install chromium` is the expected path.
