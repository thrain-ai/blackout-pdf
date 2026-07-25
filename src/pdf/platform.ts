// The engine's only contact with the outside world.
//
// Everything else under src/pdf/ is pure logic that runs identically in a
// browser tab and in a Node process. Rasterising is the exception: it needs a
// real 2D canvas, and where that canvas comes from is the one thing the two
// environments genuinely disagree about. This module names that disagreement
// and nothing else, so the redaction path itself has exactly one
// implementation — the browser and the CLI cannot drift apart in what they
// burn into the page.

/**
 * The slice of the 2D canvas API the exporter actually touches. Deliberately
 * typed to match the DOM's own signatures so a real `CanvasRenderingContext2D`
 * satisfies it structurally with no cast; the Node adapter casts once at its
 * own boundary.
 */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
}

export interface RasterCanvas {
  readonly width: number;
  readonly height: number;
  readonly ctx: Ctx2D;
  /** JPEG bytes at the given quality (0–1). */
  encodeJpeg(quality: number): Promise<Uint8Array>;
  /** Drop the backing pixels; large documents rasterise page by page. */
  release(): void;
}

export interface PdfPlatform {
  createCanvas(width: number, height: number): RasterCanvas;
  /**
   * Where pdf.js should fetch the standard 14 fonts from — an http(s) URL in
   * the browser, a filesystem path in Node. Must end in a separator.
   */
  readonly standardFontDataUrl: string;
}

let installed: PdfPlatform | null = null;

export function setPdfPlatform(platform: PdfPlatform): void {
  installed = platform;
}

export function pdfPlatform(): PdfPlatform {
  if (!installed) {
    // Failing loudly beats rendering blank pages: a silently missing platform
    // would produce an export with no content and no black bars, which looks
    // like a redacted document but is simply an empty one.
    throw new Error(
      "No PDF platform installed — call setPdfPlatform() before loading or exporting a document.",
    );
  }
  return installed;
}
