# @thrain/blackout

Permanently remove text from a PDF, from the command line.

Drawing a black rectangle over text does not remove it. The rectangle is an
annotation or an overlay; the characters stay in the content stream underneath,
where any text extractor recovers them in one line of code. That is not a
hypothetical — it is how redaction failures leak, most famously in filings that
were published with the "redacted" names still selectable.

Blackout rasterises every page, burns the bars into the pixels, and rebuilds the
file from the images. The text layer does not survive. Then it reads its own
output back and counts the characters still extractable; if that number is not
zero, it fails instead of writing a file.

Everything happens on your machine. There is no upload, no API call, and no
network access at any point — including the licence check, which verifies a
signature offline.

## Use

```bash
npx @thrain/blackout check filing.pdf
npx @thrain/blackout redact filing.pdf --detect ssn,email --out clean.pdf
npx @thrain/blackout redact filing.pdf --term "Jane Doe" --term "Acme Corp"
```

`check` reports what would be redacted and writes nothing. `redact` writes a new
file and never modifies the input.

## Options

| Flag | Meaning |
|---|---|
| `--detect <list>` | `ssn`, `card`, `email`, `phone`, or `all` / `none`. Defaults to all — unless `--term` is given and `--detect` is not, in which case only the terms match. |
| `--term <string>` | Literal text to redact, case-insensitive. Repeatable. |
| `--out <file>` | Output path. Defaults to `<input>-redacted.pdf`. |
| `--force` | Allow overwriting an existing output file. |
| `--json` | Machine-readable result on stdout. |
| `--licence <token>` | Pro licence token. Also read from `BLACKOUT_LICENCE`. |
| `--quiet` | Suppress the human-readable summary. |

Exit codes: `0` success, `1` failure, `2` usage error. With `--json`, failures
print `{"ok": false, "code": "...", "error": "..."}` on stdout.

## For agents

`--json` is stable and includes per-category counts, page count, and
`extractableChars` — which is verified to be `0` on every successful redaction.

```bash
npx @thrain/blackout check filing.pdf --json
```

```json
{
  "ok": true,
  "command": "check",
  "pages": 1,
  "total": 6,
  "byCategory": [{ "id": "ssn", "label": "Social Security numbers", "count": 1 }],
  "licensed": false,
  "freePageLimit": 10,
  "withinFreeLimit": true
}
```

There is also an MCP server — [`@thrain/blackout-mcp`](../blackout-mcp) — exposing
`redact_pdf` and `check_pdf` over the Model Context Protocol.

## Limits

Free up to 10 pages per document. A Pro licence ($25, one-time) removes the
limit; the same licence works in the browser app. Pass it with `--licence` or
set `BLACKOUT_LICENCE`.

## Also on the web

<https://blackout.thrain.ai> — the same engine, with a visual editor, FOIA and
privilege exemption codes, numbered markers and an appended redaction log.

---

Thrain LLC · support@thrain.ai
