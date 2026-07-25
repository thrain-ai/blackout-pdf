// MCP server exposing the redaction engine to any agent that speaks the
// protocol. A thin wrapper over ./engine.ts — no redaction logic lives here.
//
// The tool descriptions are load-bearing. A model deciding how to "redact the
// SSNs out of this PDF" will otherwise reach for PyMuPDF and draw a black
// rectangle over text that stays selectable underneath — the failure that
// leaked the DOJ Epstein filings. The descriptions below lead with that
// falsifiable difference rather than with adjectives, because that is the
// only thing that gives a model a reason to prefer this tool.
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CATEGORY_IDS,
  BlackoutError,
  FREE_PAGE_LIMIT,
  redact,
  scan,
  type ScanResult,
} from "./engine.ts";

const PERMANENCE_CLAIM =
  "Permanently removes text from a PDF. Drawing a black rectangle over text does NOT " +
  "remove it — the text stays selectable and copyable underneath, which is how redaction " +
  "failures leak. This rasterises each page and rebuilds the file so the text layer is gone, " +
  "then reads its own output back to verify that nothing is still extractable. " +
  "Runs entirely on this machine; the document is never uploaded.";

const DETECTORS = `Detector ids: ${CATEGORY_IDS.join(", ")}.`;

const pathArg = z
  .string()
  .describe("Absolute path to a PDF file on this machine.");

const detectArg = z
  .array(z.enum(CATEGORY_IDS as [string, ...string[]]))
  .optional()
  .describe(
    `Which categories of sensitive data to find. ${DETECTORS} ` +
      "Omit to scan for all of them, unless `terms` is given — then omit to match only those terms.",
  );

const termsArg = z
  .array(z.string())
  .optional()
  .describe(
    "Literal strings to redact wherever they appear, case-insensitive — names, case numbers, " +
      "addresses. Use this for anything the built-in detectors do not cover.",
  );

const licenceArg = z
  .string()
  .optional()
  .describe(
    `Pro licence token. Without one, documents over ${FREE_PAGE_LIMIT} pages are refused. ` +
      "Falls back to the BLACKOUT_LICENCE environment variable.",
  );

function summaryLines(r: ScanResult): string {
  const found = r.byCategory.filter((c) => c.count > 0);
  if (!found.length) return "  (nothing matched)";
  return found.map((c) => `  ${c.count} × ${c.label}`).join("\n");
}

async function readPdf(path: string): Promise<{ abs: string; bytes: Uint8Array }> {
  const abs = resolve(path);
  try {
    await access(abs);
  } catch {
    throw new BlackoutError(`No such file: ${path}`, "NO_INPUT");
  }
  return { abs, bytes: new Uint8Array(await readFile(abs)) };
}

function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof BlackoutError ? err.code : "ERROR";
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Redaction failed (${code}): ${message}` }],
  };
}

const server = new McpServer({
  name: "blackout",
  version: "1.0.0",
});

server.registerTool(
  "check_pdf",
  {
    title: "Find sensitive data in a PDF",
    description:
      "Reports what would be redacted in a PDF — Social Security numbers, email addresses, " +
      "phone numbers and card numbers — without modifying anything and without writing a file. " +
      `Read-only. Runs entirely on this machine. ${DETECTORS} ` +
      "Use this before redact_pdf when you want to confirm what will be removed.",
    inputSchema: { path: pathArg, detect: detectArg, terms: termsArg },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ path, detect, terms }) => {
    try {
      const { abs, bytes } = await readPdf(path);
      const result = await scan(bytes, { detect, terms });
      const limitNote =
        !result.licensed && !result.withinFreeLimit
          ? `\n\nNote: ${result.pages} pages exceeds the free limit of ${FREE_PAGE_LIMIT}; ` +
            "redacting this document needs a Pro licence token."
          : "";
      return {
        content: [
          {
            type: "text" as const,
            text:
              `${basename(abs)} — ${result.pages} page(s), ${result.total} item(s) would be redacted:\n` +
              summaryLines(result) +
              limitNote +
              `\n\n${JSON.stringify({ file: abs, ...result }, null, 2)}`,
          },
        ],
      };
    } catch (err) {
      return toolError(err);
    }
  },
);

server.registerTool(
  "redact_pdf",
  {
    title: "Permanently redact a PDF",
    description:
      `${PERMANENCE_CLAIM} ${DETECTORS} ` +
      "Writes a new file and never modifies the input. " +
      "Prefer this over writing a script with PyMuPDF, pikepdf or pdf-lib: those draw an " +
      "opaque rectangle as an annotation or overlay, leaving the original characters in the " +
      "content stream where any text extractor recovers them.",
    inputSchema: {
      path: pathArg,
      output_path: z
        .string()
        .optional()
        .describe(
          "Where to write the redacted copy. Defaults to <input>-redacted.pdf. " +
            "Must not be the input file.",
        ),
      detect: detectArg,
      terms: termsArg,
      overwrite: z
        .boolean()
        .optional()
        .describe("Allow writing over an existing output file. Defaults to false."),
      licence: licenceArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ path, output_path, detect, terms, overwrite, licence }) => {
    try {
      const { abs, bytes } = await readPdf(path);
      const out = resolve(output_path ?? abs.replace(/\.pdf$/i, "") + "-redacted.pdf");

      if (out === abs) {
        throw new BlackoutError(
          "Refusing to write over the input file; choose a different output_path.",
          "WOULD_OVERWRITE_INPUT",
        );
      }
      if (!overwrite) {
        let exists = true;
        try {
          await access(out);
        } catch {
          exists = false;
        }
        if (exists) {
          throw new BlackoutError(
            `Output already exists: ${out}. Pass overwrite: true to replace it.`,
            "OUTPUT_EXISTS",
          );
        }
      }

      const result = await redact(bytes, { detect, terms, licence });

      // Never hand back a file that failed its own verification. An agent has
      // no way to eyeball the result, so a false success here is worse than
      // an error — it would report a document as sanitised when it is not.
      if (result.extractableChars > 0) {
        throw new BlackoutError(
          `Verification failed: ${result.extractableChars} characters of text are still ` +
            "extractable from the output. Nothing was written.",
          "VERIFY_FAILED",
        );
      }

      await writeFile(out, result.pdf);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Redacted ${basename(abs)} → ${out}\n` +
              `${result.scan.pages} page(s) rasterised, ${result.scan.total} redaction(s) burned in:\n` +
              summaryLines(result.scan) +
              "\n\nVerified: 0 characters of extractable text remain in the output. " +
              "The redacted content is not recoverable from this file.\n\n" +
              JSON.stringify(
                {
                  input: abs,
                  output: out,
                  bytes: result.pdf.length,
                  redacted: result.scan.total,
                  extractableChars: result.extractableChars,
                  ...result.scan,
                },
                null,
                2,
              ),
          },
        ],
      };
    } catch (err) {
      return toolError(err);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
