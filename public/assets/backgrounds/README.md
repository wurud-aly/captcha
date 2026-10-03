# Backgrounds

The four CAPTCHA backgrounds in this version (paper, plain, ruled, speckle) are
generated procedurally in `src/scripts/backgrounds.js`, so no image files are
needed and every background is reproducible from its seed.

To use an image background, place it here (for example `parchment.png`) and
register a painter in `backgrounds.js`:

```js
const img = new Image();
img.src = new URL('public/assets/backgrounds/parchment.png', document.baseURI).href;
registerBackground('parchment', (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h));
```

then add `'parchment'` to `SETTING_SPECS.background.options` in `settings.js`
and a `bg_parchment` label to both languages in `i18n.js`.
Keep backgrounds light and low-contrast so they never hide letter strokes.
