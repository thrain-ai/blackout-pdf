import type { PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PATTERNS, CUSTOM_PATTERN_ID, customTermRegex } from "./patterns.ts";
import type { Rect, Suggestion } from "./types.ts";

type Viewport = ReturnType<PDFPageProxy["getViewport"]>;

interface PlacedItem {
  str: string;
  rect: Rect; // viewport scale-1, top-left origin
  // The run is not horizontal (rotated or vertical text). Partial-item slicing
  // assumes a horizontal advance, so a rotated run is covered whole instead.
  rotated: boolean;
}

interface Line {
  text: string;
  // For each char of `text`, which PlacedItem it came from (index), or -1 for
  // synthetic joining spaces.
  charSource: number[];
  items: PlacedItem[];
  // Char offset within the source item for each char of `text` (for
  // proportional trimming of partial-item matches).
  charOffset: number[];
}

let nextId = 0;
const genId = () => `s${nextId++}`;

function placeItems(page: PDFPageProxy, items: TextItem[]): PlacedItem[] {
  const viewport = page.getViewport({ scale: 1 });
  const placed: PlacedItem[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    // Derive the glyph box from the full text matrix rather than x/y/width
    // alone, so the mark tracks the glyphs when the run is rotated or vertical
    // and not only when it is axis-aligned horizontal.
    const adv = Math.hypot(a, b) || Math.abs(a) || 1; // advance-direction scale
    let ax = c; // ascent vector (already scaled to glyph height)
    let ay = d;
    if (Math.hypot(ax, ay) < 1e-6) {
      // Degenerate matrix with no vertical component: synthesise an up vector
      // perpendicular to the advance so the box still has height.
      ax = (-b / adv) * 10;
      ay = (a / adv) * 10;
    }
    const vx = (a / adv) * it.width; // run vector along the baseline
    const vy = (b / adv) * it.width;
    // Four corners of the run in PDF user space: descent-to-ascent at each end.
    const corners: Array<[number, number]> = [
      [e - 0.2 * ax, f - 0.2 * ay],
      [e + vx - 0.2 * ax, f + vy - 0.2 * ay],
      [e + vx + ax, f + vy + ay],
      [e + ax, f + ay],
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of corners) {
      const [qx, qy] = viewport.convertToViewportPoint(px, py);
      minX = Math.min(minX, qx);
      minY = Math.min(minY, qy);
      maxX = Math.max(maxX, qx);
      maxY = Math.max(maxY, qy);
    }
    const rotated =
      Math.abs(b) > 1e-3 * Math.abs(a) + 1e-9 ||
      Math.abs(c) > 1e-3 * Math.abs(d) + 1e-9;
    placed.push({
      str: it.str,
      rect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      rotated,
    });
  }
  return placed;
}

// Group placed items into visual lines so matches can span multiple items
// (e.g. "555-" and "0123" as separate text runs).
function buildLines(placed: PlacedItem[]): Line[] {
  const sorted = placed
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.rect.y - b.p.rect.y || a.p.rect.x - b.p.rect.x);

  const lines: Line[] = [];
  let current: { entries: { p: PlacedItem }[]; yMid: number } | null = null;
  const flush = () => {
    if (!current) return;
    const entries = current.entries.sort((a, b) => a.p.rect.x - b.p.rect.x);
    const line: Line = { text: "", charSource: [], charOffset: [], items: [] };
    let prevRight: number | null = null;
    for (const { p } of entries) {
      const itemIdx = line.items.length;
      line.items.push(p);
      // Insert a synthetic space when there's a visible gap between runs.
      if (prevRight !== null && p.rect.x - prevRight > 1.5) {
        line.text += " ";
        line.charSource.push(-1);
        line.charOffset.push(0);
      }
      for (let c = 0; c < p.str.length; c++) {
        line.text += p.str[c];
        line.charSource.push(itemIdx);
        line.charOffset.push(c);
      }
      prevRight = p.rect.x + p.rect.w;
    }
    lines.push(line);
    current = null;
  };

  for (const { p } of sorted) {
    const yMid = p.rect.y + p.rect.h / 2;
    if (current && Math.abs(yMid - current.yMid) <= Math.max(3, p.rect.h * 0.5)) {
      current.entries.push({ p });
    } else {
      flush();
      current = { entries: [{ p }], yMid };
    }
  }
  flush();
  return lines;
}

// Approximate per-character advance widths (em units, Helvetica-ish) so that
// partial-item boxes land on the right characters even when the surrounding
// text mixes narrow ("il: ") and wide ("W41") glyphs. Uniform char-count
// slicing was observed to leave leading characters of a match exposed.
function charWidth(c: string): number {
  if (/[iljtf!.,:;'|]/.test(c)) return 0.28;
  if (c === " ") return 0.278;
  if (/[mwMW@]/.test(c)) return 0.85;
  if (/[A-Z]/.test(c)) return 0.7;
  if (/[0-9]/.test(c)) return 0.556;
  if (/[()\-[\]"]/.test(c)) return 0.33;
  return 0.5;
}

function sliceX(item: PlacedItem, c0: number, c1: number): { x: number; w: number } {
  let before = 0;
  let inside = 0;
  let total = 0;
  for (let i = 0; i < item.str.length; i++) {
    const w = charWidth(item.str[i]);
    total += w;
    if (i < c0) before += w;
    else if (i < c1) inside += w;
  }
  if (total === 0) return { x: item.rect.x, w: item.rect.w };
  const scale = item.rect.w / total;
  // Half-a-character safety margin on both sides: over-redacting a sliver of
  // a neighboring glyph is fine; exposing a sliver of the match is not.
  const margin = 0.5 * (total / (item.str.length || 1)) * scale;
  return {
    x: item.rect.x + before * scale - margin,
    w: inside * scale + margin * 2,
  };
}

// Convert a [start, end) char range of a line into one rect per touched item,
// trimming the first/last item by estimated character position.
function rangeToRects(line: Line, start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  let i = start;
  while (i < end) {
    const src = line.charSource[i];
    if (src === -1) {
      i++;
      continue;
    }
    let j = i;
    while (j < end && line.charSource[j] === src) j++;
    const item = line.items[src];
    if (item.rotated) {
      // Horizontal slicing does not apply to a rotated run; cover it whole.
      rects.push({ ...item.rect });
      i = j;
      continue;
    }
    const c0 = line.charOffset[i];
    const c1 = line.charOffset[j - 1] + 1;
    const { x, w } = sliceX(item, c0, c1);
    rects.push({ x, y: item.rect.y, w, h: item.rect.h });
    i = j;
  }
  return rects;
}

function mergeRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  const PAD = 1.5;
  return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
}

interface Search {
  id: string;
  regex: RegExp;
}

function buildSearches(customTerms: string[]): Search[] {
  return [
    ...PATTERNS.map((p) => ({ id: p.id, regex: p.regex })),
    ...customTerms
      .filter((t) => t.trim().length >= 2)
      .map((t) => ({ id: CUSTOM_PATTERN_ID, regex: customTermRegex(t) })),
  ];
}

// Run every pattern over `text`, most-specific first, letting an earlier match
// claim its characters so a looser pattern cannot re-flag them. Emits one
// suggestion per match, all sharing `rect` (used when the exact sub-geometry of
// a match is not available, e.g. inside a form field).
function collectMatches(
  text: string,
  searches: Search[],
  rect: Rect,
  pageIndex: number,
  out: Suggestion[],
): void {
  const claimed = new Array<boolean>(text.length).fill(false);
  for (const { id, regex } of searches) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      if (m[0].length === 0) continue;
      const start = m.index;
      const end = start + m[0].length;
      let overlap = false;
      for (let c = start; c < end; c++) if (claimed[c]) overlap = true;
      if (overlap) continue;
      for (let c = start; c < end; c++) claimed[c] = true;
      out.push({ id: genId(), pageIndex, rect, categoryId: id, text: m[0], accepted: false });
    }
  }
}

// pdf.js does not surface form-field values or annotation text through
// getTextContent(), but it does paint them into the page image on export.
// Pull that text out so the same detectors run over it.
function annotationTexts(a: Record<string, unknown>): string[] {
  const texts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) texts.push(v);
  };
  const fv = a.fieldValue;
  if (Array.isArray(fv)) fv.forEach(push);
  else push(fv);
  push(a.contents);
  const contentsObj = a.contentsObj as { str?: unknown } | undefined;
  if (contentsObj) push(contentsObj.str);
  return [...new Set(texts)];
}

function annotationRect(a: Record<string, unknown>, viewport: Viewport): Rect | null {
  const r = a.rect as number[] | undefined;
  if (!r || r.length < 4) return null;
  const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle([r[0], r[1], r[2], r[3]]);
  const x = Math.min(vx1, vx2);
  const y = Math.min(vy1, vy2);
  const w = Math.abs(vx2 - vx1);
  const h = Math.abs(vy2 - vy1);
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

const IMAGE_OPS = new Set(
  [
    OPS.paintImageXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintImageMaskXObject,
    OPS.paintImageMaskXObjectGroup,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintInlineImageXObject,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintSolidColorImageMask,
  ].filter((v): v is number => typeof v === "number"),
);

async function pageHasImage(page: PDFPageProxy): Promise<boolean> {
  try {
    const ops = await page.getOperatorList();
    return ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
  } catch {
    return false;
  }
}

export interface PageScan {
  suggestions: Suggestion[];
  // The page paints imagery but exposes no extractable text, so automatic
  // detection cannot read it — a scanned or image-only page needing OCR.
  imageOnly: boolean;
}

/**
 * The full per-page detection pass: body text, plus form-field and annotation
 * text, plus a flag for pages that carry only imagery. One getTextContent()
 * call feeds both the search and the image-only determination.
 */
export async function scanPage(
  page: PDFPageProxy,
  pageIndex: number,
  customTerms: string[] = [],
): Promise<PageScan> {
  const content = await page.getTextContent();
  const items = content.items.filter((i): i is TextItem => "str" in i);
  const hasText = items.some((i) => i.str.trim().length > 0);
  const lines = buildLines(placeItems(page, items));
  const searches = buildSearches(customTerms);

  const out: Suggestion[] = [];
  for (const line of lines) {
    const claimed = new Array<boolean>(line.text.length).fill(false);
    for (const { id, regex } of searches) {
      regex.lastIndex = 0;
      for (const m of line.text.matchAll(regex)) {
        if (m[0].length === 0) continue;
        const start = m.index;
        const end = start + m[0].length;
        let overlap = false;
        for (let c = start; c < end; c++) if (claimed[c]) overlap = true;
        if (overlap) continue;
        const rect = mergeRects(rangeToRects(line, start, end));
        if (!rect) continue;
        for (let c = start; c < end; c++) claimed[c] = true;
        out.push({ id: genId(), pageIndex, rect, categoryId: id, text: m[0], accepted: false });
      }
    }
  }

  // Form fields and annotations: whole-rectangle coverage, since per-glyph
  // positions within a widget are not available.
  let annotations: Array<Record<string, unknown>> = [];
  try {
    annotations = (await page.getAnnotations()) as Array<Record<string, unknown>>;
  } catch {
    annotations = [];
  }
  if (annotations.length) {
    const viewport = page.getViewport({ scale: 1 });
    for (const a of annotations) {
      const rect = annotationRect(a, viewport);
      if (!rect) continue;
      for (const t of annotationTexts(a)) collectMatches(t, searches, rect, pageIndex, out);
    }
  }

  const imageOnly = !hasText && (await pageHasImage(page));
  return { suggestions: out, imageOnly };
}

export async function findSuggestions(
  page: PDFPageProxy,
  pageIndex: number,
  customTerms: string[] = [],
): Promise<Suggestion[]> {
  return (await scanPage(page, pageIndex, customTerms)).suggestions;
}
