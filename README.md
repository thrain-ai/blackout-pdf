<p align="center">
  <img src="docs/logo.svg" alt="Blackout" width="180" />
</p>

<h1 align="center">Blackout</h1>

<p align="center">
  <strong>True PDF redaction, entirely in your browser.</strong><br />
  <a href="https://blackout.thrain.ai">blackout.thrain.ai</a>
</p>

---

Blackout finds Social Security numbers, emails, phone numbers and card numbers
in a PDF, lets you search custom terms or draw boxes by hand, and exports a
flattened PDF where the redacted text is *actually gone* — not hidden under a
rectangle.

It runs in three places, all on the same engine: the browser app, a CLI, and an
MCP server.

```bash
npx @thrain/blackout redact filing.pdf --detect ssn,email --out clean.pdf
```

## How it works

1. **Nothing leaves your device.** Rendering (pdf.js), detection, and export
   (pdf-lib) all run client-side. Load the page, go offline, it still works.
2. **Redaction is real.** Export rasterizes each page and burns the boxes into
   the pixels, then rebuilds the PDF from those images. The original text
   layer is discarded — copy-paste and text extraction recover nothing.

## Develop

```bash
npm install
npm install
npm run dev         # local dev server
npm run build       # type-check + production build to dist/
npm run build:agent # type-check + bundle the CLI and MCP server to packages/

npm run smoke              # headless browser end-to-end test
npm run smoke:cli          # CLI end-to-end test
npm run smoke:mcp          # MCP server end-to-end test
npm run smoke:agent-dist   # the same two, against the built bundles

node scripts/make-test-pdf.mjs out.pdf 12           # fixture with fake PII
node scripts/test-worker.mjs                        # license worker tests
node scripts/visual-check.mjs [test.pdf] [outdir]   # screenshot spot-check
```

The browser smoke script needs a Chrome/Chromium binary; set `CHROME_BIN` if
yours isn't in the default Playwright cache location. Every smoke test makes
the same central assertion — that the exported PDF contains **zero** extractable
text — because that assertion is the entire product, and it has to hold on
every path that ships, not just the one that is easy to check.

## Architecture

- **Engine** (`src/pdf/`) — detection, mark ordering, and the rasterise-and-burn
  export. Platform-agnostic: its only contact with the outside world is
  `src/pdf/platform.ts`, which supplies a canvas. `src/platform/browser.ts`
  backs it with a DOM canvas, `src/platform/node.ts` with Skia. There is exactly
  one redaction implementation, so the browser and the CLI cannot drift.
- **Site** — static React app, deployed to GitHub Pages by
  `.github/workflows/deploy.yml` on every push to `main`.
- **CLI and MCP server** (`src/agent/`) — thin non-interactive wrappers over the
  engine, bundled into `packages/blackout` and `packages/blackout-mcp`.
- **License worker** (`worker/`) — a Cloudflare Worker that verifies Stripe
  checkout sessions and mints signed license tokens; the app verifies them
  with an embedded public key. Deployed by
  `.github/workflows/deploy-worker.yml`.

## For agents

An agent asked to redact a PDF will otherwise write a script that draws a black
rectangle over text that stays selectable underneath. Two form factors exist so
that "redact this PDF" can resolve to a tool that does it correctly:

- **CLI** — [`packages/blackout`](packages/blackout) · `npx @thrain/blackout redact in.pdf`
- **MCP server** — [`packages/blackout-mcp`](packages/blackout-mcp) · tools `redact_pdf`, `check_pdf`

Both verify their own output before returning: they re-extract text from the
file they just wrote and fail rather than hand back a document that still has a
text layer. Neither makes a network call, including the licence check — so
nothing leaves the machine at all.

## License

© Thrain LLC. Source available for transparency and audit; all rights
reserved.
