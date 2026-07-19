// Blackout PDF license worker — the "bouncer".
//
// The static site can't hold secrets, so this Worker is the only party that
// can (a) ask Stripe whether a checkout session is genuinely paid and (b) mint
// signed license tokens. The site verifies tokens with the embedded PUBLIC
// key; forging a token requires the private key, which lives only in this
// Worker's secrets.
//
// Secrets (set in the Cloudflare dashboard or `wrangler secret put`):
//   STRIPE_SECRET_KEY   — a RESTRICTED Stripe key: read-only on Checkout
//                         Sessions + Customers is all it needs.
//   LICENSE_SIGNING_KEY — ECDSA P-256 private key, JWK JSON (generated once).
//   RESEND_API_KEY      — optional; enables /restore emails.
// Vars (wrangler.toml):
//   SITE_URL, ALLOWED_ORIGIN
// Test override:
//   STRIPE_API_BASE     — point at a mock Stripe in tests.

const enc = new TextEncoder();

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function signToken(env, payload) {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(env.LICENSE_SIGNING_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const body = enc.encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, body);
  return `${b64url(body)}.${b64url(sig)}`;
}

async function stripeGet(env, path) {
  const base = env.STRIPE_API_BASE || "https://api.stripe.com";
  const res = await fetch(base + path, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `stripe ${res.status}`);
  }
  return data;
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Content-Type": "application/json",
  };
}

const json = (env, status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: corsHeaders(env) });

// POST /activate {session_id} -> {token, email}
// The session id is worthless unless Stripe itself confirms it's paid.
async function activate(env, body) {
  const sid = String(body.session_id || "");
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)) {
    return json(env, 400, { error: "That doesn't look like a checkout session." });
  }
  let session;
  try {
    session = await stripeGet(env, `/v1/checkout/sessions/${encodeURIComponent(sid)}`);
  } catch {
    return json(env, 404, { error: "Purchase not found. If you just paid, try again in a minute." });
  }
  if (session.payment_status !== "paid") {
    return json(env, 402, { error: "This checkout was never completed." });
  }
  const email = session.customer_details?.email || null;
  const token = await signToken(env, { e: email, s: session.id, t: Date.now() });
  return json(env, 200, { token, email });
}

// POST /restore {email} -> generic ok (never reveals whether email has a
// purchase). If a paid purchase exists, a one-time activation link is emailed —
// possession of the inbox is the proof of ownership.
async function restore(env, body, ctx) {
  if (!env.RESEND_API_KEY) {
    return json(env, 501, {
      error: "Restore-by-email isn't enabled yet — contact support with your receipt.",
    });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(env, 400, { error: "Enter a valid email address." });
  }

  // Do the lookup + send after responding, so response timing can't be used
  // to probe which emails have purchases.
  //
  // NOTE: query checkout sessions by customer_details[email], NOT the
  // Customers list — payment-link checkouts often never create a Customer
  // object, so a customer search finds nothing and no email ever sends.
  ctx.waitUntil(
    (async () => {
      try {
        const sessions = await stripeGet(
          env,
          `/v1/checkout/sessions?customer_details[email]=${encodeURIComponent(email)}&limit=20`,
        );
        const paid = (sessions.data || []).find(
          (s) => s.payment_status === "paid",
        );
        if (!paid) return;
        const token = await signToken(env, { e: email, s: paid.id, t: Date.now() });
        const link = `${env.SITE_URL}/?license_token=${encodeURIComponent(token)}`;
        const resendBase = env.RESEND_API_BASE || "https://api.resend.com";
        await fetch(`${resendBase}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: env.MAIL_FROM || "Blackout PDF <onboarding@resend.dev>",
            to: [email],
            subject: "Your Blackout PDF Pro activation link",
            text:
              `Click to activate Blackout PDF Pro on this device:\n\n${link}\n\n` +
              `The link works on any device you open it on. Keep this email — ` +
              `it's your license.\n`,
          }),
        });
      } catch {
        // Swallow: the caller already got the generic response.
      }
    })(),
  );
  return json(env, 200, {
    ok: true,
    message: "If that email has a purchase, an activation link is on its way.",
  });
}

// GET /health — proves configuration without exposing secrets: signs a probe
// and verifies it with the public half derived from the same JWK (x/y are
// public by definition), and makes one read-only Stripe call. Returns the
// public coordinates so the site's embedded key can be compared.
async function health(env) {
  const out = { signing: false, stripe: false, pub: null };
  try {
    const jwk = JSON.parse(env.LICENSE_SIGNING_KEY);
    const token = await signToken(env, { probe: true });
    const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    const pubKey = await crypto.subtle.importKey(
      "jwk",
      pub,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const [p, s] = token.split(".");
    const fromB64 = (v) =>
      Uint8Array.from(
        atob(v.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (v.length % 4)) % 4)),
        (c) => c.charCodeAt(0),
      );
    out.signing = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      fromB64(s),
      fromB64(p),
    );
    out.pub = { x: jwk.x, y: jwk.y };
  } catch {
    /* signing stays false */
  }
  try {
    await stripeGet(env, "/v1/customers?limit=1");
    out.stripe = true;
  } catch {
    /* stripe stays false */
  }
  return json(env, out.signing && out.stripe ? 200 : 500, out);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return health(env);
    }
    if (request.method !== "POST") {
      return json(env, 405, { error: "POST only" });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json(env, 400, { error: "JSON body required" });
    }
    if (url.pathname === "/activate") return activate(env, body);
    if (url.pathname === "/restore") return restore(env, body, ctx);
    return json(env, 404, { error: "not found" });
  },
};
