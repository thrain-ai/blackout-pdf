export interface Rect {
  // Coordinates in CSS pixels at pdf.js viewport scale 1, origin top-left.
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Suggestion {
  id: string;
  pageIndex: number;
  rect: Rect;
  categoryId: string;
  text: string;
  accepted: boolean;
  /** Exemption code id assigned when redacted (Pro); null = uncoded. */
  codeId?: string | null;
}

export interface ManualBox {
  id: string;
  pageIndex: number;
  rect: Rect;
  codeId?: string | null;
}

export interface PageInfo {
  index: number;
  // Viewport size at scale 1.
  width: number;
  height: number;
}
