// Offline licence verification — no DOM, no storage, no network.
//
// Split out of license.ts so the CLI and MCP server can verify a token without
// dragging in localStorage and the browser-only activation flows. The logic is
// unchanged; license.ts re-exports it, so the web app is untouched.
//
// Token format: base64url(JSON payload) + "." + base64url(ECDSA-P256 sig).
// The private key lives only in the worker; we hold the public half, which can
// check a token but never mint one. That is why this works with no network
// call — and it must stay that way: a licence check that phones home would
// break the promise that the document never leaves the machine.
import { LICENSE_PUBLIC_KEY } from "./config.ts";

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

let pubKeyPromise: Promise<CryptoKey> | null = null;
function publicKey(): Promise<CryptoKey> {
  pubKeyPromise ??= crypto.subtle.importKey(
    "jwk",
    LICENSE_PUBLIC_KEY,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return pubKeyPromise;
}

export async function verifyToken(
  token: string,
): Promise<{ valid: boolean; email?: string }> {
  try {
    const [payloadB64, sigB64] = token.split(".");
    if (!payloadB64 || !sigB64) return { valid: false };
    const payload = b64urlToBytes(payloadB64);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await publicKey(),
      b64urlToBytes(sigB64) as BufferSource,
      payload as BufferSource,
    );
    if (!ok) return { valid: false };
    const data = JSON.parse(new TextDecoder().decode(payload));
    return { valid: true, email: data.e ?? undefined };
  } catch {
    return { valid: false };
  }
}
