import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedDoc } from "../App.tsx";
import type { ManualBox, Rect, Suggestion, PageInfo } from "../pdf/types.ts";
import { findSuggestions } from "../pdf/textSearch.ts";
import { exportRedacted, downloadBytes } from "../pdf/exporter.ts";
import { PATTERNS, CUSTOM_PATTERN_ID } from "../pdf/patterns.ts";
import { FREE_PAGE_LIMIT } from "../config.ts";
import PageView from "./PageView.tsx";
import UpgradeModal from "./UpgradeModal.tsx";

interface Props {
  loaded: LoadedDoc;
  onClose: () => void;
  pro: boolean;
  onActivated: () => void;
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PATTERNS.map((p) => [p.id, p.label]),
);
CATEGORY_LABELS[CUSTOM_PATTERN_ID] = "Custom terms";

const suggestionKey = (s: Suggestion) =>
  `${s.pageIndex}:${s.categoryId}:${s.text}:${Math.round(s.rect.x)},${Math.round(s.rect.y)}`;

let boxId = 0;

export default function Editor({ loaded, onClose, pro, onActivated }: Props) {
  const { doc, filename } = loaded;
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [manualBoxes, setManualBoxes] = useState<ManualBox[]>([]);
  const [customTerms, setCustomTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const [scanning, setScanning] = useState(true);
  const [exporting, setExporting] = useState<null | { done: number; total: number }>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const acceptedKeys = useRef(new Set<string>());

  // Scan (and re-scan when custom terms change), preserving accepted state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setScanning(true);
      const infos: PageInfo[] = [];
      const found: Suggestion[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        infos.push({ index: i, width: vp.width, height: vp.height });
        const s = await findSuggestions(page, i, customTerms);
        if (cancelled) return;
        found.push(...s);
      }
      for (const s of found) {
        if (acceptedKeys.current.has(suggestionKey(s))) s.accepted = true;
      }
      setPages(infos);
      setSuggestions(found);
      setScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, customTerms]);

  const setAccepted = useCallback((ids: string[], accepted: boolean) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (!ids.includes(s.id)) return s;
        const next = { ...s, accepted };
        const key = suggestionKey(s);
        if (accepted) acceptedKeys.current.add(key);
        else acceptedKeys.current.delete(key);
        return next;
      }),
    );
  }, []);

  const addManualBox = useCallback((pageIndex: number, rect: Rect) => {
    setManualBoxes((prev) => [...prev, { id: `m${boxId++}`, pageIndex, rect }]);
  }, []);

  const removeManualBox = useCallback((id: string) => {
    setManualBoxes((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const byCategory = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const arr = m.get(s.categoryId) ?? [];
      arr.push(s);
      m.set(s.categoryId, arr);
    }
    return m;
  }, [suggestions]);

  const acceptedCount =
    suggestions.filter((s) => s.accepted).length + manualBoxes.length;

  const addTerm = () => {
    const t = termInput.trim();
    if (t.length >= 2 && !customTerms.includes(t)) {
      setCustomTerms((prev) => [...prev, t]);
    }
    setTermInput("");
  };

  const doExport = async () => {
    if (!pro && doc.numPages > FREE_PAGE_LIMIT) {
      setShowUpgrade(true);
      return;
    }
    setExporting({ done: 0, total: doc.numPages });
    try {
      const byPage = new Map<number, Rect[]>();
      for (const s of suggestions) {
        if (!s.accepted) continue;
        byPage.set(s.pageIndex, [...(byPage.get(s.pageIndex) ?? []), s.rect]);
      }
      for (const b of manualBoxes) {
        byPage.set(b.pageIndex, [...(byPage.get(b.pageIndex) ?? []), b.rect]);
      }
      const bytes = await exportRedacted(doc, byPage, (done, total) =>
        setExporting({ done, total }),
      );
      downloadBytes(bytes, filename.replace(/\.pdf$/i, "") + "-redacted.pdf");
    } catch (e) {
      console.error(e);
      alert("Export failed — please report this. " + String(e));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="editor">
      <aside className="sidebar">
        <button className="link-btn" onClick={onClose}>
          ← New file
        </button>
        <h2 className="filename">
          <span className="filename-text" title={filename}>
            {filename}
          </span>
          {!scanning && (
            <span
              className="scan-badge"
              tabIndex={0}
              data-tip={`Scanned for ${PATTERNS.map((p) => p.label.toLowerCase()).join(", ")}`}
              aria-label={`Scanned for ${PATTERNS.map((p) => p.label.toLowerCase()).join(", ")}`}
            >
              <svg
                viewBox="0 0 24 24"
                width="11"
                height="11"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12.5 9.5 18 20 6.5" />
              </svg>
            </span>
          )}
        </h2>
        <p className="meta">
          {doc.numPages} page{doc.numPages === 1 ? "" : "s"}
          {scanning ? " · scanning…" : ""}
        </p>

        <div className="categories">
          {[...PATTERNS.map((p) => p.id), CUSTOM_PATTERN_ID].map((cat) => {
            const items = byCategory.get(cat) ?? [];
            if (cat === CUSTOM_PATTERN_ID && customTerms.length === 0) return null;
            // Empty auto-detect categories collapse into one muted summary
            // line below instead of rendering a card each.
            if (cat !== CUSTOM_PATTERN_ID && items.length === 0) return null;
            const accepted = items.filter((s) => s.accepted).length;
            return (
              <div className="category" key={cat}>
                <div className="cat-head">
                  <span>
                    {CATEGORY_LABELS[cat]} <em>({items.length})</em>
                  </span>
                  {items.length > 0 && (
                    <button
                      className="mini-btn"
                      onClick={() =>
                        setAccepted(
                          items.map((s) => s.id),
                          accepted !== items.length,
                        )
                      }
                    >
                      {accepted === items.length ? "Clear all" : "Redact all"}
                    </button>
                  )}
                </div>
                {items.length > 0 &&
                  (() => {
                    // One row per unique match text — a word that appears 40
                    // times is one row with ×40, not 40 identical rows.
                    const groups = new Map<string, Suggestion[]>();
                    for (const s of items) {
                      const k = s.text.toLowerCase();
                      groups.set(k, [...(groups.get(k) ?? []), s]);
                    }
                    const rows = [...groups.values()];
                    return (
                      <ul>
                        {rows.slice(0, 40).map((group) => {
                          const allOn = group.every((s) => s.accepted);
                          const pages = [
                            ...new Set(group.map((s) => s.pageIndex)),
                          ].sort((a, b) => a - b);
                          return (
                            <li key={group[0].id}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={allOn}
                                  onChange={() =>
                                    setAccepted(
                                      group.map((s) => s.id),
                                      !allOn,
                                    )
                                  }
                                />
                                <span className="match-text">
                                  {group[0].text}
                                </span>
                                {group.length > 1 && (
                                  <span className="match-count">
                                    ×{group.length}
                                  </span>
                                )}
                                <span className="match-page">
                                  {pages.length === 1
                                    ? `p${pages[0] + 1}`
                                    : `${pages.length} pgs`}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                        {rows.length > 40 && (
                          <li className="meta">…and {rows.length - 40} more</li>
                        )}
                      </ul>
                    );
                  })()}
              </div>
            );
          })}
        </div>

        <div className="custom-term">
          <input
            value={termInput}
            placeholder="Add name or term to find…"
            onChange={(e) => setTermInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTerm()}
          />
          <button className="mini-btn" onClick={addTerm}>
            Find
          </button>
        </div>
        {customTerms.length > 0 && (
          <div className="term-chips">
            {customTerms.map((t) => (
              <span className="term-chip" key={t}>
                {t}
                <button
                  aria-label={`Stop searching for ${t}`}
                  title="Remove"
                  onClick={() =>
                    setCustomTerms((prev) => prev.filter((x) => x !== t))
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  >
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="export-area">
          {/* Over the free limit, the export button IS the upgrade button —
              one control, no duplicate nag line. */}
          {!pro && doc.numPages > FREE_PAGE_LIMIT ? (
            <button
              className="btn export-btn"
              disabled={acceptedCount === 0}
              onClick={() => setShowUpgrade(true)}
            >
              Upgrade to export
            </button>
          ) : (
            <button
              className="btn export-btn"
              disabled={exporting !== null || acceptedCount === 0}
              onClick={doExport}
            >
              {exporting
                ? `Exporting ${exporting.done}/${exporting.total}…`
                : `Export PDF (${acceptedCount} redaction${acceptedCount === 1 ? "" : "s"})`}
            </button>
          )}
        </div>
      </aside>

      <span
        className="info-badge"
        tabIndex={0}
        data-tip="Tip: drag on any page to draw a redaction box. Click a black box to remove it."
        aria-label="Tip: drag on any page to draw a redaction box. Click a black box to remove it."
      >
        i
      </span>

      <main className="pages">
        {pages.map((p) => (
          <PageView
            key={p.index}
            doc={doc}
            page={p}
            suggestions={suggestions.filter((s) => s.pageIndex === p.index)}
            manualBoxes={manualBoxes.filter((b) => b.pageIndex === p.index)}
            onToggleSuggestion={(id, accepted) => setAccepted([id], accepted)}
            onAddBox={addManualBox}
            onRemoveBox={removeManualBox}
          />
        ))}
      </main>

      {showUpgrade && (
        <UpgradeModal
          pageCount={doc.numPages}
          onClose={() => setShowUpgrade(false)}
          onActivated={() => {
            onActivated();
            setShowUpgrade(false);
          }}
        />
      )}
    </div>
  );
}
