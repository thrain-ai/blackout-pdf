// End-to-end smoke test: drives the built app in headless Chromium, uploads a
// PDF containing fake sensitive data, redacts everything, exports, and then
// proves the exported PDF contains no extractable text.
//
// Usage: node scripts/smoke.mjs <test-pdf-path>
// Requires: `npm run build` first, and a Playwright/Chrome-for-Testing
// headless shell binary (path via CHROME_BIN or the default below).

import { launch } from "puppeteer-core";
import { preview } from "vite";
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const TEST_PDF = process.argv[2] ?? "/mnt/d/claude/output/blackout-test.pdf";
const CHROME_BIN =
  process.env.CHROME_BIN ??
  join(
    homedir(),
    ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  );

const fail = (msg) => {
  console.error("SMOKE FAIL:", msg);
  process.exit(1);
};
const ok = (msg) => console.log("  ok:", msg);

// --- extract text from a PDF buffer with pdf.js (node legacy build) ---------
async function extractText(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it) => it.str ?? "").join(" ");
  }
  await doc.destroy();
  return text;
}

const server = await preview({ preview: { port: 4173, host: "127.0.0.1" } });
// Derive the URL from the server: if the port was busy, vite picks another,
// and a hardcoded URL would silently test a stale instance.
const base = server.resolvedUrls.local[0];
console.log("preview server at", base);

const browser = await launch({
  executablePath: CHROME_BIN,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(base, { waitUntil: "networkidle0" });

  // 1. Landing renders
  await page.waitForSelector(".dropzone", { timeout: 10000 });
  const h1 = await page.$eval("h1", (el) => el.textContent);
  if (!/never leave your/.test(h1)) fail("hero headline missing: " + h1);
  ok("landing renders: " + h1.trim());

  // 2. Upload the test PDF
  const input = await page.$("input[type=file]");
  await input.uploadFile(TEST_PDF);
  await page.waitForSelector(".editor", { timeout: 15000 });
  ok("editor opened");

  // 3. Wait for scan to finish and check detections
  await page.waitForFunction(
    () => !document.querySelector(".meta")?.textContent?.includes("scanning"),
    { timeout: 20000 },
  );
  const cats = await page.$$eval(".category .cat-head span", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  console.log("  detected categories:", JSON.stringify(cats));
  const expect = [
    [/Social Security numbers \(1\)/, "SSN"],
    [/Email addresses \(2\)/, "emails"],
    [/Phone numbers \(2\)/, "phones"],
    [/Card numbers \(1\)/, "card"],
  ];
  for (const [re, label] of expect) {
    if (!cats.some((c) => re.test(c))) fail(`expected ${label} via ${re}`);
    ok(`detected ${label}`);
  }

  // 4. Redact all in every category
  const buttons = await page.$$(".category .mini-btn");
  for (const b of buttons) {
    const label = await b.evaluate((el) => el.textContent);
    if (/Redact all/.test(label)) await b.click();
  }
  const acceptedBoxes = await page.$$eval(
    ".box.suggestion.accepted",
    (els) => els.length,
  );
  if (acceptedBoxes < 6) fail(`only ${acceptedBoxes} accepted boxes on page`);
  ok(`${acceptedBoxes} redaction boxes active`);

  // 5. Export and capture the download
  const dlDir = mkdtempSync(join(tmpdir(), "blackout-smoke-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: dlDir,
  });
  await page.click(".export-btn");
  let file = null;
  for (let i = 0; i < 60 && !file; i++) {
    await new Promise((r) => setTimeout(r, 500));
    file = readdirSync(dlDir).find(
      (f) => f.endsWith(".pdf") && !f.endsWith(".crdownload"),
    );
  }
  if (!file) fail("no exported PDF appeared within 30s");
  ok("exported: " + file);

  // 6. Verify redaction is REAL: original text extracts, export has none
  const originalText = await extractText(readFileSync(TEST_PDF));
  if (!originalText.includes("123-45-6789"))
    fail("sanity: SSN not extractable from the ORIGINAL test pdf");
  ok("sanity: original PDF has extractable SSN");

  const exported = readFileSync(join(dlDir, file));
  if (exported.length < 10000) fail("exported PDF suspiciously small");
  const exportedText = await extractText(exported);
  for (const secret of [
    "123-45-6789",
    "jordan.test@example.com",
    "4111",
    "867-5309",
  ]) {
    if (exportedText.includes(secret))
      fail(`SECRET LEAKED into export: ${secret}`);
  }
  if (exportedText.trim().length > 0)
    fail("exported PDF still has a text layer: " + exportedText.slice(0, 120));
  ok("exported PDF has NO extractable text — redaction is real");

  if (pageErrors.length) fail("page errors: " + pageErrors.join(" | "));
  console.log("\nSMOKE PASS ✅  (" + exported.length + " byte export)");
} finally {
  await browser.close();
  await server.close();
}
