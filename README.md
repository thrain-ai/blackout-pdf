<p align="center">
  <img src="docs/logo.svg" alt="Blackout PDF" width="180" />
</p>

<h1 align="center">Blackout PDF</h1>

<p align="center">
  <strong>True PDF redaction, entirely in your browser.</strong><br />
  <a href="https://blackout.thrain.ai">blackout.thrain.ai</a>
</p>

---

Blackout finds Social Security numbers, emails, phone numbers and card numbers
in a PDF, lets you search custom terms or draw boxes by hand, and exports a
flattened PDF where the redacted text is *actually gone* — not hidden under a
rectangle.

## How it works

1. **Nothing leaves your device.** Rendering (pdf.js), detection, and export
   (pdf-lib) all run client-side. Load the page, go offline, it still works.
2. **Redaction is real.** Export rasterizes each page and burns the boxes into
   the pixels, then rebuilds the PDF from those images. The original text
   layer is discarded — copy-paste and text extraction recover nothing.

## Develop

```bash
npm install
npm run dev       # local dev server
npm run build     # type-check + production build to dist/
node scripts/smoke.mjs [test.pdf]                  # headless end-to-end test
node scripts/test-worker.mjs                       # license worker tests
node scripts/visual-check.mjs [test.pdf] [outdir]  # screenshot spot-check
```

The smoke scripts need a Chrome/Chromium binary; set `CHROME_BIN` if yours
isn't in the default Playwright cache location. The end-to-end test asserts
that exported PDFs contain zero extractable text.

## Architecture

- **Site** — static React app, deployed to GitHub Pages by
  `.github/workflows/deploy.yml` on every push to `main`.
- **License worker** (`worker/`) — a Cloudflare Worker that verifies Stripe
  checkout sessions and mints signed license tokens; the app verifies them
  with an embedded public key. Deployed by
  `.github/workflows/deploy-worker.yml`.

## License

© Thrain LLC. Source available for transparency and audit; all rights
reserved.
