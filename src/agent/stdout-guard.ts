// Keeps stdout reserved for the caller's data.
//
// For both of our binaries, stdout is a contract rather than a place to talk:
// the CLI promises `--json` output an agent can parse, and the MCP server uses
// stdout as its actual JSON-RPC transport. Anything else written there is
// corruption.
//
// pdf.js does not know that. Its warn() and info() call console.log — which is
// stdout in Node — so a PDF with a damaged xref emits "Warning: Indexing all
// PDF objects" straight into the middle of our output. That was observed to
// break `--json` parsing outright, and to inject non-protocol lines into the
// MCP stream, where a strict client is entitled to drop the session.
//
// Suppressing the warnings would be the wrong trade: they are genuinely useful
// when a document misbehaves. They belong on stderr, which is free in both form
// factors, so the diagnostics survive and the contract holds.
//
// This is deliberately NOT called from engine.ts. Reaching up and rewiring the
// host's console is a reasonable thing for an application entry point to do and
// a rude thing for a library to do — anyone importing the engine keeps their
// own console.

let installed = false;

/**
 * Routes library chatter (console.log/info/debug) to stderr so nothing but our
 * own deliberate writes reach stdout. Call once, before any PDF work.
 */
export function protectStdout(): void {
  if (installed) return;
  installed = true;

  const toStderr =
    (prefix: string) =>
    (...args: unknown[]) => {
      const text = args
        .map((a) => (typeof a === "string" ? a : inspectish(a)))
        .join(" ");
      process.stderr.write(prefix + text + "\n");
    };

  console.log = toStderr("");
  console.info = toStderr("");
  console.debug = toStderr("");
  // console.warn and console.error already go to stderr in Node; leaving them
  // alone keeps their formatting intact.
}

function inspectish(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
