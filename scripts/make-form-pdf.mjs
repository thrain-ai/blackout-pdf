// Generate a PDF whose sensitive data lives where getTextContent() cannot see
// it: AcroForm field values, plus one rotated run. The page body itself carries
// no PII, so a detector that only reads the text layer finds nothing here — this
// fixture exercises form-field/annotation scanning and orientation-aware marks.
//
// Usage: node scripts/make-form-pdf.mjs [out]
//
// Every value here is invented and formatted to match a pattern in
// src/pdf/patterns.ts. Nothing in this file is anyone's real data.
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/blackout-form-test.pdf";

// The form fields carry these; the rotated run carries the second SSN.
export const FIELD_SECRETS = ["123-45-6789", "jdoe@secret.example.com"];
export const ROTATED_SECRET = "987-65-4321";

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([612, 792]);

page.drawText("APPLICATION FORM — the body text contains no sensitive data.", {
  x: 60,
  y: 730,
  size: 12,
  font,
});

// A 90°-rotated SSN drawn as page content: detected via the text layer, but the
// mark only lands on it once geometry accounts for the run's orientation.
page.drawText(ROTATED_SECRET, { x: 540, y: 300, size: 14, font, rotate: degrees(90) });

// PII inside AcroForm text fields — painted into the page on export, but absent
// from getTextContent().
const form = doc.getForm();
const ssn = form.createTextField("applicant.ssn");
ssn.setText(FIELD_SECRETS[0]);
ssn.addToPage(page, { x: 60, y: 660, width: 220, height: 22 });
const email = form.createTextField("applicant.email");
email.setText(FIELD_SECRETS[1]);
email.addToPage(page, { x: 60, y: 610, width: 260, height: 22 });

writeFileSync(out, await doc.save());
console.log(`wrote ${out}`);
