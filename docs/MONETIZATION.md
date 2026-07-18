# Monetization playbook

Goal set at kickoff (2026-07-18): **first $100 revenue within 30 days.**
Running cost: **$0/month** (GitHub Pages). Everything below is a one-time
setup step or a marketing action.

## 1. Payments — LIVE as of 2026-07-18 ✅

Checkout runs on a **Stripe payment link** (Managed Payments handles tax as
merchant of record) wired into `src/config.ts`:

- Product: **Blackout PDF Pro**, $25 one-time.
- The payment link's after-payment setting redirects to
  `<site>/?checkout=success&session_id={CHECKOUT_SESSION_ID}`, which
  auto-activates Pro on the buyer's device (`src/license.ts`) — no backend.
- Cross-device activation is manual for now (buyer emails their receipt).
  If sales justify it, add a free Cloudflare Worker that verifies the
  session id against Stripe and mints a signed license key.
- To change the price: update it in Stripe AND `PRO_PRICE_LABEL` in
  `src/config.ts`.

(The original Lemon Squeezy license-key path still exists in `license.ts`
and activates automatically if `CHECKOUT_URL` is ever pointed at a
non-Stripe provider.)

## 2. Point a domain at it (~10 minutes)

Pick whichever owned domain fits (something privacy/office-tools flavored).

1. Repo → Settings → Pages → Custom domain → enter it (this commits a `CNAME`
   file).
2. At the DNS provider: `CNAME` record, host `@` (or `www`), value
   `baybailz.github.io`. Apex domains: 4 `A` records to GitHub Pages IPs
   (185.199.108–111.153).
3. Wait for the cert, enable "Enforce HTTPS".

A real domain matters for this product: trust is the whole pitch.

## 3. Launch channels (free, do over week 1–2)

- **Product Hunt** — privacy tools do well; lead with the "black rectangle is
  not a redaction" story and the offline demo.
- **Hacker News (Show HN)** — same angle; the client-side/verifiable-privacy
  crowd is exactly HN.
- **Reddit**: r/privacy, r/selfhosted, r/paralegal, r/humanresources — answer
  real "how do I redact a PDF safely" posts, don't spam.
- **SEO**: the FAQ already targets "redact pdf without uploading", "is pdf
  redaction safe", "redact pdf free no watermark". Add a blog page per
  audience later (lawyers, HR, landlords) if traffic shows up.

## 4. Measure without breaking the privacy pitch

No analytics scripts are included (it's a selling point). Options that keep
the promise:
- Cloudflare in front of the custom domain → server-side request counts, zero
  client JS.
- GitHub traffic tab (Insights → Traffic) for a rough weekly view.
- Lemon Squeezy dashboard is the revenue source of truth.

## 5. Later levers (only if v1 gets traction)

- OCR for scanned PDFs (tesseract.js, still client-side) — big Pro feature.
- Batch mode (redact N files with saved pattern sets) — the "paralegal
  Tuesday afternoon" use case, justifies a $79 tier.
- Team licenses / invoicing for firms.
- A `/api` version (server-side, metered) only if businesses ask.
