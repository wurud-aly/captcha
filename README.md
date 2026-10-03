# Arabic CAPTCHA: arrange the letters

A minimal Arabic human-verification page. The visitor sees the letters of a random Arabic word in scrambled order, drags them into the right order, and presses **تحقّق** (Verify).

- Correct → green checkmark and «تم التحقق بنجاح. أنت إنسان.» (Verification successful. You are human.)
- Wrong → «إجابة غير صحيحة. حاول مرة أخرى.» (Incorrect answer. Please try again.); the letters stay movable.

The page shows nothing else: no menus, settings or developer information.

## How it works

1. `src/data/words.json` holds the word list.
2. On every page load a random word is chosen. The word from the previous visit is skipped whenever another word exists; only a short fingerprint of it is stored in the browser, never the word itself.
3. The word is split into its letters (diacritics stay attached to their letter), and the letters are shuffled. The scrambled order is never the correct one.
4. Only that word's letters are shown, one per tile, in a right-to-left row.
5. Letters can be moved by:
   - **dragging** with a mouse, finger or pen (Pointer Events; the other tiles slide aside);
   - **tapping** one letter, then another, to swap them;
   - **keyboard**: Tab to a letter, then ← / → to move it.
6. **تحقّق** compares the arrangement, in reading order, with the word.

The ↻ button in the corner loads a new word.

## Project structure

```
index.html                 the CAPTCHA page (Arabic, RTL)
src/
  data/words.json          the word list
  scripts/
    challenge.js           pick word, split letters, scramble, check (pure logic)
    drag-sort.js           drag-and-drop / tap / keyboard reordering of the tiles
    app.js                 wires the page together
  styles/main.css          design (responsive, reduced-motion aware)
public/
  favicon.svg
  assets/fonts/            Cairo Light (local, SIL Open Font License)
scripts/
  serve.mjs                local static server (can simulate the GitHub Pages sub-path)
  build-pages.mjs          builds the GitHub Pages bundle
tests/
  unit/                    logic and project checks (Node, no dependencies)
  e2e/run-e2e.mjs          browser tests: mouse drag, touch drag, keyboard, refresh, sub-path
.github/workflows/         tests on every push; GitHub Pages deployment
```

## Run locally

Requires Node.js 18 or newer (only to serve the files; the site has no dependencies).

```bash
npm start              # http://localhost:8080/
npm run start:pages    # http://localhost:8080/arabic-hybrid-captcha/  (same sub-path as GitHub Pages)
```

The page loads the word list with `fetch`, so open it through a server, not by double-clicking `index.html`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (for example `arabic-hybrid-captcha`) on the `main` branch.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow `.github/workflows/pages.yml` runs the tests and publishes `index.html`, `public/` and `src/`. The site appears at `https://<user>.github.io/arabic-hybrid-captcha/`.

All paths are relative, so it works under any repository name. (*Deploy from a branch*, `main` / root, also works.)

## Change the words

Edit `src/data/words.json`:

```json
{ "words": ["شبكات", "حاسب", "فهد", "مدرسة"] }
```

Each word needs at least two letters. Words with repeated letters are fine: identical letters are interchangeable when checking. Push the change, and GitHub Pages updates automatically.

## Tests

```bash
npm test                         # logic + project checks (no install needed)
npm install                      # once: Playwright
npx playwright install chromium  # once: browser
npm run test:e2e                 # full browser test under /arabic-hybrid-captcha/
```

The browser test drags letters with a real mouse on desktop and with real touch events on an emulated phone. It checks the wrong-answer and success messages, that the page never scrolls during a touch drag, tap-to-swap, keyboard moves, that 15 consecutive reloads never repeat the previous word, that the answer is not exposed in the page, that the card is centred and fits a 390 px screen, and that there are no failed requests or console errors. Screenshots go to `tests/e2e/output/`.

## Limitations

This is a static site, so the check runs in the visitor's browser and the word list file is publicly downloadable. That is fine for a demonstration or a light speed bump, but it cannot stop a determined bot. For real protection, generate the challenge and check the answer on a server.

## إضافة كلمات

<div dir="rtl" lang="ar">

لإضافة كلمة جديدة أضِفها إلى القائمة في الملف `src/data/words.json` ثم ارفع التغيير إلى GitHub، وستظهر تلقائيًا ضمن الكلمات العشوائية. يجب أن تتكوّن كل كلمة من حرفين على الأقل.

</div>

## License

Code: MIT (`LICENSE`). Cairo Light font: SIL Open Font License 1.1 (`public/assets/fonts/OFL.txt`).
