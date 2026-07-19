// ---------------------------------------------------------------------------
// Monetization switchboard. Everything commercial is configured here so
// flipping revenue on is a one-line change per field. See docs/MONETIZATION.md.
// ---------------------------------------------------------------------------

export const PRODUCT_NAME = "Blackout PDF";

// Pages allowed per export on the free tier.
export const FREE_PAGE_LIMIT = 10;

export const PRO_PRICE_LABEL = "$25";

// Checkout link for the Pro lifetime license (Stripe payment link,
// https://buy.stripe.com/...). The payment link's after-payment setting must
// redirect to <site>/?checkout=success&session_id={CHECKOUT_SESSION_ID} so Pro
// auto-activates. While null, Pro buttons show a waitlist mailto instead.
export const CHECKOUT_URL: string | null =
  "https://buy.stripe.com/fZucN53nTbrEbNWbEBcAo00";

// License worker (the "bouncer"): verifies checkout sessions against Stripe
// server-side and mints signed tokens. While null, the app falls back to the
// launch-era honor-system redirect unlock. Set to the deployed workers.dev
// URL (no trailing slash) to enforce real licensing.
export const WORKER_URL: string | null =
  "https://blackout-license.thrain.workers.dev";

// Public half of the license signing keypair (worker holds the private half).
// Verifies tokens locally — works offline, can't mint them.
export const LICENSE_PUBLIC_KEY: JsonWebKey = {
  key_ops: ["verify"],
  ext: true,
  kty: "EC",
  x: "E3_xJzsr0uzyTsx4EvX4SyN8Ltaxg9Zmo5H_wJ88Abs",
  y: "6TgGGKzJTzZht2EkzNtVrCWyzcN2cYmt5sjFLwKjdyw",
  crv: "P-256",
};

// Lemon Squeezy license validation (kept for a potential non-Stripe future).
export const LICENSE_VALIDATE_URL =
  "https://api.lemonsqueezy.com/v1/licenses/validate";

// Fallback contact while checkout is not yet live.
export const CONTACT_EMAIL = "baileyrthomp@gmail.com";
