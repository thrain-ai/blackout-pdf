import { useCallback, useRef, useState } from "react";
import {
  PRODUCT_NAME,
  COMPANY,
  REPO_URL,
  FREE_PAGE_LIMIT,
  PRO_PRICE_LABEL,
  CHECKOUT_URL,
  CONTACT_EMAIL,
  WORKER_URL,
} from "../config.ts";
import RestorePurchase from "./RestorePurchase.tsx";

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

interface FaqEntry {
  q: string;
  a: string;
  restoreForm?: boolean;
}

const FAQ: FaqEntry[] = [
  {
    q: "Is my PDF uploaded anywhere?",
    a: "No. Everything happens on your own computer, inside your browser. There's no upload, no account, and no company server holding your files. You can even load this page, turn off your Wi-Fi, and keep working.",
  },
  {
    q: "Is the redacted text really gone?",
    a: "Yes. Many tools just draw a black rectangle on top of the text, which anyone can copy-paste straight through. Blackout rebuilds each page as a flat image with the black boxes burned in, so the underlying text no longer exists in the exported file.",
  },
  {
    q: "What does it detect automatically?",
    a: "Social Security numbers, email addresses, phone numbers, and credit card numbers. You can also search for any custom word or name, and draw redaction boxes anywhere by hand.",
  },
  {
    q: "Does it work on scanned PDFs?",
    a: "Automatic detection works on PDFs with selectable text (if you can highlight the words, it works). For scans that are essentially photos of paper, automatic search can't read them — but you can still draw redaction boxes anywhere by hand, on any PDF.",
  },
  {
    q: "What's the catch with the free version?",
    a: `Free covers documents up to ${FREE_PAGE_LIMIT} pages per export, which is most everyday redaction jobs. Pro (${PRO_PRICE_LABEL}, one-time) removes the limit forever.`,
  },
  {
    q: "How do I reactivate Pro?",
    a: "Pro remembers the browser you activated it on. If you cleared your browsing data, got a new computer, or want Pro on another device, enter the email you purchased with and we'll send you an activation link — it works on any device you open it on.",
    restoreForm: true,
  },
  {
    q: "Why should I trust this?",
    a: "The source code is public on GitHub, the site is a static page with no backend, no analytics, and no tracking scripts. Verify with your browser's network tab: after loading, nothing is transmitted.",
  },
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
            <span
              className="logo-mark pro"
              role="img"
              aria-label={`${PRODUCT_NAME} Pro`}
              title={`${PRODUCT_NAME} Pro`}
            >
              PRO
            </span>
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
          <span
            className="logo-mark"
            role="img"
            aria-label={PRODUCT_NAME}
            title={PRODUCT_NAME}
          />
        </div>
        <nav>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
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
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            open source
          </a>{" "}
          · works offline once loaded
        </p>
        <p className="hover-tip">↑ psst — hover the black bars</p>
      </section>

      <section className="steps-section">
        <h2 className="steps-title">How to use</h2>
        <div className="steps">
        <div>
          <h3>1 · Open</h3>
          <p>
            Drop in any PDF. It opens right here in your browser and is never
            sent anywhere.
          </p>
        </div>
        <div>
          <h3>2 · Review</h3>
          <p>
            Sensitive details are highlighted automatically. Click to confirm
            each one, search for any name or word, or drag a box over anything
            else.
          </p>
        </div>
        <div>
          <h3>3 · Download</h3>
          <p>
            Your redacted copy downloads instantly. The blacked-out
            information is permanently removed — not just covered up.
          </p>
        </div>
        </div>
      </section>

      <section className="why">
        <h2>A black rectangle is not a redaction</h2>
        <p>
          Court filings, leaked contracts, botched public-records releases —
          the classic mistake is a PDF where the "redacted" text is still
          sitting under a drawn rectangle, and anyone can copy and paste right
          through it. Blackout doesn't cover information up; it rebuilds each
          page with the sensitive text permanently removed. What you download
          is what everyone gets, and nothing more.
        </p>
        <p>
          And you never have to upload a private document to a stranger's
          website just to black things out. Blackout does all its work on your
          own computer — the file never goes anywhere.
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
        {FAQ.map(({ q, a, restoreForm }) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
            {restoreForm && WORKER_URL && <RestorePurchase />}
          </details>
        ))}
      </section>

      <footer>
        <p>
          {PRODUCT_NAME} · true client-side PDF redaction ·{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>contact</a> ·{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            source
          </a>
        </p>
        <p className="copyright">
          © {new Date().getFullYear()} {COMPANY}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
