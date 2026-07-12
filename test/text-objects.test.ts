import { describe, expect, it } from "vitest";
import {
  isEscapedDelimiter,
  normalizeDelimiterKey,
  resolveDelimitedTextObjectRange,
  resolveMatchingPairMotionTarget,
  resolveQuoteObjectRange,
  resolveWordTextObjectRange,
} from "../src/text-objects.js";

function currentLineBoundsFor(
  text: string,
  cursorAbs: number,
): {
  currentLineStartAbs: number;
  currentLineEndAbs: number;
} {
  const cursorForLine =
    cursorAbs > 0 && (cursorAbs >= text.length || text[cursorAbs] === "\n")
      ? cursorAbs - 1
      : cursorAbs;
  const currentLineStartAbs = text.lastIndexOf("\n", cursorForLine) + 1;
  const nextNewline = text.indexOf("\n", currentLineStartAbs);
  const currentLineEndAbs = nextNewline === -1 ? text.length : nextNewline;

  return { currentLineStartAbs, currentLineEndAbs };
}

function resolveMatchingPairAt(text: string, cursorAbs: number) {
  const bounds = currentLineBoundsFor(text, cursorAbs);
  return resolveMatchingPairMotionTarget(
    text,
    cursorAbs,
    bounds.currentLineStartAbs,
    bounds.currentLineEndAbs,
  );
}

describe("resolveWordTextObjectRange", () => {
  it("resolves an inner word on the current line", () => {
    expect(resolveWordTextObjectRange("foo bar", 0, 1, "i")).toEqual({
      startAbs: 0,
      endAbs: 3,
    });
  });

  it("prefers trailing whitespace for aw", () => {
    expect(resolveWordTextObjectRange("foo bar", 10, 1, "a")).toEqual({
      startAbs: 10,
      endAbs: 14,
    });
  });

  it("includes leading whitespace for aw when no trailing whitespace exists", () => {
    expect(resolveWordTextObjectRange("foo bar", 0, 5, "a")).toEqual({
      startAbs: 3,
      endAbs: 7,
    });
  });

  it("chooses the next word from whitespace, or the previous word when there is no next word", () => {
    expect(resolveWordTextObjectRange("foo   bar", 0, 3, "i")).toEqual({
      startAbs: 6,
      endAbs: 9,
    });
    expect(resolveWordTextObjectRange("foo   ", 0, 4, "i")).toEqual({
      startAbs: 0,
      endAbs: 3,
    });
  });

  it("includes intervening whitespace for counted inner word objects", () => {
    expect(resolveWordTextObjectRange("foo bar baz", 0, 1, "i", 2)).toEqual({
      startAbs: 0,
      endAbs: 7,
    });
  });

  it("uses contiguous non-whitespace runs for WORD semantics", () => {
    expect(
      resolveWordTextObjectRange("path/to-file", 0, 5, "i", 1, "WORD"),
    ).toEqual({
      startAbs: 0,
      endAbs: 12,
    });
  });

  it("does not cross newline boundaries", () => {
    expect(resolveWordTextObjectRange("foo\nbar", 0, 1, "i", 2)).toEqual({
      startAbs: 0,
      endAbs: 3,
    });
  });

  it("returns null for empty or whitespace-only lines", () => {
    expect(resolveWordTextObjectRange("", 0, 0, "i")).toBe(null);
    expect(resolveWordTextObjectRange("   ", 0, 1, "a")).toBe(null);
  });
});

describe("normalizeDelimiterKey", () => {
  it("normalizes quote delimiter keys", () => {
    expect(normalizeDelimiterKey('"')).toEqual({
      type: "quote",
      open: '"',
      close: '"',
    });
    expect(normalizeDelimiterKey("'")).toEqual({
      type: "quote",
      open: "'",
      close: "'",
    });
    expect(normalizeDelimiterKey("`")).toEqual({
      type: "quote",
      open: "`",
      close: "`",
    });
  });

  it("normalizes bracket delimiter aliases", () => {
    const cases = [
      { key: "(", open: "(", close: ")" },
      { key: ")", open: "(", close: ")" },
      { key: "b", open: "(", close: ")" },
      { key: "[", open: "[", close: "]" },
      { key: "]", open: "[", close: "]" },
      { key: "{", open: "{", close: "}" },
      { key: "}", open: "{", close: "}" },
      { key: "B", open: "{", close: "}" },
    ];

    for (const bracketCase of cases) {
      expect(normalizeDelimiterKey(bracketCase.key)).toEqual({
        type: "bracket",
        open: bracketCase.open,
        close: bracketCase.close,
      });
    }
  });

  it("returns null for unsupported delimiter keys", () => {
    expect(normalizeDelimiterKey("x")).toBe(null);
    expect(resolveDelimitedTextObjectRange("x", 0, "i", "x")).toBe(null);
  });
});

describe("resolveMatchingPairMotionTarget", () => {
  it("resolves opening and closing parentheses", () => {
    const text = "a(b)c";

    expect(resolveMatchingPairAt(text, 1)).toEqual({
      pair: "()",
      sourceAbs: 1,
      targetAbs: 3,
      rangeAnchorAbs: 1,
    });
    expect(resolveMatchingPairAt(text, 3)).toEqual({
      pair: "()",
      sourceAbs: 3,
      targetAbs: 1,
      rangeAnchorAbs: 3,
    });
  });

  it("resolves bracket and brace pairs", () => {
    expect(resolveMatchingPairAt("a[b]c", 1)).toEqual({
      pair: "[]",
      sourceAbs: 1,
      targetAbs: 3,
      rangeAnchorAbs: 1,
    });
    expect(resolveMatchingPairAt("a[b]c", 3)).toEqual({
      pair: "[]",
      sourceAbs: 3,
      targetAbs: 1,
      rangeAnchorAbs: 3,
    });
    expect(resolveMatchingPairAt("a{b}c", 1)).toEqual({
      pair: "{}",
      sourceAbs: 1,
      targetAbs: 3,
      rangeAnchorAbs: 1,
    });
    expect(resolveMatchingPairAt("a{b}c", 3)).toEqual({
      pair: "{}",
      sourceAbs: 3,
      targetAbs: 1,
      rangeAnchorAbs: 3,
    });
  });

  it("chooses partners for nested same-type pairs", () => {
    const text = "a(b(c)d)e";

    expect(resolveMatchingPairAt(text, 1)).toEqual({
      pair: "()",
      sourceAbs: 1,
      targetAbs: 7,
      rangeAnchorAbs: 1,
    });
    expect(resolveMatchingPairAt(text, 3)).toEqual({
      pair: "()",
      sourceAbs: 3,
      targetAbs: 5,
      rangeAnchorAbs: 3,
    });
    expect(resolveMatchingPairAt(text, 5)).toEqual({
      pair: "()",
      sourceAbs: 5,
      targetAbs: 3,
      rangeAnchorAbs: 5,
    });
    expect(resolveMatchingPairAt(text, 7)).toEqual({
      pair: "()",
      sourceAbs: 7,
      targetAbs: 1,
      rangeAnchorAbs: 7,
    });
  });

  it("resolves cross-line partners", () => {
    const text = "fn(\n  x\n)";

    expect(resolveMatchingPairAt(text, 2)).toEqual({
      pair: "()",
      sourceAbs: 2,
      targetAbs: 8,
      rangeAnchorAbs: 2,
    });
  });

  it("resolves a cross-line partner after line-local source selection", () => {
    const text = "call (\n  value\n)";

    expect(resolveMatchingPairAt(text, 0)).toEqual({
      pair: "()",
      sourceAbs: 5,
      targetAbs: 15,
      rangeAnchorAbs: 0,
    });
  });

  it("scans forward on the current logical line", () => {
    const text = "xx (a)";

    expect(resolveMatchingPairAt(text, 0)).toEqual({
      pair: "()",
      sourceAbs: 3,
      targetAbs: 5,
      rangeAnchorAbs: 0,
    });
  });

  it("does not scan forward across a newline", () => {
    const text = "abc\n(def)";

    expect(resolveMatchingPairAt(text, 0)).toBe(null);
  });

  it("returns null when no delimiter is on the current line", () => {
    expect(resolveMatchingPairAt("abc", 1)).toBe(null);
  });

  it("returns null for unmatched opening and closing delimiters", () => {
    expect(resolveMatchingPairAt("abc (", 4)).toBe(null);
    expect(resolveMatchingPairAt("abc )", 4)).toBe(null);
  });

  it("counts delimiters inside strings lexically", () => {
    const text = 'call("literal ) still counts", value)';
    const stringCloseParen = text.indexOf(")");

    expect(resolveMatchingPairAt(text, 4)).toEqual({
      pair: "()",
      sourceAbs: 4,
      targetAbs: stringCloseParen,
      rangeAnchorAbs: 4,
    });
  });

  it("counts delimiters inside comments lexically", () => {
    const text = "fn(/* ) comment */ value)";
    const commentCloseParen = text.indexOf(")");

    expect(resolveMatchingPairAt(text, 2)).toEqual({
      pair: "()",
      sourceAbs: 2,
      targetAbs: commentCloseParen,
      rangeAnchorAbs: 2,
    });
  });

  it("matches crossed mixed delimiters by same delimiter type", () => {
    const text = "([)]";

    expect(resolveMatchingPairAt(text, 0)).toEqual({
      pair: "()",
      sourceAbs: 0,
      targetAbs: 2,
      rangeAnchorAbs: 0,
    });
    expect(resolveMatchingPairAt(text, 1)).toEqual({
      pair: "[]",
      sourceAbs: 1,
      targetAbs: 3,
      rangeAnchorAbs: 1,
    });
  });

  it("normalizes visible EOL to a delimiter before resolving", () => {
    const text = "x(y)";

    expect(resolveMatchingPairAt(text, text.length)).toEqual({
      pair: "()",
      sourceAbs: 3,
      targetAbs: 1,
      rangeAnchorAbs: 3,
    });
  });

  it("returns null at visible EOL after a non-delimiter", () => {
    const text = "x(y) z";

    expect(resolveMatchingPairAt(text, text.length)).toBe(null);
  });

  it("returns null for empty buffer and empty logical line", () => {
    expect(resolveMatchingPairMotionTarget("", 0, 0, 0)).toBe(null);
    expect(resolveMatchingPairMotionTarget("\nabc", 0, 0, 0)).toBe(null);
  });

  it("resolves in a large buffer with many unmatched delimiters", () => {
    const unmatchedClosers = "}".repeat(2_000);
    const target = "{target}";
    const unmatchedOpeners = "{".repeat(4_000);
    const text = `${unmatchedClosers}${target}${unmatchedOpeners}`;
    const targetStartAbs = unmatchedClosers.length;

    expect(resolveMatchingPairAt(text, targetStartAbs)).toEqual({
      pair: "{}",
      sourceAbs: targetStartAbs,
      targetAbs: targetStartAbs + target.length - 1,
      rangeAnchorAbs: targetStartAbs,
    });
  });

  it("resolves in a deeply nested buffer with stack-depth storage", () => {
    const depth = 2_000;
    const text = `${"(".repeat(depth)}leaf${")".repeat(depth)}`;

    expect(resolveMatchingPairAt(text, 0)).toEqual({
      pair: "()",
      sourceAbs: 0,
      targetAbs: text.length - 1,
      rangeAnchorAbs: 0,
    });
  });
});

describe("resolveQuoteObjectRange", () => {
  const cases = [
    {
      name: "double quotes",
      text: 'say "hello" now',
      quote: '"',
      cursorAbs: 6,
      inner: { startAbs: 5, endAbs: 10 },
      around: { startAbs: 4, endAbs: 11 },
    },
    {
      name: "single quotes",
      text: "say 'hello' now",
      quote: "'",
      cursorAbs: 6,
      inner: { startAbs: 5, endAbs: 10 },
      around: { startAbs: 4, endAbs: 11 },
    },
    {
      name: "backticks",
      text: "run `build` now",
      quote: "`",
      cursorAbs: 6,
      inner: { startAbs: 5, endAbs: 10 },
      around: { startAbs: 4, endAbs: 11 },
    },
  ];

  for (const quoteCase of cases) {
    it(`resolves inside and around ${quoteCase.name}`, () => {
      expect(
        resolveQuoteObjectRange(
          quoteCase.text,
          quoteCase.cursorAbs,
          "i",
          quoteCase.quote,
        ),
      ).toEqual(quoteCase.inner);
      expect(
        resolveDelimitedTextObjectRange(
          quoteCase.text,
          quoteCase.cursorAbs,
          "a",
          quoteCase.quote,
        ),
      ).toEqual(quoteCase.around);
    });
  }

  it("counts the cursor on either quote delimiter as contained", () => {
    const text = 'say "hello" now';

    expect(resolveDelimitedTextObjectRange(text, 4, "i", '"')).toEqual({
      startAbs: 5,
      endAbs: 10,
    });
    expect(resolveDelimitedTextObjectRange(text, 10, "a", '"')).toEqual({
      startAbs: 4,
      endAbs: 11,
    });
  });

  it("ignores escaped quotes with an odd number of preceding backslashes", () => {
    const text = String.raw`\"skip\" "yes"`;

    expect(text[1]).toBe('"');
    expect(text[7]).toBe('"');
    expect(text[9]).toBe('"');
    expect(text[13]).toBe('"');
    expect(isEscapedDelimiter(text, 1)).toBe(true);
    expect(isEscapedDelimiter(text, 7)).toBe(true);
    expect(resolveDelimitedTextObjectRange(text, 10, "i", '"')).toEqual({
      startAbs: 10,
      endAbs: 13,
    });
  });

  it("keeps one, two, and three preceding backslashes distinct while resolving quotes", () => {
    const cases = [
      {
        name: "one preceding backslash",
        text: String.raw`a \"skip\" "yes"`,
        firstQuoteEscaped: true,
      },
      {
        name: "two preceding backslashes",
        text: String.raw`a \\"yes" z`,
        firstQuoteEscaped: false,
      },
      {
        name: "three preceding backslashes",
        text: String.raw`a \\\"skip\\\" "yes"`,
        firstQuoteEscaped: true,
      },
    ];

    for (const quoteCase of cases) {
      const firstQuote = quoteCase.text.indexOf('"');
      const startAbs = quoteCase.text.indexOf("yes");

      expect(firstQuote).not.toBe(-1);
      expect(startAbs).not.toBe(-1);
      expect(isEscapedDelimiter(quoteCase.text, firstQuote)).toBe(
        quoteCase.firstQuoteEscaped,
      );
      expect(
        resolveDelimitedTextObjectRange(quoteCase.text, startAbs, "i", '"'),
      ).toEqual({
        startAbs,
        endAbs: startAbs + "yes".length,
      });
    }
  });

  it("does not cross newline boundaries", () => {
    const text = '"one\n"two"';

    expect(resolveDelimitedTextObjectRange(text, 2, "i", '"')).toBe(null);
    expect(resolveDelimitedTextObjectRange(text, 6, "i", '"')).toEqual({
      startAbs: 6,
      endAbs: 9,
    });
  });

  it("returns an empty inner range for empty quotes", () => {
    const text = 'say "" now';

    expect(resolveDelimitedTextObjectRange(text, 4, "i", '"')).toEqual({
      startAbs: 5,
      endAbs: 5,
    });
    expect(resolveDelimitedTextObjectRange(text, 5, "a", '"')).toEqual({
      startAbs: 4,
      endAbs: 6,
    });
  });
});

describe("resolveBracketObjectRange", () => {
  it("resolves inside and around parentheses", () => {
    const text = "call(foo) now";

    expect(resolveDelimitedTextObjectRange(text, 6, "i", "(")).toEqual({
      startAbs: 5,
      endAbs: 8,
    });
    expect(resolveDelimitedTextObjectRange(text, 6, "a", "(")).toEqual({
      startAbs: 4,
      endAbs: 9,
    });
  });

  it("chooses the smallest nested containing pair", () => {
    const text = "a(b(c)d)e";

    expect(resolveDelimitedTextObjectRange(text, 4, "a", "(")).toEqual({
      startAbs: 3,
      endAbs: 6,
    });
  });

  it("resolves cross-line brace ranges", () => {
    const text = "fn {\n  x\n}";

    expect(resolveDelimitedTextObjectRange(text, 7, "i", "{")).toEqual({
      startAbs: 4,
      endAbs: 9,
    });
    expect(resolveDelimitedTextObjectRange(text, 7, "a", "{")).toEqual({
      startAbs: 3,
      endAbs: 10,
    });
  });

  it("counts the cursor on an opening or closing bracket as contained", () => {
    const text = "x(foo)";

    expect(resolveDelimitedTextObjectRange(text, 1, "i", "(")).toEqual({
      startAbs: 2,
      endAbs: 5,
    });
    expect(resolveDelimitedTextObjectRange(text, 5, "i", "(")).toEqual({
      startAbs: 2,
      endAbs: 5,
    });
  });

  it("resolves large buffers with many unmatched delimiters using stack-plus-best behavior", () => {
    const unmatchedClosers = "}".repeat(2_000);
    const unmatchedOpeners = "{".repeat(4_000);
    const target = "{outer {inner} tail}";
    const text = `${unmatchedClosers}${unmatchedOpeners}${target}${unmatchedOpeners}`;
    const targetStartAbs = unmatchedClosers.length + unmatchedOpeners.length;
    const innerPairStart = target.indexOf("{inner}");
    const cursorAbs = targetStartAbs + target.indexOf("inner");

    expect(resolveDelimitedTextObjectRange(text, cursorAbs, "a", "{")).toEqual({
      startAbs: targetStartAbs + innerPairStart,
      endAbs: targetStartAbs + innerPairStart + "{inner}".length,
    });
  });

  it("keeps mixed-bracket matching lexical for the selected delimiter type", () => {
    const text = "outer { [ value } still ]";
    const cursorAbs = text.indexOf("value");

    expect(resolveDelimitedTextObjectRange(text, cursorAbs, "a", "{")).toEqual({
      startAbs: text.indexOf("{"),
      endAbs: text.indexOf("}") + 1,
    });
    expect(resolveDelimitedTextObjectRange(text, cursorAbs, "a", "[")).toEqual({
      startAbs: text.indexOf("["),
      endAbs: text.indexOf("]") + 1,
    });
  });

  it("returns an empty inner range for empty brackets", () => {
    const text = "fn()";

    expect(resolveDelimitedTextObjectRange(text, 2, "i", "(")).toEqual({
      startAbs: 3,
      endAbs: 3,
    });
    expect(resolveDelimitedTextObjectRange(text, 3, "a", ")")).toEqual({
      startAbs: 2,
      endAbs: 4,
    });
  });

  it("returns null for unmatched brackets", () => {
    expect(resolveDelimitedTextObjectRange("call(foo", 5, "i", "(")).toBe(null);
    expect(resolveDelimitedTextObjectRange("call(foo)", 5, "i", "[")).toBe(
      null,
    );
  });
});
