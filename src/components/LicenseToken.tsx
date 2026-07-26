import { useEffect, useState } from "react";
import { portableToken } from "../license.ts";
import { CONTACT_EMAIL } from "../config.ts";

// Inline so a licensed run still makes no network request of any kind — an
// icon font or remote sprite would quietly break that promise.
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {off ? (
        <>
          <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.39-1.61" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// Pro buyers who want Blackout in a terminal or an AI agent need the same
// signed token the browser holds. Before this existed the only way to get it
// was to trigger a restore email and dig the value out of the link's query
// string — undiscoverable, so nobody did it.
export default function LicenseToken() {
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void portableToken().then(setToken);
  }, []);

  // Re-hide whenever the panel is collapsed, so reopening never starts with a
  // credential already on screen.
  useEffect(() => {
    if (!open) setRevealed(false);
  }, [open]);

  // Nothing portable to show: either a legacy honor-system unlock or the dev
  // placeholder. Silence beats offering a token that would fail verification.
  if (!token) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, permissions): reveal instead so
      // the value can still be selected by hand.
      setRevealed(true);
    }
  };

  return (
    <section className="license-token">
      <button
        type="button"
        className="license-token-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} Use Blackout from the terminal or an AI agent
      </button>

      {open && (
        <div className="license-token-body">
          <p>
            Your Pro license works outside the browser too. Set it as{" "}
            <code>BLACKOUT_LICENSE</code> and the <code>blackout</code> CLI and
            the MCP server drop the 10-page limit.
          </p>

          <label className="license-token-label" htmlFor="license-token-value">
            Your license token
          </label>
          <div className="license-token-row">
            <input
              id="license-token-value"
              readOnly
              type={revealed ? "text" : "password"}
              value={token}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="license-token-icon"
              aria-label={revealed ? "Hide token" : "Show token"}
              aria-pressed={revealed}
              title={revealed ? "Hide token" : "Show token"}
              onClick={() => setRevealed((v) => !v)}
            >
              <EyeIcon off={revealed} />
            </button>
            <button type="button" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="license-token-note">
            Treat it like a password — it is your receipt, and anyone who has it
            gets Pro. It never expires. Lost it? It is always here on any device
            where Pro is active, or email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>support</a>.
          </p>
        </div>
      )}
    </section>
  );
}
