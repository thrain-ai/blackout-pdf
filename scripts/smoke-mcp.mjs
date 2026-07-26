// End-to-end smoke test for the MCP server: spawns it over stdio with a real
// MCP client, lists its tools, and does a full file round-trip through both of
// them — then checks the produced file the same way the other smoke tests do.
//
// Usage: node scripts/smoke-mcp.mjs [path-to-server]

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const SERVER = process.argv[2] ?? new URL("../src/agent/mcp.ts", import.meta.url).pathname;

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

const textOf = (res) =>
  (res.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n");

const dir = await mkdtemp(join(tmpdir(), "blackout-mcp-smoke-"));
console.log("server under test:", SERVER);

const transport = new StdioClientTransport({ command: "node", args: [SERVER] });
const client = new Client({ name: "blackout-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  ok("connected to the MCP server over stdio");

  const src = join(dir, "input.pdf");
  await run("node", [new URL("./make-test-pdf.mjs", import.meta.url).pathname, src, "1"]);

  // --- the tools are actually advertised ----------------------------------
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const want of ["check_pdf", "redact_pdf"]) {
    if (!names.includes(want)) fail(`tool not advertised: ${want}`);
  }
  if (names.length) ok(`tools advertised: ${names.join(", ")}`);

  // The description is the marketing surface — if it stops making the
  // falsifiable claim, a model has no reason to pick this over its own script.
  const redactTool = tools.find((t) => t.name === "redact_pdf");
  const desc = redactTool?.description ?? "";
  if (!/does not remove it|does NOT remove it/i.test(desc)) {
    fail("redact_pdf description no longer explains why a black rectangle is not redaction");
  } else {
    ok("redact_pdf description leads with the falsifiable claim");
  }
  if (!redactTool?.inputSchema?.properties?.path) fail("redact_pdf has no `path` input");

  // --- check_pdf ----------------------------------------------------------
  {
    const res = await client.callTool({ name: "check_pdf", arguments: { path: src } });
    if (res.isError) fail(`check_pdf errored: ${textOf(res)}`);
    const json = JSON.parse(textOf(res).slice(textOf(res).indexOf("{")));
    if (json.total !== 6) fail(`check_pdf: expected 6 detections, got ${json.total}`);
    else ok(`check_pdf found ${json.total} items across ${json.pages} page(s)`);

    // read-only really means read-only
    const before = (await stat(src)).mtimeMs;
    if (json.pages !== 1) fail("check_pdf: wrong page count");
    if ((await stat(src)).mtimeMs !== before) fail("check_pdf modified the input");
  }

  // --- redact_pdf: the round trip -----------------------------------------
  const out = join(dir, "clean.pdf");
  {
    const res = await client.callTool({
      name: "redact_pdf",
      arguments: { path: src, output_path: out },
    });
    if (res.isError) {
      fail(`redact_pdf errored: ${textOf(res)}`);
    } else {
      ok("redact_pdf returned success");
      const exported = await readFile(out);
      const text = await extractText(exported);
      for (const secret of SECRETS) {
        if (text.includes(secret)) fail(`SECRET LEAKED via MCP output: ${secret}`);
      }
      if (text.trim().length > 0) fail(`MCP output still has a text layer: ${text.slice(0, 80)}`);
      else ok("MCP output has NO extractable text — redaction is real");
      if (exported.length < 20000) fail(`MCP output too small to be a rendered page: ${exported.length}`);
      else ok(`MCP output is ${exported.length} bytes — page rendered, not blanked`);
    }
  }

  // --- the input is never touched -----------------------------------------
  {
    const stillThere = await extractText(await readFile(src));
    if (!SECRETS.every((s) => stillThere.includes(s))) fail("redact_pdf modified the input file");
    else ok("input file left untouched");
  }

  // --- guards surface as tool errors, not crashes -------------------------
  {
    const res = await client.callTool({
      name: "redact_pdf",
      arguments: { path: src, output_path: out },
    });
    if (!res.isError) fail("redact_pdf overwrote an existing output without overwrite:true");
    else ok("refuses to overwrite an existing output without overwrite:true");

    const onInput = await client.callTool({
      name: "redact_pdf",
      arguments: { path: src, output_path: src },
    });
    if (!onInput.isError) fail("redact_pdf wrote over its own input");
    else ok("refuses to write over the input file");

    const missing = await client.callTool({
      name: "check_pdf",
      arguments: { path: join(dir, "nope.pdf") },
    });
    if (!missing.isError) fail("missing file did not surface as an error");
    else ok("missing input surfaces as a tool error, not a crash");
  }
} finally {
  await client.close().catch(() => {});
  await rm(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\nMCP SMOKE FAIL ❌  (${failures} failed assertion${failures === 1 ? "" : "s"})`);
  process.exit(1);
}
console.log("\nMCP SMOKE PASS ✅");
