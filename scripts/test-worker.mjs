// License worker tests — run with: node scripts/test-worker.mjs
// Imports the worker module directly and points it at a mock Stripe API, then
// proves: real paid sessions mint verifiable tokens; fake/unpaid sessions
// don't; tampered tokens fail verification.

import { createServer } from "node:http";
import worker from "../worker/src/index.js";

const fail = (m) => {
  console.error("WORKER TEST FAIL:", m);
  process.exit(1);
};
const ok = (m) => console.log("  ok:", m);

// --- keypair for the test run ------------------------------------------------
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const privJwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));

// --- mock Stripe -------------------------------------------------------------
const PAID_SID = "cs_live_a1PAIDSESSION";
const UNPAID_SID = "cs_live_a1UNPAIDSESSION";
const sentEmails = [];
const mock = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  // Mock Resend: capture sends.
  if (req.url === "/emails" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      sentEmails.push(JSON.parse(body));
      res.end(JSON.stringify({ id: "mock-email" }));
    });
    return;
  }
  // Mock Stripe below.
  if (req.headers.authorization !== "Bearer sk_test_mockkey") {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: { message: "bad key" } }));
  }
  if (req.url === `/v1/checkout/sessions/${PAID_SID}`) {
    return res.end(
      JSON.stringify({
        id: PAID_SID,
        payment_status: "paid",
        customer_details: { email: "buyer@example.com" },
      }),
    );
  }
  if (req.url === `/v1/checkout/sessions/${UNPAID_SID}`) {
    return res.end(JSON.stringify({ id: UNPAID_SID, payment_status: "unpaid" }));
  }
  // Sessions list filtered by buyer email (the payment-link-compatible
  // restore path — no Customer object required).
  if (req.url.startsWith("/v1/checkout/sessions?")) {
    const q = new URL(req.url, "http://x").searchParams;
    const email = q.get("customer_details[email]");
    if (email === "buyer@example.com") {
      return res.end(
        JSON.stringify({
          data: [
            { id: "cs_live_a1OLDEXPIRED", payment_status: "unpaid" },
            { id: PAID_SID, payment_status: "paid" },
          ],
        }),
      );
    }
    return res.end(JSON.stringify({ data: [] }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: { message: "No such checkout.session" } }));
});
await new Promise((r) => mock.listen(9377, "127.0.0.1", r));

const env = {
  STRIPE_SECRET_KEY: "sk_test_mockkey",
  STRIPE_API_BASE: "http://127.0.0.1:9377",
  LICENSE_SIGNING_KEY: privJwk,
  ALLOWED_ORIGIN: "https://blackout.thrain.ai",
  SITE_URL: "https://blackout.thrain.ai",
};
const ctx = { waitUntil: () => {} };

const call = (path, body) =>
  worker.fetch(
    new Request(`https://worker.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    ctx,
  );

// --- client-side verify (mirrors src/license.ts) -----------------------------
const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );
};
async function verify(token) {
  const [p, s] = token.split(".");
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    b64urlToBytes(s),
    b64urlToBytes(p),
  );
}

// 1. Paid session → valid token
let res = await call("/activate", { session_id: PAID_SID });
let data = await res.json();
if (res.status !== 200 || !data.token) fail("paid session did not mint a token");
if (!(await verify(data.token))) fail("minted token does not verify");
if (data.email !== "buyer@example.com") fail("email missing from response");
ok("paid session mints a token that verifies against the public key");

// 2. Unpaid session → rejected
res = await call("/activate", { session_id: UNPAID_SID });
if (res.status !== 402 || (await res.json()).token) fail("unpaid session was accepted");
ok("unpaid session rejected");

// 3. Nonexistent session (the fake-success attack) → rejected
res = await call("/activate", { session_id: "cs_live_a1TOTALLYFAKE" });
if (res.status !== 404 || (await res.json()).token) fail("fake session was accepted");
ok("invented session id rejected — fake-success attack dead");

// 4. Garbage input → rejected without hitting Stripe
res = await call("/activate", { session_id: "'; DROP TABLE --" });
if (res.status !== 400) fail("malformed session id not rejected");
ok("malformed session id rejected");

// 5. Tampered token fails verification
const [p, s] = data.token.split(".");
const forged =
  btoa(JSON.stringify({ e: "hacker@example.com", s: "cs_live_x", t: 0 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "") + "." + s;
if (await verify(forged)) fail("forged payload passed verification");
ok("tampered token fails verification");

// 6. /restore without Resend key → 501, no info leak
res = await call("/restore", { email: "buyer@example.com" });
if (res.status !== 501) fail("restore without email provider should be 501");
ok("restore degrades gracefully without email provider");

// 7. /restore with Resend configured: buyer email → activation email with a
// VERIFIABLE token link (sessions queried by email — no Customer needed)
const waits = [];
const envMail = {
  ...env,
  RESEND_API_KEY: "re_mockkey",
  RESEND_API_BASE: "http://127.0.0.1:9377",
};
const ctxMail = { waitUntil: (p) => waits.push(p) };
res = await worker.fetch(
  new Request("https://worker.test/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "buyer@example.com" }),
  }),
  envMail,
  ctxMail,
);
if (res.status !== 200) fail("restore for buyer should 200");
await Promise.all(waits);
if (sentEmails.length !== 1) fail(`expected 1 restore email, got ${sentEmails.length}`);
const mail = sentEmails[0];
if (mail.to[0] !== "buyer@example.com") fail("restore email went to wrong address");
const tokenMatch = mail.text.match(/license_token=([^\s&]+)/);
if (!tokenMatch) fail("restore email has no license_token link");
if (!(await verify(decodeURIComponent(tokenMatch[1]))))
  fail("restore email token does not verify");
ok("buyer restore sends email with a verifiable activation link");

// 8. /restore for a stranger: no email sent, same generic response
res = await worker.fetch(
  new Request("https://worker.test/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "stranger@example.com" }),
  }),
  envMail,
  ctxMail,
);
await Promise.all(waits);
if (res.status !== 200) fail("stranger restore should still 200 (no enumeration)");
if (sentEmails.length !== 1) fail("stranger should not receive an email");
ok("non-buyer email gets no send, identical generic response");

mock.close();
console.log("\nWORKER TESTS PASS ✅");
