// Node adapter. The CLI and the MCP server install this and then run exactly
// the same rasterise-and-burn code the website runs — that is the point of the
// split. If the two ever produce different output, it is a bug here, not a
// second redaction implementation to keep in sync.
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type * as SkiaCanvas from "@napi-rs/canvas";
import {
  setPdfPlatform,
  type Ctx2D,
  type PdfPlatform,
  type RasterCanvas,
} from "../pdf/platform.ts";

const require = createRequire(import.meta.url);

const PDFJS_ENTRY = "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Loads @napi-rs/canvas through pdf.js's own resolution path rather than ours.
 *
 * This matters more than it looks. In Node, pdf.js renders glyphs by building
 * a Path2D and calling ctx.fill(path) — and it populates globalThis.Path2D
 * from whichever copy of @napi-rs/canvas *it* requires. Skia rejects a Path2D
 * that came from a different copy ("Value is none of these types `String`,
 * `Path`"), so if npm nests a second copy under pdfjs-dist, every page renders
 * blank or throws. Resolving from pdf.js's entry point means we always get the
 * instance it will use, whatever the install tree looks like.
 */
function loadSkia(): typeof SkiaCanvas {
  try {
    return createRequire(require.resolve(PDFJS_ENTRY))("@napi-rs/canvas");
  } catch (err) {
    throw new Error(
      "Blackout needs the '@napi-rs/canvas' package to rasterise pages in Node. " +
        `Install it alongside pdfjs-dist. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

const skia = loadSkia();

// pdf.js reads these off disk in Node (NodeStandardFontDataFactory), so this
// is a directory path rather than a URL. Resolved through the installed
// pdfjs-dist so the files ship with the dependency instead of being copied.
const STANDARD_FONT_DIR =
  dirname(require.resolve("pdfjs-dist/package.json")) + "/standard_fonts/";

function createCanvas(width: number, height: number): RasterCanvas {
  const canvas: SkiaCanvas.Canvas = skia.createCanvas(width, height);
  // Skia's context is API-compatible with the browser's for everything the
  // exporter does, but its type unions are its own. This is the single cast
  // that buys the rest of the engine its platform independence.
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  return {
    width,
    height,
    ctx,
    async encodeJpeg(quality) {
      // Skia takes quality as 0–100; the DOM takes 0–1.
      const buf = await canvas.encode("jpeg", Math.round(quality * 100));
      return new Uint8Array(buf);
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export const nodePlatform: PdfPlatform = {
  createCanvas,
  standardFontDataUrl: STANDARD_FONT_DIR,
};

/**
 * Call once before loading a document. The pdf.js worker is deliberately left
 * unset: in Node it falls back to running in-process, which is what we want —
 * no worker file to resolve, and nothing to spawn.
 */
export function installNodePlatform(): void {
  setPdfPlatform(nodePlatform);
}
