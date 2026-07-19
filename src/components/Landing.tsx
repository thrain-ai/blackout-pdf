import { useCallback, useRef, useState } from "react";
import {
  PRODUCT_NAME,
  FREE_PAGE_LIMIT,
  PRO_PRICE_LABEL,
  CHECKOUT_URL,
  CONTACT_EMAIL,
} from "../config.ts";

interface Props {
  onFile: (f: File) => void;
  loading: boolean;
  error: string | null;
  pro?: boolean;
}

// A word hidden under a marker swipe; hovering (or focusing) peels the bar
// back. The trailing punctuation belongs INSIDE the bar — a redactor would
// never leave a period dangling.
function Redacted({ children }: { children: string }) {
  return (
    <span className="redacted" tabIndex={0} aria-label={`redacted: ${children}`}>
      <span className="word">{children}</span>
      <span className="swipe" aria-hidden="true" />
    </span>
  );
}

const FAQ: [string, string][] = [
  [
    "Is my PDF uploaded anywhere?",
    "No. The entire tool — rendering, detection, redaction, export — runs in your browser using JavaScript. There is no server component and no file upload. You can load the page, disconnect from the internet, and it still works.",
  ],
  [
    "Is the redacted text really gone?",
    "Yes. Many tools just draw a black rectangle on top of the text, which anyone can copy-paste straight through. Blackout rebuilds each page as a flat image with the black boxes burned in, so the underlying text no longer exists in the exported file.",
  ],
  [
    "What does it detect automatically?",
    "Social Security numbers, email addresses, phone numbers, and credit card numbers. You can also search for any custom word or name, and draw redaction boxes anywhere by hand.",
  ],
  [
    "Does it work on scanned PDFs?",
    "Auto-detection needs a text layer, so scans without OCR won't produce suggestions — but manual redaction boxes work on any PDF, scanned or not.",
  ],
  [
    "What's the catch with the free version?",
    `Free covers documents up to ${FREE_PAGE_LIMIT} pages per export, which is most everyday redaction jobs. Pro (${PRO_PRICE_LABEL}, one-time) removes the limit forever.`,
  ],
  [
    "Why should I trust this?",
    "The source code is public on GitHub, the site is a static page with no backend, no analytics, and no tracking scripts. Verify with your browser's network tab: after loading, nothing is transmitted.",
  ],
];

export default function Landing({ onFile, loading, error, pro }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  const proHref =
    CHECKOUT_URL ??
    `mailto:${CONTACT_EMAIL}?subject=Blackout%20PDF%20Pro%20waitlist`;

  const dropzone = (
    <div
      className={`dropzone${dragOver ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {loading ? (
        <span className="dz-main">Opening…</span>
      ) : (
        <>
          <span className="dz-main">Drop a PDF</span>
          <span className="dz-sub">
            {pro
              ? "or click to choose · unlimited pages"
              : `or click to choose · free up to ${FREE_PAGE_LIMIT} pages · no signup`}
          </span>
        </>
      )}
    </div>
  );

  // Paying users get the tool, not the pitch: logo, dropzone, done.
  if (pro) {
    return (
      <div className="pro-home">
        <header className="site-header">
          <div className="logo">
            <span className="logo-mark" /> {PRODUCT_NAME}
            <span className="pro-chip">PRO</span>
          </div>
        </header>
        <main className="pro-main">
          {dropzone}
          {error && <p className="error">{error}</p>}
          <p className="trust-row">
            Nothing leaves your device — as always. ·{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>support</a>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="landing">
      <header className="site-header">
        <div className="logo">
          <span className="logo-mark" /> {PRODUCT_NAME}
        </div>
        <nav>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
      </header>

      <section className="hero">
        <h1>
          Your <Redacted>files</Redacted> never leave your{" "}
          <Redacted>device.</Redacted>
        </h1>
        <p className="sub">Blackout PDF documents entirely in your browser.</p>

        {dropzone}
        {error && <p className="error">{error}</p>}

        <p className="trust-row">
          open source · works offline once loaded
        </p>
        <p className="hover-tip">↑ psst — hover the black bars</p>
      </section>

      <section className="steps">
        <div>
          <h3>1 · Open</h3>
          <p>
            Drop in any PDF. It's parsed locally with Mozilla's pdf.js — the
            same engine Firefox uses.
          </p>
        </div>
        <div>
          <h3>2 · Review</h3>
          <p>
            Sensitive data is highlighted automatically. Click to confirm each
            one, add custom terms, or drag boxes anywhere.
          </p>
        </div>
        <div>
          <h3>3 · Export</h3>
          <p>
            Pages are rebuilt as flat images with redactions burned in. The
            text underneath is gone — not hidden.
          </p>
        </div>
      </section>

      <section className="why">
        <h2>A black rectangle is not a redaction</h2>
        <p>
          Court filings, leaked contracts, botched FOIA releases — the classic
          failure is a PDF where the "redacted" text is still there under a
          drawn rectangle, one copy-paste away. Blackout doesn't cover text; it
          re-renders each page and throws the original text layer away. What you
          export is what everyone gets, and nothing more.
        </p>
        <p>
          And because everything runs client-side, you're not trading one leak
          for another by uploading a sensitive document to someone's server to
          "secure" it.
        </p>
      </section>

      <section className="pricing" id="pricing">
        <h2>Pricing</h2>
        <div className="tiers">
          <div className="tier">
            <h3>Free</h3>
            <p className="price">$0</p>
            <ul>
              <li>Documents up to {FREE_PAGE_LIMIT} pages</li>
              <li>Auto-detection (SSN, email, phone, cards)</li>
              <li>Custom term search + manual boxes</li>
              <li>True flattened redaction</li>
              <li>No signup, no watermark</li>
            </ul>
          </div>
          <div className="tier pro">
            <h3>Pro</h3>
            <p className="price">
              {PRO_PRICE_LABEL} <span className="once">one-time</span>
            </p>
            <ul>
              <li>Unlimited pages</li>
              <li>Everything in Free</li>
              <li>Lifetime updates</li>
              <li>Priority email support</li>
            </ul>
            {/* same-tab on purpose: the post-payment redirect must land back
                in this tab to auto-activate Pro */}
            <a className="btn" href={proHref}>
              {CHECKOUT_URL ? "Get Pro" : "Join the Pro waitlist"}
            </a>
          </div>
        </div>
      </section>

      <section className="faq" id="faq">
        <h2>FAQ</h2>
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <footer>
        <p>
          {PRODUCT_NAME} · true client-side PDF redaction ·{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>contact</a>
        </p>
      </footer>
    </div>
  );
}
