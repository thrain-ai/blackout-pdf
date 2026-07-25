import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedDoc } from "../App.tsx";
import type { ManualBox, Rect, Suggestion, PageInfo } from "../pdf/types.ts";
import { findSuggestions } from "../pdf/textSearch.ts";
import { exportRedacted, downloadBytes } from "../pdf/exporter.ts";
import { PATTERNS, CUSTOM_PATTERN_ID } from "../pdf/patterns.ts";
import {
  CODE_SETS,
  DEFAULT_CODE_SET_ID,
  codeById,
  codeSetById,
  resolveCode,
} from "../pdf/codes.ts";
import { orderAndNumber, type MarkInput } from "../pdf/marks.ts";
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
  // Accepted suggestions survive a re-scan (adding a custom term rescans the
  // document), and so must their assigned codes: key -> codeId (null = coded
  // as nothing).
  const acceptedState = useRef(new Map<string, string | null>());

  // --- exemption codes (Pro) ----------------------------------------------
  const [codeSetId, setCodeSetId] = useState(DEFAULT_CODE_SET_ID);
  const [pinnedCodeId, setPinnedCodeId] = useState<string | null>(null);
  const codeSet = useMemo(() => codeSetById(codeSetId), [codeSetId]);

  // The code a redaction takes when it's applied: a pinned code wins,
  // otherwise the set's mapping for that detected category.
  const codeIdFor = useCallback(
    (categoryId?: string): string | null => {
      if (!pro) return null;
      return resolveCode(codeSet, pinnedCodeId, categoryId)?.id ?? null;
    },
    [pro, codeSet, pinnedCodeId],
  );

  // --- mobile adaptations -------------------------------------------------
  // Coarse pointer = touch device: drags scroll by default, drawing is an
  // explicit mode; the sidebar becomes a bottom sheet behind an action bar.
  const coarsePointer = useMemo(
    () => window.matchMedia("(pointer: coarse)").matches,
    [],
  );
  const [drawMode, setDrawMode] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pagesRef = useRef<HTMLElement>(null);
  const [pagesWidth, setPagesWidth] = useState(860);
  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setPagesWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pageMaxWidth = Math.min(860, pagesWidth);
  const drawEnabled = !coarsePointer || drawMode;

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
        const key = suggestionKey(s);
        if (acceptedState.current.has(key)) {
          s.accepted = true;
          s.codeId = acceptedState.current.get(key) ?? null;
        }
      }
      setPages(infos);
      setSuggestions(found);
      setScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, customTerms]);

  const setAccepted = useCallback(
    (ids: string[], accepted: boolean) => {
      setSuggestions((prev) =>
        prev.map((s) => {
          if (!ids.includes(s.id)) return s;
          const key = suggestionKey(s);
          if (!accepted) {
            acceptedState.current.delete(key);
            return { ...s, accepted: false, codeId: null };
          }
          const codeId = codeIdFor(s.categoryId);
          acceptedState.current.set(key, codeId);
          return { ...s, accepted: true, codeId };
        }),
      );
    },
    [codeIdFor],
  );

  const addManualBox = useCallback(
    (pageIndex: number, rect: Rect) => {
      setManualBoxes((prev) => [
        ...prev,
        { id: `m${boxId++}`, pageIndex, rect, codeId: codeIdFor() },
      ]);
    },
    [codeIdFor],
  );

  /** Retro-apply the current code selection to everything already redacted. */
  const applyCodeToAll = useCallback(() => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (!s.accepted) return s;
        const codeId = codeIdFor(s.categoryId);
        acceptedState.current.set(suggestionKey(s), codeId);
        return { ...s, codeId };
      }),
    );
    setManualBoxes((prev) => prev.map((b) => ({ ...b, codeId: codeIdFor() })));
  }, [codeIdFor]);

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

  // Single source of truth for redactions in reading order, with marker
  // numbers — the overlay and the exported log both read from this, so the
  // figure on a bar always matches the figure in the log.
  const marks = useMemo(() => {
    const inputs: MarkInput[] = [];
    for (const s of suggestions) {
      if (!s.accepted) continue;
      inputs.push({
        id: s.id,
        pageIndex: s.pageIndex,
        rect: s.rect,
        code: pro ? codeById(s.codeId) : null,
      });
    }
    for (const b of manualBoxes) {
      inputs.push({
        id: b.id,
        pageIndex: b.pageIndex,
        rect: b.rect,
        code: pro ? codeById(b.codeId) : null,
      });
    }
    return orderAndNumber(inputs);
  }, [suggestions, manualBoxes, pro]);

  const markerById = useMemo(() => {
    const m = new Map<string, number>();
    for (const mark of marks) if (mark.marker !== null) m.set(mark.id, mark.marker);
    return m;
  }, [marks]);

  const codedCount = markerById.size;

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
      const bytes = await exportRedacted(doc, marks, {
        onProgress: (done, total) => setExporting({ done, total }),
        log:
          codedCount > 0
            ? {
                filename,
                codeSetName: codeSet.name,
                authority: codeSet.authority,
                sourcePageCount: doc.numPages,
              }
            : null,
      });
      downloadBytes(bytes, filename.replace(/\.pdf$/i, "") + "-redacted.pdf");
    } catch (e) {
      console.error(e);
      alert("Export failed — please report this. " + String(e));
    } finally {
      setExporting(null);
    }
  };

  const overLimit = !pro && doc.numPages > FREE_PAGE_LIMIT;

  return (
    <div className="editor">
      <aside className={`sidebar${sheetOpen ? " open" : ""}`}>
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

        <div className={`codes-panel${pro ? "" : " locked"}`}>
          <div className="cat-head">
            <span>Exemption codes</span>
            {!pro && <span className="pro-tag">PRO</span>}
          </div>
          {pro ? (
            <>
              <select
                aria-label="Code set"
                value={codeSetId}
                onChange={(e) => {
                  setCodeSetId(e.target.value);
                  setPinnedCodeId(null);
                }}
              >
                {CODE_SETS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Code to apply"
                value={pinnedCodeId ?? ""}
                onChange={(e) => setPinnedCodeId(e.target.value || null)}
              >
                <option value="">Auto by type</option>
                {codeSet.codes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} — {c.basis}
                  </option>
                ))}
              </select>
              <button
                className="mini-btn"
                disabled={acceptedCount === 0}
                onClick={applyCodeToAll}
              >
                Apply to all
              </button>
              <p className="meta">
                {codedCount > 0
                  ? `${codedCount} coded — numbered markers and a log page are appended on export.`
                  : "Redactions you apply get a code, a numbered marker, and a log entry."}
              </p>
            </>
          ) : (
            <>
              <p className="meta">
                Cite FOIA exemptions or privilege categories on every redaction,
                with numbered markers and an appended log page.
              </p>
              <button className="link-btn" onClick={() => setShowUpgrade(true)}>
                Unlock with Pro
              </button>
            </>
          )}
        </div>

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
                                {(() => {
                                  if (!pro || !allOn) return null;
                                  const ids = new Set(
                                    group.map((s) => s.codeId ?? ""),
                                  );
                                  if (ids.size !== 1) return null;
                                  const c = codeById([...ids][0]);
                                  return c ? (
                                    <span className="code-badge">{c.label}</span>
                                  ) : null;
                                })()}
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
          {overLimit ? (
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

      {/* Mobile action bar: sheet toggle + export, pinned above the safe area. */}
      <div className="mobile-bar">
        <button
          className="mini-btn sheet-toggle"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((v) => !v)}
        >
          {sheetOpen ? "Close" : "Details"}
        </button>
        {overLimit ? (
          <button
            className="btn"
            disabled={acceptedCount === 0}
            onClick={() => setShowUpgrade(true)}
          >
            Upgrade to export
          </button>
        ) : (
          <button
            className="btn"
            disabled={exporting !== null || acceptedCount === 0}
            onClick={doExport}
          >
            {exporting
              ? `Exporting ${exporting.done}/${exporting.total}…`
              : `Export (${acceptedCount})`}
          </button>
        )}
      </div>

      {/* Touch-only: explicit draw mode so one-finger drags scroll by default.
          Hidden while the sheet is open so it can't cover sheet controls. */}
      {coarsePointer && !sheetOpen && (
        <button
          className={`draw-toggle${drawMode ? " on" : ""}`}
          aria-pressed={drawMode}
          title={drawMode ? "Drawing boxes — tap to scroll instead" : "Tap to draw redaction boxes"}
          onClick={() => setDrawMode((v) => !v)}
        >
          ✏️
        </button>
      )}

      <span
        className="info-badge"
        tabIndex={0}
        data-tip="Tip: drag on any page to draw a redaction box. Click a black box to remove it."
        aria-label="Tip: drag on any page to draw a redaction box. Click a black box to remove it."
      >
        i
      </span>

      <main className="pages" ref={pagesRef}>
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
            maxWidth={pageMaxWidth}
            drawEnabled={drawEnabled}
            markerById={markerById}
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
