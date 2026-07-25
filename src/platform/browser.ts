// Browser adapter. Holds every DOM assumption the engine used to make inline:
// the canvas element, the JPEG encode, the pdf.js worker URL, and the font
// path. Nothing here is imported by the CLI or the MCP server.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker is bundled locally rather than fetched from a CDN — that is what
// keeps "nothing leaves your device" literally true on the web build.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { setPdfPlatform, type PdfPlatform, type RasterCanvas } from "../pdf/platform.ts";

function createCanvas(width: number, height: number): RasterCanvas {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  return {
    get width() {
      return canvas.width;
    },
    get height() {
      return canvas.height;
    },
    ctx,
    async encodeJpeg(quality) {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
          "image/jpeg",
          quality,
        ),
      );
      return new Uint8Array(await blob.arrayBuffer());
    },
    release() {
      // Zeroing the dimensions frees the backing store immediately instead of
      // waiting for GC, which matters on documents of a few hundred pages.
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export const browserPlatform: PdfPlatform = {
  createCanvas,
  // Standard 14 PDF fonts, served alongside the app (public/standard_fonts) so
  // PDFs relying on non-embedded base fonts render correctly.
  standardFontDataUrl: new URL(
    `${import.meta.env.BASE_URL}standard_fonts/`,
    window.location.href,
  ).href,
};

/** Call once at startup, before any PDF is loaded. */
export function installBrowserPlatform(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  setPdfPlatform(browserPlatform);
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
