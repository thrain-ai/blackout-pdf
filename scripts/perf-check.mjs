// Performance measurement on a long document. Answers, with numbers:
//   - how long a 100-page file takes to open and scan
//   - how much canvas memory the editor holds (are pages rendered lazily?)
//   - how long an export takes
//
// Runs on the dev server so the Pro preview hook is available (page counts
// above the free limit otherwise hit the upgrade wall instead of exporting).
// App-code timings are therefore slightly conservative; export cost is
// dominated by pdf.js rasterisation and JPEG encoding, which is identical in
// both builds.
//
// Usage: node scripts/perf-check.mjs [pageCount]

import { launch } from "puppeteer-core";
import { createServer } from "vite";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const PAGES = Number(process.argv[2] ?? 100);
const CHROME_BIN =
  process.env.CHROME_BIN ??
  join(
    homedir(),
    ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  );

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// --- build a realistic long document ---------------------------------------
const src = await PDFDocument.create();
const font = await src.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= PAGES; i++) {
  const p = src.addPage([612, 792]);
  const lines = [
    `CASE FILE — PAGE ${i} OF ${PAGES}`,
    `Officer contact: officer${i}@example.gov`,
    `Subject SSN: ${String(100 + (i % 900)).padStart(3, "0")}-45-6789`,
    `Phone: (555) ${String(100 + (i % 900))}-${String(1000 + i).slice(-4)}`,
    "Narrative text follows and is not sensitive.",
  ];
  let y = 700;
  for (const line of lines) {
    p.drawText(line, { x: 60, y, size: 12, font });
    y -= 24;
  }
}
const srcPath = join(tmpdir(), `perf-${PAGES}p.pdf`);
writeFileSync(srcPath, await src.save());
console.log(`test document: ${PAGES} pages, ${mb(statSync(srcPath).size)}\n`);

const server = await createServer({ server: { port: 4220, host: "127.0.0.1" } });
await server.listen();
const browser = await launch({
  executablePath: CHROME_BIN,
  args: ["--no-sandbox", "--disable-gpu", "--js-flags=--expose-gc"],
  defaultViewport: { width: 1440, height: 950 },
});

try {
  const page = await browser.newPage();
  // Never let a native dialog silently hang the run.
  page.on("dialog", async (d) => {
    console.log("DIALOG:", d.message());
    await d.dismiss();
  });
  page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 300)));
  const base = server.resolvedUrls.local[0];
  await page.goto(base + "?dev_pro=1", { waitUntil: "networkidle0" });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".logo-mark.pro", { timeout: 15000 });

  const canvasStats = () =>
    page.evaluate(() => {
      const all = [...document.querySelectorAll(".page canvas")];
      const live = all.filter((c) => c.width > 0);
      const px = live.reduce((n, c) => n + c.width * c.height, 0);
      return { total: all.length, live: live.length, bytes: px * 4 };
    });
  const heap = () =>
    page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);

  const t0 = Date.now();
  await (await page.$("input[type=file]")).uploadFile(srcPath);
  await page.waitForSelector(".editor", { timeout: 120000 });
  const tOpen = Date.now() - t0;

  await page.waitForFunction(
    () => !document.querySelector(".meta")?.textContent?.includes("scanning"),
    { timeout: 300000, polling: 500 },
  );
  const tScan = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1500));

  const atTop = await canvasStats();
  console.log(`open (editor visible):   ${secs(tOpen)}`);
  console.log(`scan complete:           ${secs(tScan)}  (${(tScan / PAGES).toFixed(0)} ms/page)`);
  console.log(
    `canvases at top:         ${atTop.live} of ${atTop.total} rendered · ${mb(atTop.bytes)} of pixels`,
  );
  console.log(`JS heap:                 ${mb(await heap())}`);

  // Scroll to the middle: canvases should be recycled, not accumulated.
  await page.evaluate(() => {
    const el = document.querySelector(".pages");
    el.scrollTop = el.scrollHeight / 2;
  });
  await new Promise((r) => setTimeout(r, 2500));
  const atMid = await canvasStats();
  console.log(
    `canvases mid-document:   ${atMid.live} of ${atMid.total} rendered · ${mb(atMid.bytes)} of pixels`,
  );
  console.log(`JS heap after scrolling: ${mb(await heap())}`);

  const detections = await page.$$eval(".category .cat-head span", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  console.log(`detections:              ${detections.join(" · ")}`);

  // Redact everything, then export.
  const tRedact0 = Date.now();
  for (const b of await page.$$(".category .mini-btn")) {
    if (/Redact all/.test(await b.evaluate((el) => el.textContent))) await b.click();
  }
  await new Promise((r) => setTimeout(r, 800));
  console.log(`redact all:              ${secs(Date.now() - tRedact0)}`);

  // Codes on: how long until the appended log is built and previewed?
  const tLog0 = Date.now();
  await page.click(".codes-panel .switch");
  await page.evaluate(() => {
    [...document.querySelectorAll(".codes-panel .mini-btn")]
      .find((b) => /Apply to all/.test(b.textContent))
      ?.click();
  });
  await page.waitForSelector(".page-label.log", { timeout: 120000 });
  const tLog = Date.now() - tLog0;
  const logPages = await page.$$eval(".page-label.log", (els) => els.length);
  const coded = await page.$$eval(".box-marker", (els) => els.length);
  console.log(
    `log built + previewed:   ${secs(tLog)}  (${coded} coded, ${logPages} log page${logPages === 1 ? "" : "s"})`,
  );

  const dlDir = mkdtempSync(join(tmpdir(), "perf-export-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: dlDir,
  });
  const tExp0 = Date.now();
  await page.click(".export-btn");
  let file = null;
  for (let i = 0; i < 600 && !file; i++) {
    await new Promise((r) => setTimeout(r, 500));
    file = readdirSync(dlDir).find(
      (f) => f.endsWith(".pdf") && !f.endsWith(".crdownload"),
    );
  }
  if (!file) {
    console.log("export:                  DID NOT COMPLETE within 300s");
  } else {
    const tExp = Date.now() - tExp0;
    console.log(
      `export:                  ${secs(tExp)}  (${(tExp / PAGES).toFixed(0)} ms/page) · ${mb(statSync(join(dlDir, file)).size)}`,
    );
  }
  console.log(`JS heap after export:    ${mb(await heap())}`);
} finally {
  await browser.close();
  await server.close();
}
