import { useState } from "react";
import { requestRestoreEmail } from "../license.ts";

// Shared restore-by-email form (upgrade modal + FAQ): enter the purchase
// email, receive a signed activation link.
export default function RestorePurchase() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    const res = await requestRestoreEmail(email.trim());
    setBusy(false);
    setMsg(res.message);
  };

  return (
    <div className="restore-form">
      <div className="license-row">
        <input
          type="email"
          placeholder="Email you purchased with"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="mini-btn" disabled={busy} onClick={send}>
          {busy ? "…" : "Send link"}
        </button>
      </div>
      {msg && <p className="meta">{msg}</p>}
    </div>
  );
}
