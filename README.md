# Arabic Hybrid CAPTCHA

An experimental research prototype for generating hybrid Arabic CAPTCHA images using handwritten and digitally typed characters.

Each CAPTCHA word is assembled letter by letter. Some letters come from real handwritten images; the rest are typed with the Cairo Light font in the correct contextual form. A dedicated composition engine joins them right to left so the result reads as one connected Arabic word.

The project has two parts:

- **The public CAPTCHA**: a static site, deployable to GitHub Pages.
- **A private admin dashboard** (`/admin`): a password-protected interface where the owner uploads letters, assigns them, adjusts the composition and manages words. It runs on a small Node.js admin server, never on GitHub Pages. See [Admin dashboard](#admin-dashboard-private).

> **Research note.** Mixing handwriting with typed letters does not by itself make a CAPTCHA resistant to automated solvers, and verification in this prototype runs in the browser (the answer is in client-side code). Treat it as a platform for experiments, not as a security control.

---

## Features

- **Arabic composition engine**: joining analysis (isolated, initial, medial and final forms), right-to-left placement, connection-point snapping, adjustable overlap, spacing for non-connecting letters (ا د ذ ر ز و), baseline alignment and per-letter offsets and scale.
- **Original handwriting preserved**: images are uniformly scaled only. They are never rotated, mirrored, redrawn or cropped, and dots are kept. The tests verify this.
- **Typed letters in context**: Cairo Light glyphs are shaped with zero-width joiners, so each letter gets its real initial, medial or final form.
- **Stroke thickness matching**: typed strokes are thinned along the glyph outline (vector, not raster) to match the measured handwriting pen width.
- **Configuration-driven**: letters, words and composition settings live in JSON. Adding words or samples needs no engine changes.
- **Experiment panel**: size, spacing, overlap, baseline mode, vertical position, typed and handwritten stroke, background, plus per-letter type, sample, scale and offsets. Construction guides show baselines, connection points and letter boxes.
- **Character gallery** with all 12 original images, their identification, dimensions and connection metadata.
- English and Arabic interface (full RTL), responsive, keyboard accessible.
- Fully static, so it runs on GitHub Pages under a sub-path. No backend, no API keys, no external fonts or CDNs.
- **Private admin dashboard** (Arabic RTL first, English available): upload, replace and delete letter images; assign letters and forms; set connection points by clicking; adjust size and position; manage words; tune spacing and overlap; compare saved and unsaved versions side by side; undo, redo and discard; automatic backups with restore; optional one-click publishing to GitHub.

## Project structure

```
arabic-hybrid-captcha/
├── index.html                    single-page app (relative paths only)
├── README.md  LICENSE  package.json  .gitignore  .nojekyll
├── public/
│   ├── favicon.svg
│   └── assets/
│       ├── handwritten/          letter-01.png … letter-12.png (original images, unmodified)
│       ├── fonts/                Cairo-Light.ttf + OFL.txt (font licence)
│       └── backgrounds/          notes on adding image backgrounds
├── src/
│   ├── data/
│   │   ├── letters.json          handwritten character database
│   │   ├── words.json            word dataset: letters, styles, samples
│   │   └── composition.json      global composition / rendering defaults
│   ├── scripts/
│   │   ├── arabic-joining.js     joining types and contextual forms (pure)
│   │   ├── arabic-composer.js    RTL layout engine (pure geometry)
│   │   ├── image-processor.js    ink masks, thickness, stroke measurement, anchors
│   │   ├── glyph-factory.js      handwritten image or typed glyph → letter "piece"
│   │   ├── captcha-engine.js     pipeline: plan → pieces → layout → canvas; verification
│   │   ├── letter-database.js    letters.json access and validation
│   │   ├── word-database.js      words.json resolution and validation
│   │   ├── settings.js           setting specs, defaults, store
│   │   ├── backgrounds.js        seeded procedural backgrounds
│   │   ├── effects.js            post-processing hook (future distortion)
│   │   ├── data-loader.js        JSON loading relative to the page
│   │   ├── i18n.js               English / Arabic strings
│   │   ├── app.js                UI controller
│   │   └── ui/                   settings-panel.js, gallery.js, dom.js
│   └── styles/main.css
├── tools/
│   ├── analyze_letters.py        measures images, refreshes letters.json measurements
│   ├── calibration.html          font size and stroke calibration (browser)
│   └── composition-sheet.html    renders every word with guides (browser)
├── server/                       PRIVATE admin server + dashboard (never deployed to Pages)
│   ├── admin-server.mjs          HTTP server: public site + /admin + /admin/api
│   ├── setup-admin.mjs           sets the admin password (stores a scrypt hash only)
│   ├── lib/                      auth.mjs, http.mjs, png.mjs, store.mjs, publisher.mjs
│   ├── admin-ui/                 login page, dashboard (app/), styles and strings (static/)
│   └── .data/                    created at runtime: credentials + backups (git-ignored)
├── scripts/
│   ├── serve.mjs                 zero-dependency static server (public site only)
│   └── build-pages.mjs           builds the Pages bundle: public files only
├── docs/
│   ├── TEST-REPORT.md            what was tested and the results
│   └── ADMIN-SECURITY.md         security design of the admin dashboard
├── .github/workflows/
│   ├── tests.yml                 CI: unit, server and browser tests
│   └── pages.yml                 deploys ONLY the public site to GitHub Pages
└── tests/
    ├── unit/                     engine tests (node:test, no dependencies)
    ├── server/                   auth, PNG, store, API security, publishing, Pages bundle
    └── e2e/                      run-e2e.mjs (public site), admin-e2e.mjs (dashboard)
```

The pure modules (`arabic-joining`, `arabic-composer`, `image-processor` mask functions, both databases and `settings`) have no DOM dependency and are unit tested in Node.

## Installation

Requirements: any modern browser. For local development you need **Node.js 18 or newer** (only used to serve files and run tests). Python 3 with Pillow and numpy is optional, for `tools/analyze_letters.py`.

```bash
git clone https://github.com/<you>/arabic-hybrid-captcha.git
cd arabic-hybrid-captcha
```

No build step and no runtime dependencies.

## Local development

The app uses ES modules and loads JSON, so it must be served over HTTP. Opening `index.html` directly from disk (`file://`) will not work.

```bash
npm start              # http://localhost:8080/
npm run start:pages    # http://localhost:8080/arabic-hybrid-captcha/  (simulates GitHub Pages)
```

Any static server works too, for example `python3 -m http.server 8080`.

Development tools (open through the server):

- `/tools/composition-sheet.html` renders every word with and without guides and prints the layout data. Add `?all=hand` or `?all=typed` to compare styles, or `?mode=baseline` to compare alignment modes.
- `/tools/calibration.html` recommends `typed.fontSize` and `typed.thickness` from the current samples.

Append `?debug` to the app URL to expose `window.__ahc` (engine, settings store, last render) for experiments. Use `?lang=ar` to open the Arabic interface.

### Tests

```bash
npm test                         # unit + server tests, Node only, no install needed
npm install                      # once: installs Playwright
npx playwright install chromium  # once: browser for e2e tests
npm run test:e2e                 # public site in a browser, under the /arabic-hybrid-captcha/ sub-path
npm run test:admin               # admin dashboard in a browser (uses a temporary copy of the data)
```

The browser runs write `tests/e2e/output/` (reports, screenshots, per-word renders with and without guides). No test ever modifies the real project data.

## GitHub Pages deployment

1. Create a repository (for example `arabic-hybrid-captcha`) and push this folder to its `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. The included workflow `.github/workflows/pages.yml` runs the tests, builds the bundle with `scripts/build-pages.mjs` and deploys it. After it finishes, the site is live at `https://<user>.github.io/arabic-hybrid-captcha/`.

The Pages bundle contains **only** `index.html`, `.nojekyll`, `public/` and `src/`. The admin server and dashboard (`server/`), tests, tools and docs are never published, and a test checks this. You can preview the bundle with `npm run build:pages` (output in `_site/`).

All paths are relative to `index.html`, so the site works under any repository name and sub-path.

> If you prefer *Deploy from a branch* (main, `/ root`), the public site still works, but the `server/` source code would also be downloadable from Pages. It contains no secrets (passwords and backups live in git-ignored `server/.data/`), but the Actions deployment is the cleaner choice.

## Admin dashboard (private)

### Why it needs a server

GitHub Pages only serves static files. It cannot check a password, keep a session, or write files. Any "login" that runs only in the browser on Pages is fake: the password or the data would be in public JavaScript, and nothing could be saved anyway. So the dashboard runs on a small **admin server** included in this project (`server/`, Node.js built-ins only, no third-party packages). It serves:

| URL | Access |
|---|---|
| `/` | the public CAPTCHA site (read-only) |
| `/admin/login` | login page |
| `/admin`, `/admin/app/*` | dashboard; redirects to login or answers 401 without a session |
| `/admin/api/*` | JSON API; requires a session, plus a CSRF token for every change |

Everything else, including `server/`, credentials, backups, `package.json` and dotfiles, returns 404.

### Set up and use (on your own computer, recommended)

```bash
npm run admin:setup     # choose a password (min. 12 characters); input is hidden
npm run admin           # open http://127.0.0.1:8787/admin
```

By default the server listens only on `127.0.0.1`, so it is reachable only from your own computer. Edits stay in a draft until you press **Save and apply** (حفظ وتطبيق). Then the server validates everything, backs up the current data, and writes `src/data/*.json` and any new images. To update GitHub Pages, publish the saved changes:

- **Manually:** `git add src/data public/assets/handwritten && git commit -m "Update CAPTCHA data" && git push`
- **Or with the Publish button** (السجل والنشر): start the server with `GITHUB_TOKEN` (a fine-grained token with *Contents: read and write* on this one repository), `GITHUB_REPO=owner/name` and optionally `GITHUB_BRANCH`. The server commits only changed files. The token stays on the server and is never sent to the browser.

### What the dashboard does

| Section | Features |
|---|---|
| الحروف (Letters) | all images with previews and where each is used; upload a PNG (checked for real PNG data, transparent background and size, in the browser and again on the server); assign the letter and form; before/after preview (original vs as drawn in the CAPTCHA) and live previews of every word that uses it; click to set the baseline and entry/exit connection points, or detect them automatically; size, horizontal/vertical offset and stroke adjustments; replace the image; delete with a confirmation dialog |
| الكلمات (Words) | add, edit, delete (with confirmation); each letter's form is computed automatically; choose handwritten or typed per letter and which sample; per-letter scale and offsets for that word; live preview with guides |
| التخطيط (Layout) | global size, spacing after non-connecting letters, overlap of connected letters, baseline mode, font size, typed and handwritten stroke, background, ink colour; stroke matching |
| معاينة الكابتشا (Preview) | the saved (live) version and your unsaved version side by side, rendered by the real engine; answer test |
| السجل والنشر (History) | automatic backups (last 50) with restore; publish to GitHub; change password |

Header: unsaved-change counter, **Undo / Redo** (Ctrl+Z / Ctrl+Shift+Z), **Discard changes**, **Save and apply** (Ctrl+S). Problems that would break the CAPTCHA (for example, a handwritten letter without a matching sample) are listed and block saving.

### How your data is protected

- **Original images are never modified or deleted.** Uploads are written to `public/assets/handwritten/uploads/<id>-<hash>.png` and never overwrite an existing file. Replacing an image stores a new file and records the old path in `source.previousFiles`. Deleting a letter removes it from the library (`letters.json`) but keeps the file, and the backups can restore it.
- **Display adjustments are stored separately** from the images: `adjust`, `baseline` and `anchors` in `letters.json`, and per-word letter adjustments in `words.json`.
- **Every save and restore makes a backup first** (`server/.data/backups/`). Files are written atomically (temporary file, then rename).
- **The server never trusts the dashboard.** Image sizes and ink measurements are recomputed from the actual file; letters, forms, ids, paths and numbers are validated and clamped; unknown fields are dropped; and the result must pass the same validation the CAPTCHA engine uses.
- **Optimistic locking**: if the data changed since the dashboard loaded it, the save is refused rather than silently overwriting it.

### Security design (summary)

Passwords are stored only as salted **scrypt** hashes and verified in constant time. Sessions use a random 256-bit id, are held server-side (only a SHA-256 of the id is stored) and expire after 30 minutes idle or 8 hours absolute. The cookie is `HttpOnly; SameSite=Strict` (and `Secure` with the `__Host-` prefix under HTTPS). Every change requires a per-session **CSRF token** plus a same-origin check. Logins are **rate-limited**: 5 failures lock that client out for 15 minutes. Admin pages get a strict **Content-Security-Policy** (no inline scripts or styles), `X-Frame-Options: DENY`, `no-store` and `noindex`. There is no default password: without `npm run admin:setup` nobody can sign in. Details and threat model: [docs/ADMIN-SECURITY.md](docs/ADMIN-SECURITY.md).

### Hosting the dashboard online (optional)

Run the same server on any Node host (a VPS, Render, Fly.io, Railway) **behind HTTPS**:

```bash
npm run admin:setup -- --print-hash     # copy the printed hash
# on the host:
ADMIN_PASSWORD_HASH='scrypt$…' ADMIN_HOST=0.0.0.0 ADMIN_COOKIE_SECURE=1 ADMIN_TRUST_PROXY=1 \
GITHUB_TOKEN=… GITHUB_REPO=owner/name npm run admin
```

The host's disk may be temporary, so use the Publish button after saving: GitHub is the permanent copy, and Pages redeploys automatically. Never expose the server over plain HTTP on a public address; it prints a warning if you try.

## Letter identification

The 12 supplied images were inspected one by one. Filenames were not used. Identification is a human decision recorded in `src/data/letters.json` with a confidence level and a note.

| Sample | File | Letter | Form | Confidence | Used by default in |
|---|---|---|---|---|---|
| hw-01 | letter-01.png | **unknown** (ـكـ or ـهـ) | medial | low | not used |
| hw-02 | letter-02.png | ب | final ـب | high | حاسب |
| hw-03 | letter-03.png | ا | final ـا | high | حاسب |
| hw-04 | letter-04.png | د | final ـد | medium | فهد |
| hw-05 | letter-05.png | ح | initial حـ | medium | حاسب |
| hw-06 | letter-06.png | ب | medial ـبـ | high | (selectable in شبكات) |
| hw-07 | letter-07.png | س | initial سـ (flat, ruqʿa style) | medium | (selectable in حاسب) |
| hw-08 | letter-08.png | ف | initial فـ | high | فهد |
| hw-09 | letter-09.png | ت | isolated ت | high | شبكات |
| hw-10 | letter-10.png | ش | initial شـ (flat, caret dots) | medium | شبكات |
| hw-11 | letter-11.png | ه | medial ـهـ | high | (selectable in فهد) |
| hw-12 | letter-12.png | ا | final ـا | high | شبكات |

Every identified sample can be selected from the Letters panel for the word that needs it. The default mix in `words.json` keeps each word partly handwritten and partly typed.

## How the composition works

1. **Joining analysis** (`arabic-joining.js`): each letter gets its contextual form from Unicode joining types. ا and د do not connect forward, so the letter after them starts a new connected group.
2. **Pieces** (`glyph-factory.js`): every letter becomes a raster plus metrics: ink box, baseline, *entry* point (right side, where the previous letter joins) and *exit* point (left side). Handwritten metrics come from `letters.json`; typed metrics are detected from the shaped glyph.
3. **Layout** (`arabic-composer.js`): the first letter's ink starts at the right. A connected letter is placed so its entry point lands on the previous exit point, shifted by `overlap` so the strokes overlap rather than leaving a hairline gap. A letter after a non-connecting letter is placed `spacing` px left of all ink so far, so parts never collide.
   - *Snap to connection points* (default): joins are exact; each connected group is then centred on the shared baseline so slanted handwriting does not drift.
   - *Shared baseline*: every letter keeps its own baseline on one line, and joins may show small vertical steps.
4. **Rendering** (`captcha-engine.js`): seeded background, then the letters, then the effect pipeline (empty in this version), then optional guides. The word is only ever scaled down, uniformly, to fit the frame.

## Stroke thickness matching

`tools/calibration.html` measures every identified sample against the same letter and form typed in Cairo Light. Stroke width is estimated as 2 × ink area / perimeter, with the perimeter taken from the gradient of the anti-aliased ink. This gives the same answer for straight typed strokes and curved handwritten ones (unit-tested to within 6% at 0°, 30°, 45° and 90° for 3–6 px strokes).

| Measurement | Value |
|---|---|
| Handwritten pen width (median of 12 samples) | 2.83 px |
| Cairo Light stroke at 100 px | 4.75 px |
| Font size matching handwritten letter heights | 97 px |
| Cairo stroke at 97 px | 4.61 px (about 1.6× the handwriting) |
| Typed thickness setting | −2.0 px (outline thinning) |
| Resulting typed stroke | about 2.6–2.9 px, depending on the letter (handwritten samples: 2.7–3.0 px) |

Typed glyphs are thinned by erasing a stroke along the glyph outline (`destination-out`), which is clean vector processing. Thinning is capped at 3.5% of the font size so thin parts never disappear. Handwritten images are left untouched by default (thickness 0). The *Handwritten stroke* slider applies a controlled grey-scale dilation or erosion (erosion capped at 0.8 px radius so dots survive), and *Match typed to handwriting* recomputes the typed setting from live measurements. A mild edge-crispness step (`handwritten.edgeCrispness`) compensates for the softening caused by up-scaling; set it to 0 to disable it.

## Adding handwritten characters

1. Crop the letter onto a transparent background (an opaque white background also works). Save it as PNG in `public/assets/handwritten/`, for example `letter-13.png`. Leave a few pixels of margin around the ink.
2. Add an entry to `samples` in `src/data/letters.json`:
   ```json
   {
     "id": "hw-13",
     "file": "public/assets/handwritten/letter-13.png",
     "style": "handwritten",
     "status": "identified",
     "character": "ر",
     "form": "final",
     "confidence": "high",
     "writerId": "writer-02",
     "variant": 1,
     "baseline": 0,
     "anchors": { "entry": null, "exit": null },
     "adjust": { "offsetX": 0, "offsetY": 0, "scale": 1, "thickness": 0 },
     "notes": "",
     "source": { "collection": "writer-02-words" }
   }
   ```
   Add the writer to `writers` if it is new. If you are not sure which letter it is, use `"status": "unknown"`, `"character": null` and list `candidates`. The sample will appear in the gallery but will never be rendered.
3. Run `python3 tools/analyze_letters.py --update --reset-anchors` to fill in the image size, ink box, stroke width and suggested anchors. Without `--reset-anchors`, existing curated anchors are kept.
4. Check the anchors in the gallery preview (*Show connection points*) and in `/tools/composition-sheet.html`, and edit `baseline` and `anchors` by hand if needed. Medial and final forms need `entry`; initial and medial forms need `exit`.
5. Run `npm test`. It validates the database, file sizes and anchors.

Multiple samples per letter and form are supported: they all appear in the per-letter *Sample* menu, and a word can pin one with `"sample"`.

## Adding new words

Add an entry to `src/data/words.json`, with one character entry per letter in reading order:

```json
{
  "id": "bayt",
  "word": "بيت",
  "meaning": "house",
  "characters": [
    { "char": "ب", "form": "initial", "style": "handwritten" },
    { "char": "ي", "form": "medial", "style": "typed" },
    { "char": "ت", "form": "final", "style": "typed" }
  ]
}
```

`style` is `handwritten` or `typed`. `sample` is optional (by default the first identified sample with the right letter and form is used). `form` is documentation that the tests check against the joining rules. Optional per-letter `"adjust": { "scale", "offsetX", "offsetY", "thickness" }` fine-tunes one letter in one word. The word appears in the word picker automatically, and `npm test` reports any letter that asks for a handwritten form that does not exist.

## Editing character settings

| What to change | Where |
|---|---|
| Which letters are handwritten or typed, and which sample | `src/data/words.json` → `characters[].style`, `characters[].sample` |
| Fine-tune one letter in one word | `words.json` → `characters[].adjust` |
| Fine-tune a sample everywhere it is used | `letters.json` → `samples[].adjust` (offsets in original image px, scale, thickness) |
| Connection points and baseline of a sample | `letters.json` → `samples[].anchors`, `samples[].baseline` |
| Global size, spacing, overlap, baseline mode | `src/data/composition.json` → `layout` |
| Typed font size and stroke | `composition.json` → `typed.fontSize`, `typed.thickness` |
| Handwritten scale, stroke and edge crispness | `composition.json` → `handwritten` |
| Ink colour, default background, effects | `composition.json` → `render` |
| Slider ranges in the panel | `src/scripts/settings.js` → `SETTING_SPECS`, `CHARACTER_SPECS` |

Tip: tune visually in the app, then press **Copy settings JSON** and paste the values into the files above.

### Changing the font

1. Put the font file in `public/assets/fonts/`, with its licence.
2. In `composition.json`, set `typed.fontFile`, `typed.fontFamily` (any unique name) and `typed.fontWeight`.
3. Open `/tools/calibration.html` and copy the recommended `fontSize` and `thickness` into `composition.json`.
4. Optionally change the interface font in the `@font-face` rule at the top of `src/styles/main.css`.

The font must contain Arabic contextual forms (OpenType `init`, `medi` and `fina` features), which most Arabic fonts do.

## Known limitations

- **One unidentified image.** `letter-01.png` (hw-01) could be a medial kāf or a medial hā'. It is marked unknown and not used, so ك is always typed in شبكات. Once confirmed, set its `status`, `character` and `confidence` in `letters.json`.
- **Medium-confidence identifications.** hw-04 (ـد), hw-05 (حـ), hw-07 (سـ) and hw-10 (شـ) were identified partly from context (the letters the three words need). In particular, hw-05's S-shaped head can read as a ك in the composed word. These should be confirmed by the writer.
- **One sample per letter form** (two for final alif). Each word therefore renders the same letters every time. *New CAPTCHA* changes the background and, in random mode, the word.
- **Handwritten joins depend on the crop.** Connection strokes are as long as the writer drew them. For example, hw-05's exit stroke is short, so a typed alif after it sits tight against the head; the default for حاسب uses handwritten alif hw-03, whose long foot gives natural spacing. The tail of hw-04 (ـد) sweeps about 20 px below the connection line, which is how it was written.
- **Style contrast.** The handwriting is ruqʿa-like and horizontally stretched, while Cairo is a geometric naskh-style face. Stroke weight and letter height are matched, but letter proportions naturally differ.
- **Client-side verification.** The answer is held in browser memory and the word list is public. A real deployment needs server-side generation and verification.
- No advanced distortion in this version, by design. See `src/scripts/effects.js`.
- Accessibility: the CAPTCHA has no audio alternative yet. A production CAPTCHA needs one.
- **Admin dashboard**: it has a single owner account (no multiple users or roles), and sessions are kept in memory, so restarting the server signs you out. It edits the working copy on the machine where the server runs; GitHub Pages changes only after publishing. Rate limiting is per IP address (behind a proxy, set `ADMIN_TRUST_PROXY=1`).

## Future development

The architecture is ready for:

- **More writers and samples**: `writerId`, `variant` and `source` fields already exist. The resolver can choose randomly among samples (pass a different `sample` per render) without engine changes.
- **Contextual forms**: every sample declares its `form`, and the resolver matches letter and form.
- **Distortion**: register effects in `effects.js` and list them in `composition.json → render.effects`. Each effect receives the canvas, a seeded RNG and the full layout (letter boxes, joins), so it can target individual letters.
- **Per-letter rotation and jitter**: add fields to `adjust` and apply them in `CaptchaEngine.buildPiece`.
- **Generation modes**: random style assignment, random sample selection, multi-word CAPTCHAs.
- **Server verification**: the engine is DOM-light. Move generation to a worker or server and return only the image.

---

## إضافة حرف مكتوب بخط اليد دون تعديل المحرك

<div dir="rtl" lang="ar">

لا يحتاج إضافة حرف جديد إلى أي تعديل في ملفات المحرك (JavaScript)؛ كل ما يلزم ملف صورة وسطر في قاعدة البيانات:

1. احفظ صورة الحرف بصيغة PNG بخلفية شفافة (أو بيضاء) داخل المجلد `public/assets/handwritten/`، مثل `letter-13.png`، مع ترك هامش صغير حول الحبر.
2. أضف عنصرًا جديدًا إلى قائمة `samples` في الملف `src/data/letters.json`، وحدّد فيه: المعرّف `id`، ومسار الملف `file`، والحرف `character`، وشكله في الكلمة `form` (منفصل `isolated` أو بداية `initial` أو وسط `medial` أو نهاية `final`)، ودرجة الثقة، والكاتب `writerId`.
3. إذا لم تكن متأكدًا من الحرف فاجعل `status` بقيمة `unknown` و `character` بقيمة `null`؛ سيظهر في المعرض ولن يُستخدم في توليد الكابتشا.
4. شغّل الأمر `python3 tools/analyze_letters.py --update --reset-anchors` لقياس أبعاد الصورة ومنطقة الحبر وسماكة الخط واقتراح نقاط الاتصال تلقائيًا.
5. راجع نقاط الاتصال من معاينة الحرف في المعرض (خيار «إظهار نقاط الاتصال»): حرف الوسط والنهاية يحتاج نقطة دخول `entry` من اليمين، وحرف البداية والوسط يحتاج نقطة خروج `exit` من اليسار.
6. لاستخدام الحرف في كلمة، اجعل `style` بقيمة `handwritten` لذلك الحرف في الملف `src/data/words.json` (ويمكن تحديد العينة عبر `sample`).
7. شغّل `npm test` للتأكد من صحة البيانات.

**أو من لوحة التحكم الخاصة (أسهل):** شغّل `npm run admin:setup` مرة واحدة لاختيار كلمة المرور، ثم `npm run admin` وافتح `http://127.0.0.1:8787/admin`. من قسم «الحروف» اضغط «رفع صورة حرف جديدة»، اختر الحرف وشكله، وحدّد نقاط الاتصال بالنقر على الصورة، ثم اضغط «حفظ وتطبيق». الصور الأصلية لا تُعدَّل ولا تُحذف، وتُحفظ نسخة احتياطية قبل كل حفظ. لتحديث موقع GitHub Pages انشر التغييرات (زر النشر أو `git push`).

</div>

## License

Code: MIT (see `LICENSE`), including the admin server and dashboard. Cairo Light font: SIL Open Font License 1.1 (`public/assets/fonts/OFL.txt`). Handwritten samples: supplied by the project owner for research use.
