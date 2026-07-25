import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RedactionMark } from "./marks.ts";

// Export strategy: rasterize every page and burn the black bars into the
// pixels, then rebuild a fresh PDF from the images. The original text layer is
// discarded entirely, so redacted content is unrecoverable — unlike tools that
// draw an annotation rectangle over still-present text.
//
// Coded redactions also get a small number burned onto the bar, resolved on an
// appended log page. The log itself is drawn as real vector text, so it stays
// selectable and searchable even though the content pages are images.
const EXPORT_SCALE = 2; // ~144 DPI

export interface LogInfo {
  filename: string;
  codeSetName: string;
  authority: string;
  sourcePageCount: number;
}

export interface ExportOptions {
  log?: LogInfo | null;
  onProgress?: (done: number, total: number) => void;
}

// --- log page styling -------------------------------------------------------

const INK = rgb(0.063, 0.063, 0.063);
const MUTED = rgb(0.424, 0.424, 0.392);
const AMBER = rgb(0.961, 0.706, 0);
const HAIRLINE = rgb(0.847, 0.839, 0.8);

const MARGIN = 54;
const ROW_H = 15;
const FOOTER_H = 30;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formattedToday(): string {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * The PDF standard fonts are WinAnsi-encoded, so any character beyond Latin-1
 * (CJK filenames, emoji) would throw at draw time. Filenames are user data —
 * sanitize before they reach the page.
 */
function sanitize(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const clean = sanitize(text);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let lo = 0;
  let hi = clean.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(clean.slice(0, mid) + "…", size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return clean.slice(0, lo) + "…";
}

/** Letter-spaced text — pdf-lib has no tracking, so place each glyph. */
function drawTracked(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  opts: { font: PDFFont; size: number; color: RGB; tracking: number },
): number {
  let cursor = x;
  for (const ch of sanitize(text)) {
    page.drawText(ch, { x: cursor, y, size: opts.size, font: opts.font, color: opts.color });
    cursor += opts.font.widthOfTextAtSize(ch, opts.size) + opts.tracking;
  }
  return cursor - x;
}

function trackedWidth(
  text: string,
  font: PDFFont,
  size: number,
  tracking: number,
): number {
  const clean = sanitize(text);
  return font.widthOfTextAtSize(clean, size) + tracking * clean.length;
}

function rule(page: PDFPage, x: number, y: number, w: number, h: number, color: RGB) {
  page.drawRectangle({ x, y, width: w, height: h, color });
}

interface LogRow {
  height: number;
  draw: (page: PDFPage, y: number) => void;
}

/**
 * Appends the redaction log. Composition is deliberately typographic — wide
 * tracked labels, hairline rules, and a single amber band as the only accent —
 * so it reads as a professional legal artifact rather than a branded flyer.
 */
function appendLog(
  out: PDFDocument,
  marks: RedactionMark[],
  info: LogInfo,
  size: { width: number; height: number },
  fonts: { regular: PDFFont; bold: PDFFont },
) {
  const coded = marks.filter((m) => m.marker !== null && m.code);
  if (coded.length === 0) return;

  const { regular, bold } = fonts;
  const { width: W, height: H } = size;
  const contentW = W - MARGIN * 2;
  const right = W - MARGIN;

  // Column geometry for the index table.
  const colNum = MARGIN;
  const colPage = MARGIN + 42;
  const colCode = MARGIN + 96;
  const colBasis = MARGIN + 188;
  const basisW = right - colBasis;

  // --- rows ---------------------------------------------------------------
  const rows: LogRow[] = [];

  // Summary: one line per distinct code actually used, with its count.
  const counts = new Map<string, { label: string; basis: string; n: number }>();
  for (const m of coded) {
    const c = m.code!;
    const entry = counts.get(c.id) ?? { label: c.label, basis: c.basis, n: 0 };
    entry.n++;
    counts.set(c.id, entry);
  }

  // Section labels carry their leading ABOVE the text (drawn low in their
  // block), so a label never crowds the rows it follows.
  rows.push({
    height: 26,
    draw: (page, y) => {
      drawTracked(page, "SUMMARY", MARGIN, y - 6, {
        font: bold, size: 8, color: MUTED, tracking: 1.6,
      });
    },
  });

  for (const entry of counts.values()) {
    rows.push({
      height: ROW_H + 3,
      draw: (page, y) => {
        page.drawText(entry.label, { x: MARGIN, y, size: 9.5, font: bold, color: INK });
        page.drawText(fit(entry.basis, regular, 9.5, contentW - 150), {
          x: colCode + 8, y, size: 9.5, font: regular, color: INK,
        });
        const n = `${entry.n}`;
        page.drawText(n, {
          x: right - regular.widthOfTextAtSize(n, 9.5),
          y, size: 9.5, font: regular, color: MUTED,
        });
        rule(page, MARGIN, y - 6, contentW, 0.4, HAIRLINE);
      },
    });
  }

  // Index header
  rows.push({
    height: 42,
    draw: (page, y) => {
      drawTracked(page, "INDEX OF REDACTIONS", MARGIN, y - 24, {
        font: bold, size: 8, color: MUTED, tracking: 1.6,
      });
    },
  });
  const indexHeader: LogRow = {
    height: 20,
    draw: (page, y) => {
      const label = (t: string, x: number) =>
        drawTracked(page, t, x, y, { font: bold, size: 7, color: MUTED, tracking: 1.1 });
      label("#", colNum);
      label("PAGE", colPage);
      label("CODE", colCode);
      label("BASIS FOR WITHHOLDING", colBasis);
      rule(page, MARGIN, y - 7, contentW, 0.7, INK);
    },
  };
  rows.push(indexHeader);

  for (const m of coded) {
    const num = `${m.marker}`;
    const pageLabel = `${m.pageIndex + 1}`;
    const code = m.code!;
    rows.push({
      height: ROW_H,
      draw: (page, y) => {
        // The marker number is amber here and white on the bar — same figure,
        // so the eye pairs the log entry with the mark on the page.
        page.drawText(num, { x: colNum, y, size: 9, font: bold, color: AMBER });
        page.drawText(pageLabel, { x: colPage, y, size: 9, font: regular, color: INK });
        page.drawText(fit(code.label, bold, 9, colBasis - colCode - 8), {
          x: colCode, y, size: 9, font: bold, color: INK,
        });
        page.drawText(fit(code.basis, regular, 9, basisW), {
          x: colBasis, y, size: 9, font: regular, color: INK,
        });
        rule(page, MARGIN, y - 4.5, contentW, 0.3, HAIRLINE);
      },
    });
  }

  // --- pagination ---------------------------------------------------------
  const HEADER_FIRST = 132;
  const HEADER_CONT = 58;
  const bottom = MARGIN + FOOTER_H;

  const pageRows: LogRow[][] = [];
  let current: LogRow[] = [];
  let y = H - MARGIN - HEADER_FIRST;
  for (const row of rows) {
    if (y - row.height < bottom && current.length > 0) {
      pageRows.push(current);
      current = [indexHeader];
      y = H - MARGIN - HEADER_CONT - indexHeader.height;
    }
    current.push(row);
    y -= row.height;
  }
  if (current.length) pageRows.push(current);

  // --- draw ---------------------------------------------------------------
  const totalLogPages = pageRows.length;
  pageRows.forEach((rowsOnPage, idx) => {
    const page = out.addPage([W, H]);
    let cursor: number;

    if (idx === 0) {
      let top = H - MARGIN;
      rule(page, MARGIN, top, contentW, 0.7, INK);
      top -= 22;
      drawTracked(page, "REDACTION LOG", MARGIN, top, {
        font: bold, size: 11, color: INK, tracking: 3.4,
      });
      const auth = sanitize(info.codeSetName.toUpperCase());
      const authW = trackedWidth(auth, bold, 7, 1.4);
      drawTracked(page, auth, right - authW, top + 2, {
        font: bold, size: 7, color: MUTED, tracking: 1.4,
      });
      top -= 14;
      // The single amber band: the brand's whole presence on this page.
      rule(page, MARGIN, top, contentW, 2.5, AMBER);
      top -= 30;
      page.drawText(fit(info.filename, bold, 15, contentW), {
        x: MARGIN, y: top, size: 15, font: bold, color: INK,
      });
      top -= 18;
      const meta = `${coded.length} coded redaction${coded.length === 1 ? "" : "s"} · ${info.sourcePageCount} page${info.sourcePageCount === 1 ? "" : "s"} · prepared ${formattedToday()}`;
      page.drawText(fit(meta, regular, 9, contentW), {
        x: MARGIN, y: top, size: 9, font: regular, color: MUTED,
      });
      top -= 14;
      page.drawText(fit(info.authority, regular, 8.5, contentW), {
        x: MARGIN, y: top, size: 8.5, font: regular, color: MUTED,
      });
      cursor = H - MARGIN - HEADER_FIRST;
    } else {
      let top = H - MARGIN;
      rule(page, MARGIN, top, contentW, 0.7, INK);
      top -= 20;
      drawTracked(page, "REDACTION LOG · CONTINUED", MARGIN, top, {
        font: bold, size: 9, color: INK, tracking: 2.4,
      });
      cursor = H - MARGIN - HEADER_CONT;
    }

    for (const row of rowsOnPage) {
      row.draw(page, cursor);
      cursor -= row.height;
    }

    // Footer
    const fy = MARGIN + 12;
    rule(page, MARGIN, fy + 12, contentW, 0.4, HAIRLINE);
    page.drawText("Prepared with Blackout · blackout.thrain.ai", {
      x: MARGIN, y: fy, size: 7.5, font: regular, color: MUTED,
    });
    const stamp = `LOG ${idx + 1} OF ${totalLogPages}`;
    const stampW = trackedWidth(stamp, bold, 7, 1.2);
    drawTracked(page, stamp, right - stampW, fy, {
      font: bold, size: 7, color: MUTED, tracking: 1.2,
    });
  });
}

// --- main export ------------------------------------------------------------

export async function exportRedacted(
  doc: PDFDocumentProxy,
  marks: RedactionMark[],
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const total = doc.numPages;
  const byPage = new Map<number, RedactionMark[]>();
  for (const m of marks) {
    byPage.set(m.pageIndex, [...(byPage.get(m.pageIndex) ?? []), m]);
  }

  let firstSize = { width: 612, height: 792 };

  for (let i = 0; i < total; i++) {
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale: EXPORT_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    for (const m of byPage.get(i) ?? []) {
      const x = m.rect.x * EXPORT_SCALE;
      const y = m.rect.y * EXPORT_SCALE;
      const w = m.rect.w * EXPORT_SCALE;
      const h = m.rect.h * EXPORT_SCALE;
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, w, h);

      if (m.marker === null) continue;
      const label = `${m.marker}`;
      const fontPx = Math.max(7, Math.min(h * 0.68, 16));
      ctx.font = `bold ${fontPx}px Helvetica, Arial, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      const pad = Math.max(2, fontPx * 0.35);
      const needed = ctx.measureText(label).width + pad * 2;
      if (needed <= w) {
        // Fits on the bar: white figure inside it.
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x + w - pad, y + h / 2);
      } else {
        // Bar too narrow (a one-line SSN, say): place the figure just outside
        // so the log mapping is never lost.
        ctx.fillStyle = "#000000";
        ctx.textAlign = "left";
        ctx.fillText(label, x + w + pad, y + h / 2);
      }
    }

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
        "image/jpeg",
        0.92,
      ),
    );
    const jpg = await out.embedJpg(await blob.arrayBuffer());

    const base = page.getViewport({ scale: 1 });
    if (i === 0) firstSize = { width: base.width, height: base.height };
    const outPage = out.addPage([base.width, base.height]);
    outPage.drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });

    // Free canvas memory promptly on large docs.
    canvas.width = 0;
    canvas.height = 0;
    opts.onProgress?.(i + 1, total);
  }

  if (opts.log) {
    const fonts = {
      regular: await out.embedFont(StandardFonts.Helvetica),
      bold: await out.embedFont(StandardFonts.HelveticaBold),
    };
    appendLog(out, marks, opts.log, firstSize, fonts);
  }

  return out.save();
}

/**
 * Builds a PDF containing only the log pages, for live preview in the editor.
 * Deliberately reuses the export's drawing code, so what the operator previews
 * cannot drift from what they download.
 */
export async function buildLogPreview(
  marks: RedactionMark[],
  info: LogInfo,
  size: { width: number; height: number },
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const fonts = {
    regular: await out.embedFont(StandardFonts.Helvetica),
    bold: await out.embedFont(StandardFonts.HelveticaBold),
  };
  appendLog(out, marks, info, size, fonts);
  if (out.getPageCount() === 0) out.addPage([size.width, size.height]);
  return out.save();
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
