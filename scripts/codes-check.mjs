// Exemption-code verification: drives the editor as a Pro user, applies codes,
// exports, and reads the result back to prove the whole chain works —
// markers on the bars, a log page that lists them, and content pages that
// still have no extractable text.
//
// Runs against the DEV server on purpose: the Pro preview hook only exists in
// dev builds (it is dead-code-eliminated from production), so this is how Pro
// features get tested without a real license.
//
// Usage: node scripts/codes-check.mjs [test.pdf] [outdir]

import { launch } from "puppeteer-core";
import { createServer } from "vite";
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const TEST_PDF = process.argv[2] ?? "/mnt/d/claude/output/blackout-test.pdf";
const OUT = process.argv[3] ?? "/tmp";
const CHROME_BIN =
  process.env.CHROME_BIN ??
  join(
    homedir(),
    ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  );

const fail = (m) => {
  console.error("CODES CHECK FAIL:", m);
  process.exit(1);
};
const ok = (m) => console.log("  ok:", m);

async function extractPages(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str ?? "").join(" "));
  }
  await doc.destroy();
  return pages;
}

const server = await createServer({ server: { port: 4216, host: "127.0.0.1" } });
await server.listen();
const base = server.resolvedUrls.local[0];
console.log("dev server at", base);

const browser = await launch({
  executablePath: CHROME_BIN,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 950 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // Pro preview, then a clean load so we exercise the persisted state.
  await page.goto(base + "?dev_pro=1", { waitUntil: "networkidle0" });
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.waitForSelector(".logo-mark.pro", { timeout: 10000 });
  ok("dev Pro session active");

  const input = await page.$("input[type=file]");
  await input.uploadFile(TEST_PDF);
  await page.waitForSelector(".editor", { timeout: 20000 });
  await page.waitForFunction(
    () => !document.querySelector(".meta")?.textContent?.includes("scanning"),
    { timeout: 30000 },
  );

  // Codes are opt-in: the controls must be hidden until the switch is on.
  if (await page.$(".seg")) fail("code controls visible before opting in");
  await page.click(".codes-panel .switch");
  await page.waitForSelector(".seg", { timeout: 5000 });
  const sets = await page.$$eval(".seg-btn", (els) =>
    els.map((e) => e.textContent.trim()),
  );
  if (sets.length < 2) fail("expected both FOIA and litigation code sets");
  ok(`codes toggled on; sets available: ${sets.join(" / ")}`);

  // Redact everything; with no pinned code the FOIA auto-map applies (b)(6).
  for (const b of await page.$$(".category .mini-btn")) {
    if (/Redact all/.test(await b.evaluate((el) => el.textContent))) await b.click();
  }
  await new Promise((r) => setTimeout(r, 500));

  const markers = await page.$$eval(".box-marker", (els) =>
    els.map((e) => e.textContent),
  );
  if (markers.length === 0) fail("no marker figures rendered on the bars");
  const expected = markers.map((_, i) => String(i + 1));
  if (JSON.stringify([...markers].sort()) !== JSON.stringify(expected.sort()))
    fail(`markers are not a 1..N sequence: ${markers.join(",")}`);
  ok(`${markers.length} markers numbered 1..${markers.length} in the editor`);

  const codes = await page.$$eval(".code-select", (els) => els.map((e) => e.value));
  if (!codes.includes("foia:b6"))
    fail(`expected the FOIA privacy code on detected PII, got ${codes}`);
  ok("auto-mapped FOIA code (b)(6) shown on detected PII");

  // Per-row override: change one row's code without touching its neighbours,
  // and without the click toggling the redaction off.
  const rowCodes = () =>
    page.$$eval(".code-select", (els) => els.map((e) => e.value));
  const before = await rowCodes();
  if (before.length < 2) fail("expected several coded rows to test overrides");
  const target = await page.$(".code-select");
  await target.select("foia:b7c");
  await new Promise((r) => setTimeout(r, 400));
  const after = await rowCodes();
  if (after[0] !== "foia:b7c") fail(`override did not apply: ${after[0]}`);
  if (after.slice(1).join() !== before.slice(1).join())
    fail("override leaked into other rows");
  const stillRedacted = await page.$$eval(
    ".category input[type=checkbox]",
    (els) => els.every((e) => e.checked),
  );
  if (!stillRedacted) fail("using the code picker toggled the redaction off");
  const markersAfter = await page.$$eval(".box-marker", (els) => els.length);
  if (markersAfter === 0) fail("markers disappeared after override");
  ok("per-row override applies to one row only, without un-redacting it");

  // Put it back so the export assertions below see a uniform document.
  await target.select("foia:b6");
  await new Promise((r) => setTimeout(r, 400));

  // Export and read the result back.
  const dlDir = mkdtempSync(join(tmpdir(), "blackout-codes-"));
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await page.click(".export-btn");
  let file = null;
  for (let i = 0; i < 60 && !file; i++) {
    await new Promise((r) => setTimeout(r, 500));
    file = readdirSync(dlDir).find((f) => f.endsWith(".pdf") && !f.endsWith(".crdownload"));
  }
  if (!file) fail("no export appeared within 30s");

  const bytes = readFileSync(join(dlDir, file));
  const pages = await extractPages(bytes);
  const log = pages[pages.length - 1];
  const content = pages.slice(0, -1).join(" ").trim();

  if (content.length > 0)
    fail("content pages still have extractable text: " + content.slice(0, 120));
  ok("content pages have no extractable text (redaction still real)");

  const squashed = log.replace(/\s+/g, "");
  if (!squashed.includes("REDACTIONLOG")) fail("log page heading missing");
  if (!log.includes("(b)(6)")) fail("log page does not cite (b)(6)");
  if (!/Clearly unwarranted invasion of personal privacy/.test(log))
    fail("log page missing the stated basis for withholding");
  if (!/Prepared with Blackout/.test(log)) fail("log page missing the footer");
  if (!squashed.includes("BASISFORWITHHOLDING")) fail("log index header missing");
  if (!/not legal advice/.test(log) || !/preparer remains responsible/.test(log))
    fail("log page missing the closing disclaimer");
  ok("log page is selectable text with codes, bases, heading and footer");

  const logMarkers = (log.match(/\b\d+\b/g) ?? []).map(Number);
  if (!markers.every((m) => logMarkers.includes(Number(m))))
    fail("log page does not list every marker number");
  ok("every marker on a bar appears in the log index");

  await page.screenshot({ path: join(OUT, "codes-editor.png") });

  // The log must be previewed in the editor, not only in the download.
  await page.waitForSelector(".page-label.log", { timeout: 10000 });
  const logLabel = await page.$eval(".page-label.log", (el) => el.textContent);
  if (!/Redaction log/.test(logLabel)) fail("log preview label wrong: " + logLabel);
  ok(`log page previewed in the editor ("${logLabel.trim()}")`);

  // Second set: switching to litigation and re-applying recodes everything —
  // and, because that rebuilds the log, it's also the moment to prove the
  // preview never flashes black. An opaque canvas resets to black when
  // resized, which is exactly the regression being guarded here.
  await page.evaluate(() => {
    const wrap = [...document.querySelectorAll(".page-wrap")].find((w) =>
      w.querySelector(".page-label.log"),
    );
    wrap.scrollIntoView({ block: "center" });
    const canvas = wrap.querySelector("canvas");
    // Mean brightness of the WHOLE page (downscaled), not a single patch: a
    // mostly-white document page sits near 250, and any black/dark frame drags
    // the mean down unmistakably.
    const probe = document.createElement("canvas");
    probe.width = 24;
    probe.height = 24;
    const pctx = probe.getContext("2d");
    window.__lum = [];
    const tick = () => {
      try {
        if (!canvas.width) throw new Error("released");
        pctx.clearRect(0, 0, 24, 24);
        pctx.drawImage(canvas, 0, 0, 24, 24);
        const d = pctx.getImageData(0, 0, 24, 24).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        window.__lum.push(sum / (d.length / 4));
      } catch {
        window.__lum.push(-1);
      }
      if (window.__lum.length < 200) requestAnimationFrame(tick);
    };
    tick();
  });

  await page.evaluate(() => {
    [...document.querySelectorAll(".seg-btn")]
      .find((b) => /Litigation/.test(b.textContent))
      .click();
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".codes-panel .mini-btn")].find((b) =>
      /Apply to all/.test(b.textContent),
    );
    btn.click();
  });
  await new Promise((r) => setTimeout(r, 1800));

  const lum = await page.evaluate(() => window.__lum);
  const usable = lum.filter((v) => v >= 0);
  if (usable.length < 20)
    fail(`only ${usable.length} luminance samples — flash check inconclusive`);
  const darkest = Math.min(...usable);
  const typical = usable.reduce((a, b) => a + b, 0) / usable.length;
  if (darkest < 180)
    fail(
      `log preview flashed dark during rebuild (min ${darkest.toFixed(0)}/255, typical ${typical.toFixed(0)})`,
    );
  ok(
    `log rebuild never flashes dark (${usable.length} frames, min ${darkest.toFixed(0)}/255, typical ${typical.toFixed(0)})`,
  );
  const litCodes = await page.$$eval(".code-select", (els) => els.map((e) => e.value));
  if (!litCodes.includes("litigation:ssn"))
    fail(`litigation recode failed, codes: ${litCodes}`);
  ok("switching to the litigation set recodes redactions (SSN/TIN)");

  if (errors.length) fail("page errors: " + errors.join(" | "));
  console.log("\nCODES CHECK PASS ✅  (log page in " + file + ")");
} finally {
  await browser.close();
  await server.close();
}
