// Mobile editor verification: emulates a touch phone (390×844, coarse
// pointer), loads a PDF, and asserts the mobile adaptations behave:
// fit-to-width pages, scroll-mode by default, draw only when toggled,
// bottom sheet opens. Saves screenshots for review.
// Usage: node scripts/mobile-check.mjs [test.pdf] [outdir]

import { launch } from "puppeteer-core";
import { preview } from "vite";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_PDF = process.argv[2] ?? "/mnt/d/claude/output/blackout-test.pdf";
const OUT = process.argv[3] ?? ".";
const CHROME_BIN =
  process.env.CHROME_BIN ??
  join(
    homedir(),
    ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
  );

const fail = (m) => {
  console.error("MOBILE CHECK FAIL:", m);
  process.exit(1);
};
const ok = (m) => console.log("  ok:", m);

const server = await preview({ preview: { port: 4213, host: "127.0.0.1" } });
const browser = await launch({
  executablePath: CHROME_BIN,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

try {
  await page.goto(server.resolvedUrls.local[0], { waitUntil: "networkidle0" });

  if (!(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)))
    fail("emulation is not reporting a coarse pointer");
  ok("coarse-pointer emulation active");

  const input = await page.$("input[type=file]");
  await input.uploadFile(TEST_PDF);
  await page.waitForSelector(".editor", { timeout: 20000 });
  await page.waitForFunction(
    () => !document.querySelector(".meta")?.textContent?.includes("scanning"),
    { timeout: 30000 },
  );

  // 1. Page fits the viewport
  const pageW = await page.$eval(".page", (el) => el.getBoundingClientRect().width);
  if (pageW > 390) fail(`page overflows: ${pageW}px wide on a 390px screen`);
  ok(`page fits viewport (${Math.round(pageW)}px wide)`);

  // 2. Mobile chrome is present
  for (const [sel, name] of [
    [".mobile-bar", "action bar"],
    [".draw-toggle", "draw toggle"],
  ]) {
    const visible = await page.$eval(sel, (el) => getComputedStyle(el).display !== "none");
    if (!visible) fail(`${name} not visible on mobile`);
  }
  ok("action bar and draw toggle visible");

  // 3. Scroll mode by default: a drag must NOT create a box
  // Fire each phase in its own task so React re-renders between them, as it
  // would with a real finger.
  const firePhase = (type, dx, dy) =>
    page.evaluate(
      (t, x, y) => {
        const overlay = document.querySelector(".overlay");
        const r = overlay.getBoundingClientRect();
        overlay.dispatchEvent(
          new PointerEvent(t, {
            bubbles: true,
            pointerId: 7,
            pointerType: "touch",
            clientX: r.left + x,
            clientY: r.top + y,
          }),
        );
      },
      type,
      dx,
      dy,
    );
  const drag = async () => {
    await firePhase("pointerdown", 40, 40);
    await new Promise((r) => setTimeout(r, 80));
    await firePhase("pointermove", 100, 70);
    await new Promise((r) => setTimeout(r, 80));
    await firePhase("pointermove", 140, 90);
    await new Promise((r) => setTimeout(r, 80));
    await firePhase("pointerup", 140, 90);
    await new Promise((r) => setTimeout(r, 400));
    return page.$$eval(".box.manual", (els) => els.length);
  };

  if ((await drag()) !== 0) fail("drag drew a box while in scroll mode");
  const scrollModeOn = await page.$eval(".overlay", (el) =>
    el.classList.contains("scroll-mode"),
  );
  if (!scrollModeOn) fail("overlay not in scroll mode by default on touch");
  ok("scroll mode default: drags don't draw");

  // 4. Draw mode: toggle on, same drag creates a box
  await page.click(".draw-toggle");
  await new Promise((r) => setTimeout(r, 300));
  if ((await drag()) !== 1) fail("draw mode drag did not create a box");
  ok("draw mode: drag creates a redaction box");
  await page.screenshot({ path: join(OUT, "mobile-editor.png") });

  // 5. Bottom sheet opens with detections
  await page.click(".sheet-toggle");
  await new Promise((r) => setTimeout(r, 400));
  const sheetShown = await page.$eval(".sidebar", (el) => {
    const r = el.getBoundingClientRect();
    return el.classList.contains("open") && r.top > 0 && r.top < innerHeight;
  });
  if (!sheetShown) fail("bottom sheet did not open");
  ok("bottom sheet opens");
  await page.screenshot({ path: join(OUT, "mobile-sheet.png") });

  console.log("\nMOBILE CHECK PASS ✅");
} finally {
  await browser.close();
  await server.close();
}
