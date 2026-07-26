// The LEGACY build of pdf.js: same API, but transpiled for wider browser
// compatibility — Safari in particular chokes on assumptions the modern build
// makes (module workers, newest syntax). It is also the build with a working
// Node path, so the CLI and the website load documents through the same code.
//
// Worker setup and the standard-font location differ per environment and live
// in the platform adapter (src/platform/*), not here.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfPlatform } from "./platform.ts";

export async function loadPdf(
  data: ArrayBuffer | Uint8Array,
): Promise<PDFDocumentProxy> {
  const { standardFontDataUrl } = pdfPlatform();
  return pdfjs.getDocument({ data, standardFontDataUrl }).promise;
}
