# @thrain/blackout-mcp

An MCP server that permanently removes text from PDFs.

Ask a model to "redact the SSNs out of this PDF" and it will usually write a
PyMuPDF or pikepdf script that draws a black rectangle over the text. The
rectangle is an overlay; the characters stay in the content stream underneath,
recoverable by any text extractor. The document looks redacted and is not. That
is how redaction failures leak.

This server does it correctly: it rasterises each page, burns the bars into the
pixels, and rebuilds the file from the images, so the text layer is gone. It
then reads its own output back and verifies that zero characters remain
extractable — and returns an error rather than a file if that check fails.

It runs entirely on the local machine. Nothing is uploaded, and there is no
network call anywhere in the path — which makes "the document never leaves your
device" literally true, in a way no hosted redaction API can claim. For an agent
handling a file full of Social Security numbers, that is the whole argument.

## Install

```json
{
  "mcpServers": {
    "blackout": {
      "command": "npx",
      "args": ["-y", "@thrain/blackout-mcp"]
    }
  }
}
```

For unlimited page counts, add your licence:

```json
{
  "mcpServers": {
    "blackout": {
      "command": "npx",
      "args": ["-y", "@thrain/blackout-mcp"],
      "env": { "BLACKOUT_LICENCE": "<token>" }
    }
  }
}
```

## Tools

### `check_pdf`

Read-only. Reports what would be redacted without writing anything.

| Argument | Type | Notes |
|---|---|---|
| `path` | string | Absolute path to a PDF on this machine |
| `detect` | string[] | `ssn`, `card`, `email`, `phone`. Omit for all |
| `terms` | string[] | Literal strings to match, case-insensitive |

### `redact_pdf`

Writes a redacted copy. Never modifies the input.

| Argument | Type | Notes |
|---|---|---|
| `path` | string | Absolute path to a PDF on this machine |
| `output_path` | string | Defaults to `<input>-redacted.pdf`; must not be the input |
| `detect` | string[] | `ssn`, `card`, `email`, `phone`. Omit for all |
| `terms` | string[] | Literal strings to match, case-insensitive |
| `overwrite` | boolean | Allow replacing an existing output. Default `false` |
| `licence` | string | Pro licence token; falls back to `BLACKOUT_LICENCE` |

Both return a human-readable summary followed by a JSON block with per-category
counts, page count, and `extractableChars` — `0` on every successful redaction.

## Limits

Free up to 10 pages per document. A Pro licence ($25, one-time) removes the
limit and is the same licence the browser app uses.

## See also

- [`@thrain/blackout`](../blackout) — the same engine as a CLI
- <https://blackout.thrain.ai> — the browser app, with exemption codes and a
  redaction log

---

Thrain LLC · support@thrain.ai
