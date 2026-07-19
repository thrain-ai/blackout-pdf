import { useState } from "react";
import {
  CHECKOUT_URL,
  CONTACT_EMAIL,
  FREE_PAGE_LIMIT,
  PRO_PRICE_LABEL,
  WORKER_URL,
} from "../config.ts";
import { requestRestoreEmail } from "../license.ts";

interface Props {
  pageCount: number;
  onClose: () => void;
  onActivated: () => void; // reserved for future in-modal activation paths
}

export default function UpgradeModal({ pageCount, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  const restore = async () => {
    setBusy(true);
    setMsg(null);
    const res = await requestRestoreEmail(email.trim());
    setBusy(false);
    setMsg(res.message);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <h2>This document has {pageCount} pages</h2>
        <p>
          Free exports up to {FREE_PAGE_LIMIT}. Pro is unlimited, forever —{" "}
          {PRO_PRICE_LABEL} one-time, still 100% in your browser.
        </p>
        {CHECKOUT_URL ? (
          <a className="btn" href={CHECKOUT_URL}>
            Get Pro
          </a>
        ) : (
          <a
            className="btn"
            href={`mailto:${CONTACT_EMAIL}?subject=Blackout%20PDF%20Pro%20waitlist`}
          >
            Join the waitlist
          </a>
        )}

        {WORKER_URL &&
          (showRestore ? (
            <>
              <div className="license-row">
                <input
                  type="email"
                  placeholder="Email you purchased with"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && restore()}
                />
                <button className="mini-btn" disabled={busy} onClick={restore}>
                  {busy ? "…" : "Send link"}
                </button>
              </div>
              {msg && <p className="meta">{msg}</p>}
            </>
          ) : (
            <button className="link-btn" onClick={() => setShowRestore(true)}>
              Already bought Pro? Restore your purchase
            </button>
          ))}
      </div>
    </div>
  );
}
