// Generate a PDF full of fake sensitive data, for exercising detection and
// proving the export really strips the text layer.
//
// Usage: node scripts/make-test-pdf.mjs [out] [pages]
//
// Every value here is invented and formatted to match a pattern in
// src/pdf/patterns.ts. 4111-1111-1111-1111 is the standard test card number;
// 867-5309 is a pop song. Nothing in this file is anyone's real data.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/blackout-test.pdf";
const pages = Number(process.argv[3] ?? 1);

// Kept in sync with what the smoke tests assert must NOT survive an export.
export const SECRETS = [
  "123-45-6789",
  "jordan.test@example.com",
  "4111-1111-1111-1111",
  "555-867-5309",
];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

for (let i = 0; i < pages; i++) {
  const page = doc.addPage([612, 792]);
  const line = (text, y, size = 12) =>
    page.drawText(text, { x: 60, y, size, font });

  line(`EMPLOYMENT RECORD - CONFIDENTIAL (page ${i + 1})`, 720, 14);
  line("Name: Jordan Q. Testperson", 670);
  line("SSN: 123-45-6789", 645);
  line("Email: jordan.test@example.com", 620);
  line("Phone: 555-867-5309", 595);
  line("Card on file: 4111-1111-1111-1111", 570);
  line("Emergency contact: 555-123-4567 / alex.doe@example.org", 520);
  line("Notes: nothing sensitive on this line.", 495);
}

writeFileSync(out, await doc.save());
console.log(`wrote ${out} (${pages} page${pages === 1 ? "" : "s"})`);
