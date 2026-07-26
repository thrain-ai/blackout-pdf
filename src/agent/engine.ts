// The Node-side API behind both the CLI and the MCP server.
//
// It adds no redaction logic of its own. Detection is src/pdf/textSearch.ts,
// ordering is src/pdf/marks.ts, and the burn-and-rebuild is
// src/pdf/exporter.ts — the same modules the website runs. This file only
// arranges them for a non-interactive caller and enforces the license
// boundary, which the browser UI enforces in its own way.
import { installNodePlatform } from "../platform/node.ts";
import { loadPdf } from "../pdf/loader.ts";
import { findSuggestions } from "../pdf/textSearch.ts";
import { exportRedacted } from "../pdf/exporter.ts";
import { orderAndNumber, type MarkInput } from "../pdf/marks.ts";
import { PATTERNS, CUSTOM_PATTERN_ID } from "../pdf/patterns.ts";
import type { Suggestion } from "../pdf/types.ts";
import { verifyToken } from "../licenseVerify.ts";
import { FREE_PAGE_LIMIT } from "../config.ts";

installNodePlatform();

export const CATEGORY_IDS = PATTERNS.map((p) => p.id);
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PATTERNS.map((p) => [p.id, p.label]),
);
export { FREE_PAGE_LIMIT };

export interface ScanOptions {
  /** Pattern ids to keep (subset of CATEGORY_IDS). Empty means no patterns. */
  detect?: string[];
  /** Literal strings to redact wherever they appear, case-insensitive. */
  terms?: string[];
  /** Signed license token; lifts the free page limit when valid. */
  license?: string | null;
}

export interface CategoryCount {
  id: string;
  label: string;
  count: number;
}

export interface ScanResult {
  pages: number;
  total: number;
  byCategory: CategoryCount[];
  /** Per-page counts, index 0 = page 1. */
  perPage: number[];
  licensed: boolean;
  freePageLimit: number;
  withinFreeLimit: boolean;
}

export class BlackoutError extends Error {
  // Declared and assigned rather than a constructor parameter property, so the
  // source runs as-is under Node's type stripping — handy for iterating without
  // a build step.
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "BlackoutError";
    this.code = code;
  }
}

/**
 * A license is valid or it is not; there is no degraded middle state. The
 * check is a local signature verification against the embedded public key —
 * it makes no network call, so a redaction still works with the machine
 * offline. That is deliberate and should stay that way.
 */
export async function checkLicense(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  return (await verifyToken(token.trim())).valid;
}

export function resolveLicense(explicit?: string | null): string | null {
  // BLACKOUT_LICENSE is the documented name; BLACKOUT_LICENCE is kept because
  // it shipped first and someone's shell profile still has it.
  return explicit ?? process.env.BLACKOUT_LICENSE ?? process.env.BLACKOUT_LICENCE ?? null;
}

function normaliseDetect(detect: string[] | undefined, hasTerms: boolean): string[] {
  if (detect === undefined) {
    // No --detect given: scan for everything, unless the caller asked only for
    // specific terms — in that case redacting extra content they did not ask
    // about would be a surprise, and over-redaction is still damage.
    return hasTerms ? [] : [...CATEGORY_IDS];
  }
  const unknown = detect.filter((d) => !CATEGORY_IDS.includes(d));
  if (unknown.length) {
    throw new BlackoutError(
      `Unknown detector${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Valid: ${CATEGORY_IDS.join(", ")}`,
      "BAD_DETECTOR",
    );
  }
  return detect;
}

async function collect(
  bytes: Uint8Array,
  opts: ScanOptions,
): Promise<{ pages: number; suggestions: Suggestion[]; wanted: Set<string> }> {
  const terms = (opts.terms ?? []).filter((t) => t.trim().length >= 2);
  const detect = normaliseDetect(opts.detect, terms.length > 0);
  const wanted = new Set([...detect, ...(terms.length ? [CUSTOM_PATTERN_ID] : [])]);

  // Copy: pdf.js may detach the buffer it is handed.
  const doc = await loadPdf(new Uint8Array(bytes));
  try {
    const suggestions: Suggestion[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const found = await findSuggestions(page, i, terms);
      // findSuggestions always runs the full pattern set so that the more
      // specific patterns claim their characters first (an SSN before a phone
      // number). Filtering afterwards preserves that precedence; narrowing the
      // pattern list up front would not.
      suggestions.push(...found.filter((s) => wanted.has(s.categoryId)));
    }
    return { pages: doc.numPages, suggestions, wanted };
  } finally {
    await doc.destroy();
  }
}

function summarise(
  pages: number,
  suggestions: Suggestion[],
  wanted: Set<string>,
  licensed: boolean,
): ScanResult {
  const counts = new Map<string, number>();
  const perPage = new Array<number>(pages).fill(0);
  for (const s of suggestions) {
    counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1);
    perPage[s.pageIndex]++;
  }
  const ids = [...CATEGORY_IDS, CUSTOM_PATTERN_ID].filter((id) => wanted.has(id));
  return {
    pages,
    total: suggestions.length,
    byCategory: ids.map((id) => ({
      id,
      label: id === CUSTOM_PATTERN_ID ? "Custom terms" : CATEGORY_LABELS[id],
      count: counts.get(id) ?? 0,
    })),
    perPage,
    licensed,
    freePageLimit: FREE_PAGE_LIMIT,
    withinFreeLimit: pages <= FREE_PAGE_LIMIT,
  };
}

/** What would be redacted, without producing a file. */
export async function scan(bytes: Uint8Array, opts: ScanOptions = {}): Promise<ScanResult> {
  const licensed = await checkLicense(resolveLicense(opts.license));
  const { pages, suggestions, wanted } = await collect(bytes, opts);
  return summarise(pages, suggestions, wanted, licensed);
}

export interface RedactResult {
  pdf: Uint8Array;
  scan: ScanResult;
  /** Characters of text still extractable from the output. Must be 0. */
  extractableChars: number;
}

/**
 * Rasterises every page, burns the bars in, and rebuilds the file — then reads
 * its own output back and counts what text remains. The whole product is the
 * claim that the answer is zero, so it is measured rather than asserted; an
 * agent gets a verified result, not a promise.
 */
export async function redact(
  bytes: Uint8Array,
  opts: ScanOptions = {},
): Promise<RedactResult> {
  const licensed = await checkLicense(resolveLicense(opts.license));
  const { pages, suggestions, wanted } = await collect(bytes, opts);

  if (!licensed && pages > FREE_PAGE_LIMIT) {
    throw new BlackoutError(
      `This document has ${pages} pages; the free limit is ${FREE_PAGE_LIMIT}. ` +
        `Supply a Pro license via --license or BLACKOUT_LICENSE to redact it.`,
      "PAGE_LIMIT",
    );
  }

  const marks = orderAndNumber(
    suggestions.map(
      (s): MarkInput => ({
        id: s.id,
        pageIndex: s.pageIndex,
        rect: s.rect,
        // Exemption codes are assigned per-mark in the editor; a
        // non-interactive run has no basis on which to pick one, so output
        // carries no coded markers and no log page.
        code: null,
      }),
    ),
  );

  const doc = await loadPdf(new Uint8Array(bytes));
  let pdf: Uint8Array;
  try {
    pdf = await exportRedacted(doc, marks);
  } finally {
    await doc.destroy();
  }

  return {
    pdf,
    scan: summarise(pages, suggestions, wanted, licensed),
    extractableChars: await extractableTextLength(pdf),
  };
}

/** Total non-whitespace text pdf.js can still pull out of a document. */
export async function extractableTextLength(bytes: Uint8Array): Promise<number> {
  const doc = await loadPdf(new Uint8Array(bytes));
  try {
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join("");
    }
    return text.trim().length;
  } finally {
    await doc.destroy();
  }
}
