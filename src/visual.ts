/**
 * Pure range helpers for visual mode selection math.
 *
 * Ported from pi-vimmode/src/visual-selection.ts — zero-dependency, pure
 * functions that normalize anchor↔cursor positions into ranges and answer
 * cell-by-cell "is this selected?" queries.
 */

import type { Mode } from "./types.js";

export type EditorCoordinate = {
  line: number;
  col: number;
};

export type TextRange = {
  start: EditorCoordinate;
  end: EditorCoordinate;
};

function splitText(text: string): string[] {
  const lines = text.split("\n");
  return lines.length === 0 ? [""] : lines;
}

export function clampPosition(
  lines: string[],
  position: EditorCoordinate,
): EditorCoordinate {
  const safeLines = lines.length === 0 ? [""] : lines;
  const line = Math.max(0, Math.min(position.line, safeLines.length - 1));
  return {
    line,
    col: Math.max(0, Math.min(position.col, (safeLines[line] ?? "").length)),
  };
}

export function comparePositions(
  a: EditorCoordinate,
  b: EditorCoordinate,
): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}

export function normalizeRange(
  lines: string[],
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
): TextRange {
  const a = clampPosition(lines, anchor);
  const b = clampPosition(lines, cursor);
  return comparePositions(a, b) <= 0
    ? { start: a, end: b }
    : { start: b, end: a };
}

export function normalizeLineRange(
  lines: string[],
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
): { startLine: number; endLine: number } {
  const a = clampPosition(lines, anchor);
  const b = clampPosition(lines, cursor);
  return {
    startLine: Math.min(a.line, b.line),
    endLine: Math.max(a.line, b.line),
  };
}

export function isCellSelected(
  mode: Mode,
  lines: string[],
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
  lineIndex: number,
  col: number,
): boolean {
  if (mode === "visualLine") {
    return isLineSelected(mode, lines, anchor, cursor, lineIndex);
  }

  const range = normalizeRange(lines, anchor, cursor);
  const pos = { line: lineIndex, col };
  return (
    comparePositions(pos, range.start) >= 0 &&
    comparePositions(pos, range.end) <= 0
  );
}

export function isLineSelected(
  _mode: Mode,
  lines: string[],
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
  lineIndex: number,
): boolean {
  if (_mode !== "visualLine") return false;
  const range = normalizeLineRange(lines, anchor, cursor);
  return lineIndex >= range.startLine && lineIndex <= range.endLine;
}

export function selectionText(
  text: string,
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
): string {
  const lines = splitText(text);
  const range = normalizeRange(lines, anchor, cursor);
  const { start, end } = range;

  if (start.line === end.line) {
    const line = lines[start.line] ?? "";
    return line.slice(start.col, end.col + 1);
  }

  const selected: string[] = [];
  selected.push((lines[start.line] ?? "").slice(start.col));

  for (let i = start.line + 1; i < end.line; i++) {
    selected.push(lines[i] ?? "");
  }

  const lastLine = lines[end.line] ?? "";
  selected.push(lastLine.slice(0, end.col + 1));
  return selected.join("\n");
}

export function linewiseSelectionText(
  text: string,
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
): string {
  const lines = splitText(text);
  const range = normalizeLineRange(lines, anchor, cursor);
  return lines.slice(range.startLine, range.endLine + 1).join("\n");
}
