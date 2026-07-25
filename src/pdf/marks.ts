import type { Rect } from "./types.ts";
import type { RedactionCode } from "./codes.ts";

export interface RedactionMark {
  id: string;
  pageIndex: number;
  rect: Rect;
  code: RedactionCode | null;
  /** 1-based number printed on the bar; null for uncoded redactions. */
  marker: number | null;
}

export interface MarkInput {
  id: string;
  pageIndex: number;
  rect: Rect;
  code: RedactionCode | null;
}

const LINE_BAND = 5; // px of vertical slop that still counts as the same line

/**
 * Orders redactions in reading order (page, then line, then left-to-right) and
 * numbers the coded ones sequentially. Both the editor overlay and the
 * exporter/log page consume this, so the number on a bar always matches the
 * number in the log.
 */
export function orderAndNumber(inputs: MarkInput[]): RedactionMark[] {
  const sorted = [...inputs].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
    const bandA = Math.round(a.rect.y / LINE_BAND);
    const bandB = Math.round(b.rect.y / LINE_BAND);
    if (bandA !== bandB) return bandA - bandB;
    return a.rect.x - b.rect.x;
  });

  let n = 0;
  return sorted.map((m) => ({ ...m, marker: m.code ? ++n : null }));
}
