import { useEffect, useState } from "react";
import { portableToken } from "../license.ts";
import { CONTACT_EMAIL } from "../config.ts";

// Pro buyers who want Blackout in a terminal or an AI agent need the same
// signed token the browser holds. Before this existed the only way to get it
// was to trigger a restore email and dig the value out of the link's query
// string — undiscoverable, so nobody did it.
export default function LicenseToken() {
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"token" | "export" | null>(null);

  useEffect(() => {
    void portableToken().then(setToken);
  }, []);

  // Nothing portable to show: either a legacy honor-system unlock or the dev
  // placeholder. Silence beats offering a token that would fail verification.
  if (!token) return null;

  const exportLine = `export BLACKOUT_LICENSE=${token}`;

  const copy = async (value: string, which: "token" | "export") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
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
            Your Pro license works outside the browser too. Set it once and the{" "}
            <code>blackout</code> CLI and the MCP server drop the 10-page limit.
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
            <button type="button" onClick={() => setRevealed((v) => !v)}>
              {revealed ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={() => void copy(token, "token")}>
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>

          <label className="license-token-label" htmlFor="license-token-export">
            Or paste this into your shell profile
          </label>
          <div className="license-token-row">
            <input
              id="license-token-export"
              readOnly
              value={revealed ? exportLine : "export BLACKOUT_LICENSE=…"}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" onClick={() => void copy(exportLine, "export")}>
              {copied === "export" ? "Copied" : "Copy"}
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
