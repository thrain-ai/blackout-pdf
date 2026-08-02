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
async function cliEnv(args, extraEnv = {}) {
  // A stray BLACKOUT_LICENSE in the ambient environment would make the
  // license assertions below lie, so the base env is scrubbed of both
  // spellings and each case opts in to exactly what it wants to test.
  const env = { ...process.env, ...extraEnv };
  for (const key of ["BLACKOUT_LICENSE", "BLACKOUT_LICENCE"]) {
    if (!(key in extraEnv)) delete env[key];
  }
  try {
    const { stdout, stderr } = await run("node", [CLI, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      env,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const cli = (args) => cliEnv(args);

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

  // --- an invalid license must not silently unlock --------------------------
  // Regression: a bad token used to produce a plain PAGE_LIMIT error telling
  // the caller to "supply a Pro license" — advice that is actively wrong for
  // someone who already supplied one. The two cases must stay distinguishable.
  {
    const { code, stdout } = await cli([
      "redact", big, "--license", "not.a.real.token", "--out", join(dir, "big2.pdf"), "--json",
    ]);
    const r = JSON.parse(stdout);
    if (code === 0) fail("a bogus license token unlocked the page limit");
    else if (r.code !== "LICENSE_INVALID") {
      fail(`a supplied-but-invalid token should report LICENSE_INVALID, got ${r.code}`);
    } else if (/supply a pro license/i.test(r.error)) {
      fail("LICENSE_INVALID still tells the caller to supply a license they already supplied");
    } else ok("a forged license token reports LICENSE_INVALID, not a misleading PAGE_LIMIT");

    // No token at all is a different problem and keeps the original code.
    const none = await cli(["redact", big, "--out", join(dir, "big3.pdf"), "--json"]);
    const nr = JSON.parse(none.stdout);
    if (nr.code !== "PAGE_LIMIT") fail(`no token should report PAGE_LIMIT, got ${nr.code}`);
    else ok("no license at all still reports PAGE_LIMIT");

    // The deprecated spelling must keep working — it shipped, and dropping it
    // would silently downgrade existing callers to the free tier.
    const alias = await cli([
      "redact", big, "--licence", "not.a.real.token", "--out", join(dir, "big4.pdf"), "--json",
    ]);
    if (JSON.parse(alias.stdout).code !== "LICENSE_INVALID") {
      fail("--licence alias no longer reaches the license check");
    } else ok("--licence alias still honoured");

    // Same via the environment variable, both spellings.
    for (const key of ["BLACKOUT_LICENSE", "BLACKOUT_LICENCE"]) {
      const res = await cliEnv(
        ["redact", big, "--out", join(dir, `env-${key}.pdf`), "--json"],
        { [key]: "not.a.real.token" },
      );
      if (JSON.parse(res.stdout).code !== "LICENSE_INVALID") {
        fail(`${key} with an invalid token did not report LICENSE_INVALID`);
      } else ok(`${key} invalid token reports LICENSE_INVALID`);
    }
  }

  // --- an invalid token on a SUCCEEDING run still warns ---------------------
  // The old warning was gated on a zero exit code and unreachable in the case
  // it was written for; this one has to actually appear.
  {
    const res = await cliEnv(["check", src], { BLACKOUT_LICENSE: "not.a.real.token" });
    if (res.code !== 0) fail(`check with a bad token should still succeed, got ${res.code}`);
    else if (!/failed verification/i.test(res.stderr)) {
      fail("no warning when a supplied token is invalid on a successful run");
    } else ok("an invalid token warns on stderr even when the run succeeds");

    // --json output must stay machine-parseable: the warning goes to stderr.
    const j = await cliEnv(["check", src, "--json"], { BLACKOUT_LICENSE: "not.a.real.token" });
    try {
      const parsed = JSON.parse(j.stdout);
      if (parsed.licenseState !== "invalid") {
        fail(`--json should report licenseState "invalid", got ${parsed.licenseState}`);
      } else ok('--json reports licenseState:"invalid" and stdout stays valid JSON');
    } catch {
      fail("the license warning corrupted --json stdout");
    }
  }

  // --- the version the binary reports matches the package it ships in -------
  {
    const { code, stdout } = await cli(["--version"]);
    const reported = stdout.trim();
    if (code !== 0) fail(`--version exited ${code}`);
    else if (!/^\d+\.\d+\.\d+/.test(reported)) fail(`--version printed "${reported}"`);
    else ok(`--version reports ${reported}`);

    // Only meaningful against a built bundle; running from source has no
    // package.json to compare with and reports the dev placeholder.
    if (CLI.endsWith(".mjs")) {
      const pkg = JSON.parse(
        await readFile(new URL("../packages/blackout/package.json", import.meta.url), "utf8"),
      );
      if (reported !== pkg.version) {
        fail(`binary reports ${reported} but package.json says ${pkg.version}`);
      } else ok(`reported version matches package.json (${pkg.version})`);
    }
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

  // --- stdout stays parseable even when pdf.js complains -------------------
  // The original version of this suite only ever fed the CLI a pristine
  // fixture, so it certified "--json is valid JSON" while a damaged PDF was
  // corrupting it in the field. pdf.js logs warnings through console.log, which
  // is stdout in Node. Any document that provokes one must not break the
  // contract that agents parse stdout.
  {
    const damaged = join(dir, "damaged.pdf");
    const original = await readFile(src);
    const text = original.toString("latin1");
    const marker = text.lastIndexOf("startxref");
    const eol = text.indexOf("\n", marker);
    // A startxref pointing into space forces pdf.js to rebuild the xref table,
    // which it announces loudly — the same thing real scanned and recovered
    // documents do.
    await writeFile(
      damaged,
      Buffer.from(
        text.slice(0, eol + 1) + "999999\n" + text.slice(text.indexOf("%%EOF", eol)),
        "latin1",
      ),
    );

    const res = await cli(["redact", damaged, "--out", join(dir, "damaged-out.pdf"), "--json"]);
    if (res.code !== 0) {
      fail(`redacting a damaged-xref PDF failed outright: ${res.stdout}${res.stderr}`);
    } else {
      try {
        const parsed = JSON.parse(res.stdout);
        if (!parsed.ok) fail("damaged PDF reported not-ok");
        else ok("--json stdout stays parseable on a PDF that provokes pdf.js warnings");
      } catch (e) {
        fail(`pdf.js chatter corrupted --json stdout: ${res.stdout.slice(0, 120)}`);
      }
      if (!/warning/i.test(res.stderr)) {
        // Not fatal, but the diagnostics should survive rather than vanish.
        console.log("  note: no warning seen on stderr for the damaged fixture");
      } else ok("pdf.js warnings are preserved on stderr, not discarded");
    }
  }

  // --- short --term must refuse, not silently redact everything ------------
  // Regression: `--term "J"` used to drop the term AND re-enable every built-in
  // detector, blacking out content the caller never asked about.
  {
    const res = await cli(["check", src, "--term", "J", "--json"]);
    if (res.code === 0) {
      fail("a 1-character --term was accepted; it should be refused");
    } else {
      const r = JSON.parse(res.stdout);
      if (r.code !== "TERM_TOO_SHORT") fail(`expected TERM_TOO_SHORT, got ${r.code}`);
      else ok("a too-short --term is refused rather than silently widening the scan");
      if (res.code !== 2) fail(`TERM_TOO_SHORT should exit 2 (usage), got ${res.code}`);
      else ok("TERM_TOO_SHORT exits 2");
    }
  }

  // --- --version must not stand in for doing the work ----------------------
  {
    const out = join(dir, "version-noop.pdf");
    const res = await cli(["redact", src, "--out", out, "--version"]);
    if (res.code === 0) fail("--version alongside a command exited 0 without redacting");
    else ok("--version combined with a command is a usage error, not a silent no-op");
    let wrote = true;
    try {
      await stat(out);
    } catch {
      wrote = false;
    }
    if (wrote) fail("a file was written on the --version path");

    const alone = await cli(["--version"]);
    if (alone.code !== 0 || !/^\d+\.\d+\.\d+/.test(alone.stdout.trim())) {
      fail(`bare --version should still work, got ${alone.code}/${alone.stdout.trim()}`);
    } else ok("bare --version still works");
  }

  // --- --quiet must not hide a failed license ------------------------------
  {
    const res = await cliEnv(["check", src, "--quiet"], { BLACKOUT_LICENSE: "not.a.real.token" });
    if (!/failed verification/i.test(res.stderr)) {
      fail("--quiet suppressed the invalid-license warning");
    } else ok("--quiet still surfaces an invalid license on stderr");
  }

  // --- machine callers get JSON even when they misuse the CLI --------------
  {
    const res = await cli(["--json"]);
    try {
      const r = JSON.parse(res.stdout);
      if (r.ok !== false || r.code !== "USAGE") fail(`unexpected no-command JSON: ${res.stdout}`);
      else ok("--json with no command returns a JSON usage error, not help text");
    } catch {
      fail(`--json with no command emitted non-JSON: ${res.stdout.slice(0, 80)}`);
    }
  }

  // --- bad detector is a usage mistake, like every other bad argument ------
  {
    const res = await cli(["check", src, "--detect", "bogus"]);
    if (res.code !== 2) fail(`BAD_DETECTOR should exit 2 (usage), got ${res.code}`);
    else ok("BAD_DETECTOR exits 2, consistent with other argument mistakes");
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
