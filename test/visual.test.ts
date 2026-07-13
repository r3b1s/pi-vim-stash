import { describe, expect, it } from "vitest";
import type { EditorCoordinate } from "../src/visual.js";
import {
  clampPosition,
  comparePositions,
  isCellSelected,
  isLineSelected,
  linewiseSelectionText,
  normalizeLineRange,
  normalizeRange,
  selectionText,
} from "../src/visual.js";

const pos = (line: number, col: number): EditorCoordinate => ({ line, col });

describe("clampPosition", () => {
  it("clamps within buffer bounds", () => {
    const lines = ["abc", "de", "fgh"];
    expect(clampPosition(lines, pos(0, 1))).toEqual(pos(0, 1));
    expect(clampPosition(lines, pos(0, 5))).toEqual(pos(0, 3));
    expect(clampPosition(lines, pos(5, 0))).toEqual(pos(2, 0));
    expect(clampPosition(lines, pos(-1, 0))).toEqual(pos(0, 0));
  });

  it("handles empty buffer", () => {
    const lines: string[] = [""];
    expect(clampPosition(lines, pos(0, 5))).toEqual(pos(0, 0));
  });
});

describe("comparePositions", () => {
  it("orders by line then col", () => {
    expect(comparePositions(pos(0, 0), pos(0, 1))).toBeLessThan(0);
    expect(comparePositions(pos(1, 0), pos(0, 99))).toBeGreaterThan(0);
    expect(comparePositions(pos(1, 5), pos(1, 5))).toBe(0);
  });
});

describe("normalizeRange", () => {
  const lines = ["hello world", "foo"];

  it("returns ordered start/end regardless of anchor/cursor order", () => {
    const r1 = normalizeRange(lines, pos(0, 6), pos(0, 4));
    expect(r1.start).toEqual(pos(0, 4));
    expect(r1.end).toEqual(pos(0, 6));

    const r2 = normalizeRange(lines, pos(0, 4), pos(0, 6));
    expect(r2.start).toEqual(pos(0, 4));
    expect(r2.end).toEqual(pos(0, 6));
  });

  it("cross-line range", () => {
    const r = normalizeRange(lines, pos(1, 0), pos(0, 8));
    expect(r.start).toEqual(pos(0, 8));
    expect(r.end).toEqual(pos(1, 0));
  });

  it("clamps out-of-bounds positions", () => {
    const r = normalizeRange(lines, pos(0, 999), pos(999, 0));
    expect(r.start).toEqual(pos(0, 11));
    expect(r.end).toEqual(pos(1, 0));
  });
});

describe("normalizeLineRange", () => {
  it("orders lines", () => {
    const lines = ["a", "b", "c"];
    const r = normalizeLineRange(lines, pos(2, 0), pos(0, 0));
    expect(r.startLine).toBe(0);
    expect(r.endLine).toBe(2);
  });
});

describe("isCellSelected", () => {
  const lines = ["abc", "de"];

  it("char selection — single line", () => {
    const anchor = pos(0, 1); // "b"
    const cursor = pos(0, 2); // "c"
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 0)).toBe(false);
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 1)).toBe(true);
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 2)).toBe(true);
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 3)).toBe(false);
  });

  it("char selection — cross-line", () => {
    const anchor = pos(0, 1); // "b" in line 0
    const cursor = pos(1, 1); // "e" in line 1
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 0)).toBe(false);
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 1)).toBe(true);
    expect(isCellSelected("visual", lines, anchor, cursor, 0, 3)).toBe(true);
    expect(isCellSelected("visual", lines, anchor, cursor, 1, 0)).toBe(true);
    expect(isCellSelected("visual", lines, anchor, cursor, 1, 1)).toBe(true);
    expect(isCellSelected("visual", lines, anchor, cursor, 1, 2)).toBe(false);
  });

  it("line selection — entire lines only", () => {
    const anchor = pos(0, 0);
    const cursor = pos(1, 0);
    expect(isCellSelected("visualLine", lines, anchor, cursor, 0, 0)).toBe(
      true,
    );
    expect(isCellSelected("visualLine", lines, anchor, cursor, 0, 99)).toBe(
      true,
    );
    expect(isCellSelected("visualLine", lines, anchor, cursor, 1, 0)).toBe(
      true,
    );
    expect(isCellSelected("visualLine", lines, anchor, cursor, 2, 0)).toBe(
      false,
    );
  });
});

describe("isLineSelected", () => {
  const lines = ["a", "b", "c"];

  it("returns true for lines within visualLine range", () => {
    expect(isLineSelected("visualLine", lines, pos(0, 0), pos(1, 0), 0)).toBe(
      true,
    );
    expect(isLineSelected("visualLine", lines, pos(0, 0), pos(1, 0), 1)).toBe(
      true,
    );
    expect(isLineSelected("visualLine", lines, pos(0, 0), pos(1, 0), 2)).toBe(
      false,
    );
  });

  it("returns false for non-visualLine mode", () => {
    expect(isLineSelected("visual", lines, pos(0, 0), pos(1, 0), 0)).toBe(
      false,
    );
    expect(isLineSelected("insert", lines, pos(0, 0), pos(1, 0), 0)).toBe(
      false,
    );
  });
});

describe("selectionText", () => {
  const text = "hello\nworld\nfoo";

  it("single-line char selection (inclusive)", () => {
    const result = selectionText(text, pos(0, 1), pos(0, 4));
    expect(result).toBe("ello");
  });

  it("cross-line selection", () => {
    const result = selectionText(text, pos(0, 2), pos(1, 3));
    expect(result).toBe("llo\nworl");
  });
});

describe("linewiseSelectionText", () => {
  const text = "a\nb\nc\nd";

  it("selects full lines", () => {
    const result = linewiseSelectionText(text, pos(1, 0), pos(2, 0));
    expect(result).toBe("b\nc");
  });
});
