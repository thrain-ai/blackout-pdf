// End-to-end smoke test for the CLI path.
//
// scripts/smoke.mjs makes this assertion about the browser: after an export,
// the sensitive text is not merely covered, it is not in the file. This makes
// the same assertion about the CLI, because the promise has to hold on every
// path that ships — an agent redacting a filing has no way to eyeball the
// result, so the guarantee is the only thing standing between it and the
// failure that leaked the Epstein filings.
//
// Usage: node scripts/smoke-cli.mjs [path-to-cli]
//   defaults to running the TypeScript source; pass a built bundle to test
//   what actually ships.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const CLI = process.argv[2] ?? new URL("../src/agent/cli.ts", import.meta.url).pathname;

const SECRETS = [
  "123-45-6789",
  "jordan.test@example.com",
  "4111-1111-1111-1111",
  "555-867-5309",
];

let failures = 0;
const ok = (msg) => console.log("  ok:", msg);
const fail = (msg) => {
  console.error("  FAIL:", msg);
  failures++;
};

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

// Never throws on a non-zero exit — the exit code is part of what we assert.
async function cli(args) {
  try {
    const { stdout, stderr } = await run("node", [CLI, ...args], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const dir = await mkdtemp(join(tmpdir(), "blackout-cli-smoke-"));
console.log("CLI under test:", CLI);
console.log("workdir:", dir);

try {
  const src = join(dir, "input.pdf");
  const big = join(dir, "big.pdf");
  await run("node", [new URL("./make-test-pdf.mjs", import.meta.url).pathname, src, "1"]);
  await run("node", [new URL("./make-test-pdf.mjs", import.meta.url).pathname, big, "12"]);

  // --- sanity: the fixture really does leak before we touch it -------------
  const originalText = await extractText(await readFile(src));
  const missing = SECRETS.filter((s) => !originalText.includes(s));
  if (missing.length) fail(`fixture is not a valid test — missing ${missing.join(", ")}`);
  else ok("fixture contains all 4 secrets as extractable text");

  // --- check reports what it will do, and writes nothing -------------------
  {
    const { code, stdout } = await cli(["check", src, "--json"]);
    if (code !== 0) fail(`check exited ${code}`);
    const r = JSON.parse(stdout);
    const counts = Object.fromEntries(r.byCategory.map((c) => [c.id, c.count]));
    const want = { ssn: 1, card: 1, email: 2, phone: 2 };
    for (const [id, n] of Object.entries(want)) {
      if (counts[id] !== n) fail(`check: expected ${n} ${id}, got ${counts[id]}`);
    }
    if (r.pages !== 1) fail(`check: expected 1 page, got ${r.pages}`);
    if (r.total !== 6) fail(`check: expected 6 detections, got ${r.total}`);
    else ok("check --json reports 6 detections across 4 categories");
  }

  // --- the assertion this whole file exists for ---------------------------
  const out = join(dir, "clean.pdf");
  {
    const { code, stdout } = await cli(["redact", src, "--out", out, "--json"]);
    if (code !== 0) {
      fail(`redact exited ${code}: ${stdout}`);
    } else {
      const r = JSON.parse(stdout);
      if (!r.ok) fail(`redact reported not-ok: ${stdout}`);
      if (r.redacted !== 6) fail(`redact: expected 6 redactions, got ${r.redacted}`);
      ok(`redact wrote ${r.bytes} bytes, ${r.redacted} redactions`);
    }

    const exported = await readFile(out);
    if (exported.length < 5000) fail(`output suspiciously small: ${exported.length} bytes`);

    const text = await extractText(exported);
    for (const secret of SECRETS) {
      if (text.includes(secret)) fail(`SECRET LEAKED into CLI output: ${secret}`);
    }
    if (text.trim().length > 0) {
      fail(`output still has a text layer: ${text.slice(0, 120)}`);
    } else {
      ok("CLI output has NO extractable text — redaction is real");
    }
  }

  // --- a blank page would also pass the assertion above --------------------
  // So confirm the page still carries ink: a rasterised page of this fixture
  // is tens of KB of JPEG. An empty one is not.
  {
    const size = (await stat(out)).size;
    if (size < 20000) fail(`output too small to contain a rendered page: ${size} bytes`);
    else ok(`output is ${size} bytes — the page was rendered, not blanked`);
  }

  // --- custom terms --------------------------------------------------------
  {
    const termOut = join(dir, "term.pdf");
    const { code, stdout } = await cli([
      "redact", src, "--term", "Jordan Q. Testperson", "--out", termOut, "--json",
    ]);
    if (code !== 0) fail(`--term redact exited ${code}: ${stdout}`);
    else {
      const r = JSON.parse(stdout);
      if (r.redacted < 1) fail("--term matched nothing");
      else ok(`--term redacted ${r.redacted} occurrence(s) of a custom string`);
      const text = await extractText(await readFile(termOut));
      if (text.trim().length > 0) fail("--term output still has a text layer");
    }
  }

  // --- detector selection --------------------------------------------------
  {
    const { code, stdout } = await cli(["check", src, "--detect", "ssn", "--json"]);
    const r = JSON.parse(stdout);
    if (code !== 0 || r.total !== 1) fail(`--detect ssn should find exactly 1, got ${r.total}`);
    else ok("--detect ssn narrows to 1 detection");
  }

  // --- the licence boundary ------------------------------------------------
  {
    const { code, stdout } = await cli(["redact", big, "--out", join(dir, "big-out.pdf"), "--json"]);
    const r = JSON.parse(stdout);
    if (code === 0) fail("12-page document was redacted without a licence");
    else if (r.code !== "PAGE_LIMIT") fail(`expected PAGE_LIMIT, got ${r.code}`);
    else ok("12-page document refused on the free tier (PAGE_LIMIT)");

    let wrote = true;
    try {
      await stat(join(dir, "big-out.pdf"));
    } catch {
      wrote = false;
    }
    if (wrote) fail("a file was written despite the page limit being exceeded");
    else ok("no output file written when the limit is exceeded");
  }

  // --- an invalid licence must not silently unlock --------------------------
  {
    const { code, stdout } = await cli([
      "redact", big, "--licence", "not.a.real.token", "--out", join(dir, "big2.pdf"), "--json",
    ]);
    const r = JSON.parse(stdout);
    if (code === 0) fail("a bogus licence token unlocked the page limit");
    else if (r.code !== "PAGE_LIMIT") fail(`expected PAGE_LIMIT for bogus token, got ${r.code}`);
    else ok("a forged licence token does not unlock the page limit");
  }

  // --- destructive-action guards -------------------------------------------
  {
    const { code } = await cli(["redact", src, "--out", out]);
    if (code === 0) fail("overwrote an existing output without --force");
    else ok("refuses to overwrite an existing output without --force");

    const forced = await cli(["redact", src, "--out", out, "--force"]);
    if (forced.code !== 0) fail(`--force should allow overwrite, exited ${forced.code}`);
    else ok("--force allows the overwrite");

    const onInput = await cli(["redact", src, "--out", src]);
    if (onInput.code === 0) fail("overwrote the INPUT file without --force");
    else ok("refuses to overwrite the input file without --force");
    const stillLeaks = await extractText(await readFile(src));
    if (!stillLeaks.includes(SECRETS[0])) fail("the input file was modified");
  }

  // --- usage errors are distinguishable from failures ----------------------
  {
    const { code } = await cli(["check", src, "--nonsense"]);
    if (code !== 2) fail(`unknown option should exit 2, got ${code}`);
    else ok("unknown option exits 2 (usage), not 1");

    const missingFile = await cli(["check", join(dir, "nope.pdf"), "--json"]);
    if (missingFile.code === 0) fail("missing input should be an error");
    else ok("missing input exits non-zero with a JSON error");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\nCLI SMOKE FAIL ❌  (${failures} failed assertion${failures === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("\nCLI SMOKE PASS ✅");
