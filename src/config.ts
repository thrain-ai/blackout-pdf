// ---------------------------------------------------------------------------
// Monetization switchboard. Everything commercial is configured here so
// flipping revenue on is a one-line change per field. See docs/MONETIZATION.md.
// ---------------------------------------------------------------------------

export const PRODUCT_NAME = "Blackout PDF";

// Pages allowed per export on the free tier.
export const FREE_PAGE_LIMIT = 10;

export const PRO_PRICE_LABEL = "$29";

// Checkout link for the Pro lifetime license (Stripe payment link,
// https://buy.stripe.com/...). The payment link's after-payment setting must
// redirect to <site>/?checkout=success&session_id={CHECKOUT_SESSION_ID} so Pro
// auto-activates. While null, Pro buttons show a waitlist mailto instead.
export const CHECKOUT_URL: string | null =
  "https://buy.stripe.com/fZucN53nTbrEbNWbEBcAo00";

// Lemon Squeezy license validation (their /v1/licenses/validate endpoint is
// public + CORS-enabled; no API key needed). Leave as-is.
export const LICENSE_VALIDATE_URL =
  "https://api.lemonsqueezy.com/v1/licenses/validate";

// Fallback contact while checkout is not yet live.
export const CONTACT_EMAIL = "baileyrthomp@gmail.com";
