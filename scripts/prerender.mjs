// Post-build prerender.
//
// The app is a client-rendered SPA, so what we actually ship is an empty
// <div id="root"> — about 1.3 KB of nothing. Google renders JavaScript on a
// deferred second pass and deprioritises sites with no track record; Bing,
// DuckDuckGo, the social preview bots and every AI crawler (GPTBot, ClaudeBot,
// PerplexityBot) largely don't run it at all. This bakes the rendered landing
// page back into dist/index.html so there is something to read without JS.
//
// The app still boots normally on top of it: createRoot() discards the baked
// markup on mount. So this serves crawlers, not hydration. hydrateRoot() would
// be tidier, but invites mismatch bugs in an app whose first paint depends on
// localStorage, for the same crawler outcome.
//
// It also derives the FAQPage JSON-LD from the FAQ it just rendered, so the
// structured data can never drift away from the copy on the page.
//
// Usage: node scripts/prerender.mjs      (after vite build)
// Env:   SITE_URL, CHROME_BIN

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { homedir } from "node:os";
import { launch } from "puppeteer-core";

const DIST = new URL("../dist/", import.meta.url).pathname;
const SITE_URL = process.env.SITE_URL ?? "";

// puppeteer-core deliberately ships no browser, and this runs both on the dev
// box and in CI. Try the usual homes and fail loudly listing what was tried —
// a prerender that quietly no-ops would ship a blank page to production and
// nobody would notice until the traffic didn't arrive.
function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    join(homedir(), ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome"),
    join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell"),
  ].filter(Boolean);

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `prerender: no Chrome binary found. Set CHROME_BIN. Tried:\n  ${candidates.join("\n  ")}`,
    );
  }
  return found;
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

// --- serve dist/ so the built bundle runs exactly as it will in production ---
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split("?")[0]);
  const file = join(DIST, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    // extname on the resolved file, not the request path: "/" has no extension,
    // and serving index.html as octet-stream makes Chrome download rather than
    // navigate.
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const browser = await launch({
  executablePath: findChrome(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/`, {
    waitUntil: "networkidle0",
    timeout: 60_000,
  });

  // Wait for real content rather than a mounted-but-empty root, so a silent
  // render failure can't bake a blank page.
  await page.waitForFunction(
    () => document.querySelector("#root")?.children.length > 0,
    { timeout: 30_000 },
  );

  if (pageErrors.length) {
    throw new Error(`page errors during prerender:\n  ${pageErrors.join("\n  ")}`);
  }

  // --- FAQPage JSON-LD, read from the FAQ that just rendered ---------------
  const faq = await page.evaluate(() =>
    [...document.querySelectorAll("details")]
      .map((d) => {
        const q = d.querySelector("summary")?.textContent?.trim();
        const clone = d.cloneNode(true);
        clone.querySelector("summary")?.remove();
        const a = clone.textContent.replace(/\s+/g, " ").trim();
        return q && a ? { q, a } : null;
      })
      .filter(Boolean),
  );

  const html = await page.content();
  const textLength = await page.evaluate(
    () => document.body.innerText.replace(/\s+/g, " ").trim().length,
  );
  if (textLength < 500) {
    throw new Error(
      `prerendered page has only ${textLength} chars of text — refusing to ship a blank page`,
    );
  }

  let out = html;
  if (faq.length) {
    const ld = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    };
    out = out.replace(
      "</head>",
      `  <script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n  </script>\n  </head>`,
    );
  }

  await writeFile(join(DIST, "index.html"), out);

  console.log(
    `prerendered dist/index.html — ${textLength} chars of text, ${faq.length} FAQ entries in JSON-LD${SITE_URL ? ` (${SITE_URL})` : ""}`,
  );
} finally {
  await browser.close();
  server.close();
}
