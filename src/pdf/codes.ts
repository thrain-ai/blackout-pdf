// Redaction exemption codes.
//
// Professional redaction doesn't just black text out — it states the legal
// basis for each withholding. FOIA releases cite the statutory exemption at
// the point of deletion; litigation redactions cite a privilege or a
// protective-order category (usually backed by a privilege log).
//
// Blackout marks each coded redaction with a small number on the bar and
// resolves those numbers on an appended log page, which is how dense releases
// stay readable when a code like "(b)(7)(C)" can't fit inside a one-line bar.

export interface RedactionCode {
  id: string;
  /** Shown in the log's CODE column and used as the code's short name. */
  label: string;
  /** The stated basis for withholding, printed beside the code. */
  basis: string;
}

export interface CodeSet {
  id: string;
  name: string;
  /** Printed under the log heading to identify the authority in use. */
  authority: string;
  codes: RedactionCode[];
  /** Detected-category id -> code id, applied when no code is pinned. */
  autoMap: Record<string, string>;
}

const FOIA: CodeSet = {
  id: "foia",
  name: "FOIA exemptions",
  authority: "Freedom of Information Act, 5 U.S.C. § 552(b)",
  codes: [
    { id: "b1", label: "(b)(1)", basis: "Classified national defense or foreign policy information" },
    { id: "b2", label: "(b)(2)", basis: "Internal personnel rules and practices" },
    { id: "b3", label: "(b)(3)", basis: "Information specifically exempted by other statute" },
    { id: "b4", label: "(b)(4)", basis: "Trade secrets; confidential commercial or financial information" },
    { id: "b5", label: "(b)(5)", basis: "Privileged inter-agency or intra-agency communications" },
    { id: "b6", label: "(b)(6)", basis: "Clearly unwarranted invasion of personal privacy" },
    { id: "b7a", label: "(b)(7)(A)", basis: "Law enforcement: interference with enforcement proceedings" },
    { id: "b7b", label: "(b)(7)(B)", basis: "Law enforcement: would deprive a person of a fair trial" },
    { id: "b7c", label: "(b)(7)(C)", basis: "Law enforcement: unwarranted invasion of personal privacy" },
    { id: "b7d", label: "(b)(7)(D)", basis: "Law enforcement: identity of a confidential source" },
    { id: "b7e", label: "(b)(7)(E)", basis: "Law enforcement: techniques, procedures and guidelines" },
    { id: "b7f", label: "(b)(7)(F)", basis: "Law enforcement: would endanger life or physical safety" },
    { id: "b8", label: "(b)(8)", basis: "Supervision of financial institutions" },
    { id: "b9", label: "(b)(9)", basis: "Geological and geophysical information concerning wells" },
  ],
  autoMap: {
    ssn: "b6",
    card: "b6",
    email: "b6",
    phone: "b6",
  },
};

const LITIGATION: CodeSet = {
  id: "litigation",
  name: "Litigation / privilege",
  authority: "Privilege and personal-identifier categories (cf. Fed. R. Civ. P. 5.2)",
  codes: [
    { id: "ac", label: "A-C PRIV", basis: "Attorney-client privileged communication" },
    { id: "wp", label: "WORK PROD", basis: "Attorney work product" },
    { id: "conf", label: "CONFID", basis: "Confidential under protective order" },
    { id: "pii", label: "PII", basis: "Personally identifiable information" },
    { id: "ssn", label: "SSN/TIN", basis: "Social Security or taxpayer identification number" },
    { id: "fin", label: "FIN ACCT", basis: "Financial account number" },
    { id: "dob", label: "DOB", basis: "Date of birth" },
    { id: "minor", label: "MINOR", basis: "Name of an individual known to be a minor" },
    { id: "phi", label: "PHI", basis: "Protected health information" },
    { id: "ts", label: "TRADE SEC", basis: "Trade secret or proprietary commercial information" },
  ],
  autoMap: {
    ssn: "ssn",
    card: "fin",
    email: "pii",
    phone: "pii",
  },
};

// Code ids are qualified with their set ("foia:b6") so a redaction keeps its
// code even if the operator switches sets mid-document.
function qualify(set: CodeSet): CodeSet {
  return {
    ...set,
    codes: set.codes.map((c) => ({ ...c, id: `${set.id}:${c.id}` })),
    autoMap: Object.fromEntries(
      Object.entries(set.autoMap).map(([k, v]) => [k, `${set.id}:${v}`]),
    ),
  };
}

export const CODE_SETS: CodeSet[] = [FOIA, LITIGATION].map(qualify);

export const DEFAULT_CODE_SET_ID = FOIA.id;

const REGISTRY = new Map<string, RedactionCode>(
  CODE_SETS.flatMap((s) => s.codes.map((c) => [c.id, c] as const)),
);

export function codeSetById(id: string): CodeSet {
  return CODE_SETS.find((s) => s.id === id) ?? CODE_SETS[0];
}

export function codeById(id: string | null | undefined): RedactionCode | null {
  return id ? REGISTRY.get(id) ?? null : null;
}

/**
 * The code a new redaction should carry: an explicitly pinned code wins;
 * otherwise the set's mapping for that detected category (manual boxes have
 * no category, so they stay uncoded until a code is pinned).
 */
export function resolveCode(
  set: CodeSet,
  pinnedCodeId: string | null,
  categoryId?: string,
): RedactionCode | null {
  if (pinnedCodeId) return codeById(pinnedCodeId);
  if (categoryId && set.autoMap[categoryId]) {
    return codeById(set.autoMap[categoryId]);
  }
  return null;
}
