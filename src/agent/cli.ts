// blackout — permanent PDF redaction from the command line.
//
// Written for two callers with the same needs: a person in a terminal, and an
// agent parsing stdout. Hence --json on every command, a non-zero exit on
// every failure, and no interactive prompts anywhere.
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve, basename } from "node:path";
// Before any PDF work: --json promises parseable stdout, and pdf.js logs its
// warnings there unless told otherwise.
import { protectStdout } from "./stdout-guard.ts";
import {
  CATEGORY_IDS,
  BlackoutError,
  FREE_PAGE_LIMIT,
  VERSION,
  redact,
  scan,
  type ScanResult,
} from "./engine.ts";

protectStdout();

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

// Engine errors that are really the caller mis-invoking us, not the run
// failing. These exit 2 like any other usage mistake, so a script can tell
// "you asked wrong" from "it didn't work".
const USAGE_CODES = new Set(["BAD_DETECTOR", "TERM_TOO_SHORT"]);

const USAGE = `blackout — permanently remove text from a PDF

  Drawing a black rectangle over text does not remove it: the text stays
  selectable underneath. This rasterises each page and rebuilds the file, so
  the text layer is gone. Everything happens on this machine.

USAGE
  blackout redact <input.pdf> [options]
  blackout check  <input.pdf> [options]

COMMANDS
  redact    write a redacted copy
  check     report what would be redacted; writes nothing

OPTIONS
  --detect <list>    comma-separated: ${CATEGORY_IDS.join(", ")}, or "all"/"none"
                     (default: all, unless --term is given and --detect is not)
  --term <string>    literal text to redact, case-insensitive; repeatable
  --out <file>       output path (default: <input>-redacted.pdf)
  --force            allow overwriting an existing output file
  --json             machine-readable result on stdout
  --license <token>  Pro license token (or set BLACKOUT_LICENSE)
  --quiet            suppress the human-readable summary
  -h, --help         this text
  -V, --version      print the version and exit

LIMITS
  Free up to ${FREE_PAGE_LIMIT} pages per document. A Pro license removes the limit.

EXAMPLES
  blackout redact filing.pdf --detect ssn,email --out clean.pdf
  blackout redact filing.pdf --term "Jane Doe" --term "Acme Corp"
  blackout check filing.pdf --json
`;

interface Args {
  command: string;
  input: string | null;
  detect?: string[];
  terms: string[];
  out: string | null;
  force: boolean;
  json: boolean;
  quiet: boolean;
  license: string | null;
  help: boolean;
  version: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "",
    input: null,
    terms: [],
    out: null,
    force: false,
    json: false,
    quiet: false,
    license: null,
    help: false,
    version: false,
  };

  const next = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new UsageError(`${flag} needs a value`);
    }
    return v;
  };

  let noMoreFlags = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Everything after `--` is a positional, so a file legitimately named
    // "-weird.pdf" can still be passed.
    if (noMoreFlags) {
      if (!args.command) args.command = a;
      else if (!args.input) args.input = a;
      else throw new UsageError(`Unexpected argument: ${a}`);
      continue;
    }
    switch (a) {
      case "--":
        noMoreFlags = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-V":
      case "--version":
        args.version = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--out":
      case "-o":
        args.out = next(i, a);
        i++;
        break;
      case "--term":
        args.terms.push(next(i, a));
        i++;
        break;
      // "license" is the house spelling; "--licence" stays as a permanent alias
      // because it shipped first and an agent will guess one or the other.
      case "--license":
      case "--licence":
        args.license = next(i, a);
        i++;
        break;
      case "--detect": {
        const raw = next(i, a);
        i++;
        const list = raw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (list.includes("all")) args.detect = [...CATEGORY_IDS];
        else if (list.includes("none")) args.detect = [];
        else args.detect = list;
        break;
      }
      default:
        if (a.startsWith("-")) throw new UsageError(`Unknown option: ${a}`);
        else if (!args.command) args.command = a;
        else if (!args.input) args.input = a;
        else throw new UsageError(`Unexpected argument: ${a}`);
    }
  }
  return args;
}

function defaultOutput(input: string): string {
  return input.replace(/\.pdf$/i, "") + "-redacted.pdf";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function describe(result: ScanResult): string[] {
  const lines: string[] = [];
  for (const c of result.byCategory) {
    lines.push(`  ${String(c.count).padStart(4)}  ${c.label}`);
  }
  if (!lines.length) lines.push("  (no detectors selected)");
  return lines;
}

/**
 * Surfaced on the success path, where the run still worked but quietly ran as
 * free tier. The over-limit case is a hard LICENSE_INVALID error from the
 * engine instead — there, the bad token is the whole reason the run failed.
 */
function warnIfLicenseInvalid(result: ScanResult, args: Args): void {
  // Not suppressed by --quiet: that hides the summary, and someone who paid for
  // Pro silently running as free tier is not a detail to tidy away. Suppressed
  // under --json only because licenseState carries the same fact in-band.
  if (result.licenseState !== "invalid" || args.json) return;
  process.stderr.write(
    "blackout: warning — a license token was supplied but failed verification; " +
      "running as free tier.\n",
  );
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.version) {
    // Combined with a command it is almost certainly a mistake, and honouring
    // it would exit 0 having redacted nothing — a scripted caller would read
    // that as success.
    if (args.command) {
      throw new UsageError("--version cannot be combined with a command");
    }
    process.stdout.write(VERSION + "\n");
    return EXIT_OK;
  }

  if (args.help || !args.command) {
    // --json means the caller is a program: give it something parseable rather
    // than a wall of help text.
    if (args.json) {
      const payload = args.help
        ? { ok: true, version: VERSION, commands: ["redact", "check"], detectors: CATEGORY_IDS }
        : { ok: false, code: "USAGE", error: "No command given. Expected 'redact' or 'check'." };
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      process.stdout.write(USAGE);
    }
    return args.help ? EXIT_OK : EXIT_USAGE;
  }
  if (args.command !== "redact" && args.command !== "check") {
    throw new UsageError(`Unknown command: ${args.command}`);
  }
  if (!args.input) throw new UsageError(`${args.command} needs an input PDF`);

  const input = resolve(args.input);
  if (!(await exists(input))) {
    throw new BlackoutError(`No such file: ${args.input}`, "NO_INPUT");
  }
  const bytes = new Uint8Array(await readFile(input));
  const opts = { detect: args.detect, terms: args.terms, license: args.license };

  if (args.command === "check") {
    const result = await scan(bytes, opts);
    if (args.json) {
      process.stdout.write(
        JSON.stringify({ ok: true, command: "check", file: input, ...result }, null, 2) + "\n",
      );
    } else if (!args.quiet) {
      process.stdout.write(
        `${basename(input)} — ${result.pages} page${result.pages === 1 ? "" : "s"}, ` +
          `${result.total} item${result.total === 1 ? "" : "s"} would be redacted\n` +
          describe(result).join("\n") +
          "\n",
      );
      if (!result.licensed && !result.withinFreeLimit) {
        // Same distinction redact makes: telling someone who supplied a token
        // that they need one is the bug PR #20 fixed, and it lived on here.
        process.stdout.write(
          result.licenseState === "invalid"
            ? `\n  Note: ${result.pages} pages exceeds the free limit of ${FREE_PAGE_LIMIT}, ` +
              `and the license token supplied failed verification — re-copy it from ` +
              `the Pro screen at https://blackout.thrain.ai.\n`
            : `\n  Note: ${result.pages} pages exceeds the free limit of ${FREE_PAGE_LIMIT}; ` +
              `redacting this file needs a Pro license.\n`,
        );
      }
    }
    warnIfLicenseInvalid(result, args);
    return EXIT_OK;
  }

  const out = resolve(args.out ?? defaultOutput(input));
  if (out === input && !args.force) {
    throw new BlackoutError(
      "Refusing to overwrite the input file. Choose --out, or pass --force if that is really what you want.",
      "WOULD_OVERWRITE_INPUT",
    );
  }
  if (!args.force && (await exists(out))) {
    throw new BlackoutError(
      `Output already exists: ${out}. Pass --force to overwrite.`,
      "OUTPUT_EXISTS",
    );
  }

  const result = await redact(bytes, opts);

  // The one assertion the product exists to make. If the output still has a
  // text layer, something is wrong with the export and shipping the file
  // anyway would be worse than failing — the caller would believe a document
  // was sanitised when it was not.
  if (result.extractableChars > 0) {
    throw new BlackoutError(
      `Redaction verification FAILED: the output still has ${result.extractableChars} ` +
        `characters of extractable text. No file was written.`,
      "VERIFY_FAILED",
    );
  }

  await writeFile(out, result.pdf);

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          command: "redact",
          input,
          output: out,
          bytes: result.pdf.length,
          redacted: result.scan.total,
          textLayerRemoved: true,
          extractableChars: result.extractableChars,
          ...result.scan,
        },
        null,
        2,
      ) + "\n",
    );
  } else if (!args.quiet) {
    process.stdout.write(
      `${basename(input)} → ${out}\n` +
        `  ${result.scan.pages} page${result.scan.pages === 1 ? "" : "s"} rasterised, ` +
        `${result.scan.total} redaction${result.scan.total === 1 ? "" : "s"} burned in\n` +
        describe(result.scan).join("\n") +
        `\n  verified: 0 characters of extractable text remain\n`,
    );
  }
  warnIfLicenseInvalid(result.scan, args);
  return EXIT_OK;
}

const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");

try {
  process.exitCode = await main(argv);
} catch (err) {
  const code = err instanceof BlackoutError ? err.code : err instanceof UsageError ? "USAGE" : "ERROR";
  const usage = err instanceof UsageError || USAGE_CODES.has(code);
  const message = err instanceof Error ? err.message : String(err);
  if (wantsJson) {
    process.stdout.write(JSON.stringify({ ok: false, code, error: message }, null, 2) + "\n");
  } else {
    process.stderr.write(`blackout: ${message}\n`);
    if (usage) process.stderr.write(`\nRun 'blackout --help' for usage.\n`);
  }
  process.exitCode = usage ? EXIT_USAGE : EXIT_FAIL;
}
