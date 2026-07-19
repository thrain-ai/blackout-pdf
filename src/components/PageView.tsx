import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { ManualBox, PageInfo, Rect, Suggestion } from "../pdf/types.ts";

interface Props {
  doc: PDFDocumentProxy;
  page: PageInfo;
  suggestions: Suggestion[];
  manualBoxes: ManualBox[];
  onToggleSuggestion: (id: string, accepted: boolean) => void;
  onAddBox: (pageIndex: number, rect: Rect) => void;
  onRemoveBox: (id: string) => void;
  // Available width for the page (fit-to-width on small screens).
  maxWidth: number;
  // When false (touch devices with draw mode off), drags scroll instead of
  // drawing redaction boxes.
  drawEnabled: boolean;
}

export default function PageView({
  doc,
  page,
  suggestions,
  manualBoxes,
  onToggleSuggestion,
  onAddBox,
  onRemoveBox,
  maxWidth,
  drawEnabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const displayScale = Math.min(1.25, maxWidth / page.width);
  const cssW = page.width * displayScale;
  const cssH = page.height * displayScale;

  useEffect(() => {
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(page.index + 1);
      if (cancelled || !canvasRef.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale: displayScale * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false })!;
      task = p.render({ canvasContext: ctx, viewport });
      await task.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page.index, displayScale]);

  // Pointer coords → scale-1 page coords.
  const toPage = (e: React.PointerEvent): { x: number; y: number } => {
    const r = overlayRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / displayScale,
      y: (e.clientY - r.top) / displayScale,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawEnabled) return; // touch scroll mode: let the browser pan
    if (e.target !== overlayRef.current) return; // let box clicks through
    try {
      overlayRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events in tests have no capturable pointer */
    }
    dragStart.current = toPage(e);
    setDrawing(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const cur = toPage(e);
    const s = dragStart.current;
    setDrawing({
      x: Math.min(s.x, cur.x),
      y: Math.min(s.y, cur.y),
      w: Math.abs(cur.x - s.x),
      h: Math.abs(cur.y - s.y),
    });
  };

  const onPointerUp = () => {
    if (drawing && drawing.w > 4 && drawing.h > 4) {
      onAddBox(page.index, drawing);
    }
    dragStart.current = null;
    setDrawing(null);
  };

  const rectStyle = (r: Rect) => ({
    left: r.x * displayScale,
    top: r.y * displayScale,
    width: r.w * displayScale,
    height: r.h * displayScale,
  });

  return (
    <div className="page-wrap" style={{ width: cssW }}>
      <div className="page-label">Page {page.index + 1}</div>
      <div className="page" style={{ width: cssW, height: cssH }}>
        <canvas ref={canvasRef} style={{ width: cssW, height: cssH }} />
        <div
          ref={overlayRef}
          className={`overlay${drawEnabled ? "" : " scroll-mode"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {suggestions.map((s) => (
            <div
              key={s.id}
              className={`box suggestion${s.accepted ? " accepted" : ""}`}
              style={rectStyle(s.rect)}
              title={
                s.accepted
                  ? `Redacted: ${s.text} (click to undo)`
                  : `Suggested: ${s.text} (click to redact)`
              }
              onClick={() => onToggleSuggestion(s.id, !s.accepted)}
            />
          ))}
          {manualBoxes.map((b) => (
            <div
              key={b.id}
              className="box manual"
              style={rectStyle(b.rect)}
              title="Redaction box (click to remove)"
              onClick={() => onRemoveBox(b.id)}
            />
          ))}
          {drawing && (
            <div className="box drawing" style={rectStyle(drawing)} />
          )}
        </div>
      </div>
    </div>
  );
}
