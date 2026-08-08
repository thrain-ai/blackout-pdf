export interface PatternDef {
  id: string;
  label: string;
  regex: RegExp;
}

// Order matters: earlier patterns claim their text first, so more specific
// formats (SSN) must precede looser ones (phone numbers).
export const PATTERNS: PatternDef[] = [
  {
    id: "ssn",
    label: "Social Security numbers",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    id: "card",
    label: "Card numbers",
    regex: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b|\b\d{16}\b/g,
  },
  {
    id: "email",
    label: "Email addresses",
    // Bounded quantifiers and a dot-free label class (each label is separated
    // by a literal ".") keep matching strictly linear, so detection stays fast
    // on any input, including long adversarial runs from an untrusted PDF.
    regex: /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24}/g,
  },
  {
    id: "phone",
    label: "Phone numbers",
    regex:
      /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}\b/g,
  },
];

export const CUSTOM_PATTERN_ID = "custom";

export function customTermRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, "gi");
}
