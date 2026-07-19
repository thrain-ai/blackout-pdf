// The LEGACY build of pdf.js: same API, but transpiled for wider browser
// compatibility — Safari in particular chokes on assumptions the modern build
// makes (module workers, newest syntax). The worker is bundled locally; no
// CDN fetch, keeping the "nothing leaves your device" promise literal.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Standard 14 PDF fonts, served alongside the app (public/standard_fonts) so
// PDFs relying on non-embedded base fonts render correctly.
const standardFontDataUrl = new URL(
  `${import.meta.env.BASE_URL}standard_fonts/`,
  window.location.href,
).href;

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({ data, standardFontDataUrl }).promise;
}
