# Blackout PDF

**True PDF redaction, entirely in your browser.** No uploads, no server, no
tracking. Auto-detects Social Security numbers, emails, phone numbers and card
numbers; supports custom term search and hand-drawn boxes; exports a flattened
PDF where the redacted text is *actually gone*, not hidden under a rectangle.

**Live:** deployed via GitHub Pages (see the Actions tab / repo website field).

## Why it's different

1. **Nothing leaves your device.** Rendering (pdf.js), detection, and export
   (pdf-lib) all run client-side. Load the page, go offline, it still works.
2. **Redaction is real.** Export rasterizes each page and burns the boxes into
   the pixels, then rebuilds the PDF from those images. The original text layer
   is discarded — copy-paste and text extraction recover nothing. (Verified in
   CI-able smoke: `scripts/smoke.mjs` asserts the export has zero extractable
   text.)

## Develop

```bash
npm install
npm run dev       # local dev server
npm run build     # type-check + production build to dist/
node scripts/smoke.mjs [test.pdf]         # headless end-to-end test
node scripts/visual-check.mjs [test.pdf] [outdir]  # screenshot spot-check
```

The smoke scripts need a Chrome/Chromium binary; set `CHROME_BIN` if yours
isn't in the default Playwright cache location.

## Deployment

Pushes to `main` auto-deploy to GitHub Pages via
`.github/workflows/deploy.yml`. The build uses relative asset paths, so the
same artifact works on `*.github.io/blackout-pdf/` and on a custom domain.

## Monetization

Free tier: documents up to 10 pages. Pro ($25 one-time): unlimited. All
commercial knobs live in [`src/config.ts`](src/config.ts); the go-live
checklist is in [`docs/MONETIZATION.md`](docs/MONETIZATION.md).

## License

Source-visible for transparency and audit (the privacy claims should be
verifiable). All rights reserved — please don't republish this as your own
product.
