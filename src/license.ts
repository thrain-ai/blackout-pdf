import { WORKER_URL } from "./config.ts";
// Signed-token verification (the real licensing path, once WORKER_URL is set)
// lives in licenseVerify.ts so the CLI can share it without the browser bits.
import { verifyToken } from "./licenseVerify.ts";

export { verifyToken };

const STORAGE_KEY = "blackout-pdf-license";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function stored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode etc. — Pro just won't persist */
  }
}

// ---------------------------------------------------------------------------
// Activation paths
// ---------------------------------------------------------------------------

async function activateSessionWithWorker(sid: string): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      store(data.token);
      return true;
    }
  } catch {
    /* worker unreachable — treated as not activated */
  }
  return false;
}

// Handles every way a page load can carry a license:
//   ?checkout=success&session_id=...  (Stripe post-payment redirect)
//   ?license_token=...                (restore-purchase email link)
// Returns true if Pro was newly activated by this load.
export async function activateFromUrl(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const scrub = () =>
    history.replaceState(null, "", window.location.pathname);

  // Dev-only UI preview of the Pro experience (?dev_pro=1). import.meta.env.DEV
  // is false in production builds, so this branch is dead-code-eliminated —
  // it does not exist in the deployed bundle.
  if (import.meta.env.DEV && params.get("dev_pro")) {
    scrub();
    store("dev");
    return true;
  }

  const linkToken = params.get("license_token");
  if (linkToken) {
    scrub();
    if ((await verifyToken(linkToken)).valid) {
      store(linkToken);
      return true;
    }
    return false;
  }

  const sid = params.get("session_id");
  const success = params.get("checkout") === "success";
  if (!sid && !success) return false;
  scrub();

  if (WORKER_URL) {
    // Real path: only Stripe's word (via the worker) mints a license.
    return sid ? activateSessionWithWorker(sid) : false;
  }

  // Launch-era fallback (no worker deployed): honor-system unlock.
  if (success || (sid && /^cs_(live|test)_/.test(sid))) {
    store("stripe:" + (sid ?? "receipt"));
    return true;
  }
  return false;
}

// Is this device licensed? Verifies the stored signed token; transparently
// upgrades legacy honor-system unlocks ("stripe:cs_...") to signed tokens via
// the worker once it exists, so early buyers keep Pro without noticing.
export async function isLicensed(): Promise<boolean> {
  const value = stored();
  if (!value) return false;

  if (import.meta.env.DEV && value === "dev") return true;

  if (value.startsWith("stripe:")) {
    if (!WORKER_URL) return true; // launch-era behavior
    const sid = value.slice("stripe:".length);
    if (/^cs_(live|test)_/.test(sid)) {
      return activateSessionWithWorker(sid);
    }
    return false;
  }

  return (await verifyToken(value)).valid;
}

/**
 * The stored license token, but only when it is a real signed token that the
 * CLI and MCP server can actually verify offline. Legacy honor-system unlocks
 * ("stripe:cs_…") and the dev placeholder are deliberately withheld: handing
 * one of those to `BLACKOUT_LICENSE` would fail verification and look like a
 * broken purchase rather than an old activation.
 */
export async function portableToken(): Promise<string | null> {
  const value = stored();
  if (!value) return null;
  // Same dead-code-eliminated dev branch as activateFromUrl: ?dev_pro=1 should
  // preview the whole Pro experience, token panel included, without a real
  // purchase. Never reachable in a production build.
  if (import.meta.env.DEV && value === "dev") {
    return "eyJlIjoiZGV2QGV4YW1wbGUuY29tIn0.ZGV2LXNpZ25hdHVyZS1wbGFjZWhvbGRlcg";
  }
  if (value === "dev" || value.startsWith("stripe:")) return null;
  return (await verifyToken(value)).valid ? value : null;
}

export async function requestRestoreEmail(
  email: string,
): Promise<{ ok: boolean; message: string }> {
  if (!WORKER_URL) {
    return {
      ok: false,
      message: "Restore isn't available yet — email support with your receipt.",
    };
  }
  try {
    const res = await fetch(`${WORKER_URL}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    return {
      ok: res.ok,
      message:
        data.message ?? data.error ?? "Something went wrong — try again.",
    };
  } catch {
    return { ok: false, message: "Couldn't reach the license server." };
  }
}
