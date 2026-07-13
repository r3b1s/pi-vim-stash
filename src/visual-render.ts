/**
 * Visual mode selection highlight overlay.
 *
 * Mutates Pi's already-rendered editor lines in place, wrapping selected cells
 * in reverse-video ANSI. Re-derives Pi's line-wrapping layout (via a local
 * copy of Pi's wordWrapLine) so the overlay stays aligned with the actual text
 * rows regardless of padding, scroll offset, or word wrapping.
 *
 * Adapted from pi-vim-keys/src/editor/visual-highlight-renderer.ts.
 */

import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";

import type { EditorCoordinate } from "./visual.js";
import { isCellSelected, isLineSelected } from "./visual.js";

// ── ANSI helpers ──

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

const SELECTION_START = "\x1b[7m";
const ANSI_RESET = "\x1b[0m";

function styleSelection(text: string): string {
  return `${SELECTION_START}${text}${ANSI_RESET}`;
}

function renderCursorCell(cell: string, emitMarker: boolean): string {
  const marker = emitMarker ? CURSOR_MARKER : "";
  return `${marker}\x1b[7m${cell}\x1b[0m`;
}

// ── word wrap (local copy, parity with @earendil-works/pi-tui) ──

const PASTE_MARKER_SINGLE = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/;

function isWhitespaceChar(char: string): boolean {
  return /^\s$/u.test(char);
}

function isPasteMarker(segment: string): boolean {
  return segment.length >= 10 && PASTE_MARKER_SINGLE.test(segment);
}

/** local copy of Pi's wordWrapLine — kept in parity by a test */
export function wordWrapLine(
  line: string,
  maxWidth: number,
): Array<{ text: string; startIndex: number; endIndex: number }> {
  if (!line || maxWidth <= 0) {
    return [{ text: "", startIndex: 0, endIndex: 0 }];
  }

  if (visibleWidth(line) <= maxWidth) {
    return [{ text: line, startIndex: 0, endIndex: line.length }];
  }

  const segments = [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line),
  ];
  const chunks: Array<{ text: string; startIndex: number; endIndex: number }> =
    [];
  let currentWidth = 0;
  let chunkStart = 0;
  let wrapOppIndex = -1;
  let wrapOppWidth = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;

    const grapheme = seg.segment;
    const graphemeWidth = visibleWidth(grapheme);
    const charIndex = seg.index;
    const isWhitespace = !isPasteMarker(grapheme) && isWhitespaceChar(grapheme);

    if (currentWidth + graphemeWidth > maxWidth) {
      if (
        wrapOppIndex >= 0 &&
        currentWidth - wrapOppWidth + graphemeWidth <= maxWidth
      ) {
        chunks.push({
          text: line.slice(chunkStart, wrapOppIndex),
          startIndex: chunkStart,
          endIndex: wrapOppIndex,
        });
        chunkStart = wrapOppIndex;
        currentWidth -= wrapOppWidth;
      } else if (chunkStart < charIndex) {
        chunks.push({
          text: line.slice(chunkStart, charIndex),
          startIndex: chunkStart,
          endIndex: charIndex,
        });
        chunkStart = charIndex;
        currentWidth = 0;
      }

      wrapOppIndex = -1;
    }

    if (graphemeWidth > maxWidth) {
      const subChunks = wordWrapLine(grapheme, maxWidth);
      for (let j = 0; j < subChunks.length - 1; j++) {
        const sub = subChunks[j];
        if (!sub) continue;
        chunks.push({
          text: sub.text,
          startIndex: charIndex + sub.startIndex,
          endIndex: charIndex + sub.endIndex,
        });
      }
      const last = subChunks[subChunks.length - 1];
      if (!last) continue;
      chunkStart = charIndex + last.startIndex;
      currentWidth = visibleWidth(last.text);
      wrapOppIndex = -1;
      continue;
    }

    currentWidth += graphemeWidth;

    const next = segments[i + 1];
    if (
      isWhitespace &&
      next &&
      (isPasteMarker(next.segment) || !isWhitespaceChar(next.segment))
    ) {
      wrapOppIndex = next.index;
      wrapOppWidth = currentWidth;
    }
  }

  chunks.push({
    text: line.slice(chunkStart),
    startIndex: chunkStart,
    endIndex: line.length,
  });
  return chunks;
}

// ── layout types ──

type LayoutLine = {
  logicalLine: number;
  startCol: number;
  endCol: number;
  text: string;
  hasCursor: boolean;
  cursorPos?: number;
};

type Layout = {
  contentWidth: number;
  layoutWidth: number;
  paddingX: number;
};

// ── internal helpers ──

// ponytail: unsafe cast into Pi internals; fallbacks guard against drift.
type EditorInternals = {
  lastWidth?: number;
  scrollOffset?: number;
  focused?: boolean;
  segment?: (text: string, mode: "grapheme") => Iterable<Intl.SegmentData>;
};

type LayoutEditor = {
  getLines(): string[];
  getCursor(): { line: number; col: number };
  getPaddingX(): number;
};

function getInternals(editor: LayoutEditor): EditorInternals {
  return editor as unknown as EditorInternals;
}

function layoutFor(editor: LayoutEditor, width: number): Layout {
  const paddingX = Math.min(
    editor.getPaddingX(),
    Math.max(0, Math.floor((width - 1) / 2)),
  );
  const contentWidth = Math.max(1, width - paddingX * 2);
  const internals = getInternals(editor);
  const layoutWidth =
    typeof internals.lastWidth === "number" && internals.lastWidth > 0
      ? internals.lastWidth
      : Math.max(1, contentWidth - (paddingX ? 0 : 1));
  return { contentWidth, layoutWidth, paddingX };
}

function buildLayout(editor: LayoutEditor, contentWidth: number): LayoutLine[] {
  const lines = editor.getLines().length > 0 ? editor.getLines() : [""];
  const cursor = editor.getCursor();

  if (lines.length === 1 && lines[0] === "") {
    return [
      {
        logicalLine: 0,
        startCol: 0,
        endCol: 0,
        text: "",
        hasCursor: true,
        cursorPos: 0,
      },
    ];
  }

  const result: LayoutLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? "";
    const isCurrentLine = i === cursor.line;

    if (visibleWidth(lineText) <= contentWidth) {
      result.push({
        logicalLine: i,
        startCol: 0,
        endCol: lineText.length,
        text: lineText,
        hasCursor: isCurrentLine,
        cursorPos: isCurrentLine ? cursor.col : undefined,
      });
      continue;
    }

    const chunks = wordWrapLine(lineText, contentWidth);

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      if (!chunk) continue;

      const isLastChunk = ci === chunks.length - 1;
      let hasCursor = false;
      let cursorPos = 0;

      if (isCurrentLine) {
        if (isLastChunk) {
          hasCursor = cursor.col >= chunk.startIndex;
          cursorPos = cursor.col - chunk.startIndex;
        } else {
          hasCursor =
            cursor.col >= chunk.startIndex && cursor.col < chunk.endIndex;
          if (hasCursor) {
            cursorPos = Math.min(
              cursor.col - chunk.startIndex,
              chunk.text.length,
            );
          }
        }
      }

      result.push({
        logicalLine: i,
        startCol: chunk.startIndex,
        endCol: chunk.endIndex,
        text: chunk.text,
        hasCursor,
        cursorPos: hasCursor ? cursorPos : undefined,
      });
    }
  }

  return result;
}

function getVisibleTextRowCount(lines: string[]): number {
  for (let i = lines.length - 1; i >= 1; i--) {
    const plain = stripAnsi(lines[i] ?? "");
    if (plain.startsWith("─")) return i - 1;
  }
  return Math.max(0, lines.length - 1);
}

function getScrollOffset(editor: LayoutEditor, layoutRowCount: number): number {
  const internals = getInternals(editor);
  const raw =
    typeof internals.scrollOffset === "number" ? internals.scrollOffset : 0;
  return Math.max(
    0,
    Math.min(Math.floor(raw), Math.max(0, layoutRowCount - 1)),
  );
}

function usesHardwareCursor(editor: LayoutEditor): boolean {
  const tui = (
    editor as unknown as { tui?: { getShowHardwareCursor?: () => boolean } }
  ).tui;
  return tui?.getShowHardwareCursor?.() === true;
}

function isFocused(editor: LayoutEditor): boolean {
  return getInternals(editor).focused !== false;
}

// ── public entry ──

export type VisualHighlightInput = {
  editor: LayoutEditor;
  lines: string[];
  width: number;
  anchor: EditorCoordinate;
  cursor: EditorCoordinate;
  mode: "visual" | "visualLine";
  linesSnapshot: string[];
};

/**
 * Mutate `lines` (output of super.render) in place, painting the visual
 * selection with reverse-video ANSI on the text rows between the top and
 * bottom borders.
 */
export function renderVisualHighlight(input: VisualHighlightInput): void {
  const { editor, lines, width, anchor, cursor, mode, linesSnapshot } = input;
  const layout = layoutFor(editor, width);
  const layoutLines = buildLayout(editor, layout.contentWidth);
  const scrollOffset = getScrollOffset(editor, layoutLines.length);
  const visibleCount = getVisibleTextRowCount(lines);
  const visible = layoutLines.slice(scrollOffset, scrollOffset + visibleCount);
  const focused = isFocused(editor);
  const hardwareCursor = usesHardwareCursor(editor);

  for (let i = 0; i < visible.length; i++) {
    const ll = visible[i];
    if (!ll) continue;

    const renderedIdx = i + 1; // row 0 is top border
    if (renderedIdx >= lines.length) break;

    lines[renderedIdx] = renderLine(
      layout,
      ll,
      anchor,
      cursor,
      mode,
      linesSnapshot,
      focused,
      hardwareCursor,
    );
  }
}

function renderLine(
  layout: Layout,
  ll: LayoutLine,
  anchor: EditorCoordinate,
  cursor: EditorCoordinate,
  mode: "visual" | "visualLine",
  linesSnapshot: string[],
  focused: boolean,
  hardwareCursor: boolean,
): string {
  const leftPad = " ".repeat(layout.paddingX);
  const rightPad = " ".repeat(layout.paddingX);
  const emitMarker = focused;
  const marker = emitMarker ? CURSOR_MARKER : "";

  const cursorAtEnd =
    ll.hasCursor &&
    ll.cursorPos !== undefined &&
    ll.cursorPos >= ll.text.length;

  let displayWidth = 0;
  let result = "";

  // visualLine: highlight the entire visible row
  if (mode === "visualLine") {
    const isLine = isLineSelected(
      mode,
      linesSnapshot,
      anchor,
      cursor,
      ll.logicalLine,
    );

    if (isLine) {
      const full = ll.text.length > 0 ? ll.text : " ";
      const styled = styleSelection(full);

      if (ll.hasCursor && cursorAtEnd) {
        displayWidth = visibleWidth(full) + 1;
        result = styled + marker + (hardwareCursor ? " " : " \x1b[0m");
      } else if (ll.hasCursor && ll.cursorPos !== undefined) {
        // cursor within: embed marker before cursor cell
        const c = ll.text.length > 0 ? (ll.text[ll.cursorPos] ?? " ") : " ";
        const before = ll.text.slice(0, ll.cursorPos);
        const after = ll.text.slice(ll.cursorPos + 1);
        result =
          styleSelection(before) +
          marker +
          (hardwareCursor ? c : `\x1b[7m${c}\x1b[0m`) +
          styleSelection(after);
        displayWidth = visibleWidth(ll.text);
      } else {
        result = styled;
        displayWidth = visibleWidth(full);
      }
    } else {
      // not a selected line; render normally with cursor
      result = renderPlainWithCursor(ll, marker, hardwareCursor);
      displayWidth = visibleWidth(ll.text);

      if (ll.hasCursor && cursorAtEnd) {
        result += marker + (hardwareCursor ? " " : " \x1b[0m");
        displayWidth++;
      }
    }
  } else {
    // visual char: cell-by-cell selection rendering
    const cells = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        ll.text,
      ),
    ];
    for (const cell of cells) {
      const cellStart = ll.startCol + cell.index;
      const selected = isCellSelected(
        mode,
        linesSnapshot,
        anchor,
        cursor,
        ll.logicalLine,
        cellStart,
      );

      const isCursor =
        ll.hasCursor &&
        ll.cursorPos !== undefined &&
        cell.index === ll.cursorPos;

      if (isCursor) {
        result += renderCursorCell(cell.segment, !hardwareCursor);
      } else if (selected) {
        result += styleSelection(cell.segment);
      } else {
        result += cell.segment;
      }

      displayWidth += visibleWidth(cell.segment);
    }

    if (ll.hasCursor && cursorAtEnd) {
      result += marker + (hardwareCursor ? " " : " \x1b[0m");
      displayWidth++;
    }
  }

  const padding = " ".repeat(Math.max(0, layout.contentWidth - displayWidth));
  return `${leftPad}${result}${padding}${rightPad}`;
}

function renderPlainWithCursor(
  ll: LayoutLine,
  marker: string,
  hardwareCursor: boolean,
): string {
  if (!ll.hasCursor || ll.cursorPos === undefined) return ll.text;

  const before = ll.text.slice(0, ll.cursorPos);
  const cursorCell = ll.text[ll.cursorPos] ?? " ";
  const after = ll.text.slice(ll.cursorPos + 1);

  return (
    before +
    marker +
    (hardwareCursor ? cursorCell : `\x1b[7m${cursorCell}\x1b[0m`) +
    after
  );
}
