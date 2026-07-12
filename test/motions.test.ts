/**
 * Unit tests for motions.ts — pure functions, no DOM/pi-tui dependency.
 */

import { describe, expect, it } from "vitest";
import {
  findCharMotionTarget,
  findFirstNonWhitespaceColumn,
  findNextParagraphStart,
  findParagraphMotionTarget,
  findPrevParagraphStart,
  findWordMotionTarget,
  isBlankLine,
  isParagraphStart,
} from "../src/motions.js";
import { WordBoundaryCache } from "../src/word-boundary-cache.js";

function makeGeneratedLineFixtures(count: number): string[] {
  let seed = 0x1badf00d;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };

  const words = ["alpha", "beta_2", "GAMMA", "z9", "m_n"];
  const punct = ["-", "--", "::", ".", ",", "!?", "#"];
  const spaces = [" ", "  ", "   ", "\t"];
  const fixtures = ["", "   ", "---", "a", "a   b", "foo--bar"];
  const pick = (values: readonly string[]): string =>
    values[next() % values.length] ?? "";

  for (let i = 0; i < count; i++) {
    const parts: string[] = [];
    const partCount = 1 + (next() % 6);

    for (let part = 0; part < partCount; part++) {
      const bucket = next() % 5;
      if (bucket <= 1) {
        parts.push(pick(words));
      } else if (bucket === 2) {
        parts.push(pick(punct));
      } else {
        parts.push(pick(spaces));
      }
    }

    fixtures.push(parts.join(""));
  }

  return fixtures;
}

// ---------------------------------------------------------------------------
// findWordMotionTarget
// ---------------------------------------------------------------------------

describe("findWordMotionTarget — forward/start (w)", () => {
  it("already at EOL returns line.length", () => {
    expect(findWordMotionTarget("foo", 3, "forward", "start")).toBe(3);
  });

  it("moves from start of keyword word to next word start", () => {
    // "foo bar", col=0 ('f') → skip 'foo', skip ' ', land on 'b' at 4
    expect(findWordMotionTarget("foo bar", 0, "forward", "start")).toBe(4);
  });

  it("jumps over punctuation to next word start", () => {
    // "foo-bar", col=3 ('-') → skip '-', land on 'b' at 4
    expect(findWordMotionTarget("foo-bar", 3, "forward", "start")).toBe(4);
  });

  it("skips multiple spaces to reach next word", () => {
    // "foo   bar", col=0 → skip 'foo', skip '   ', land on 'b' at 6
    expect(findWordMotionTarget("foo   bar", 0, "forward", "start")).toBe(6);
  });
});

describe("findWordMotionTarget — forward/end (e)", () => {
  it("trailing spaces: e returns line.length (past last word)", () => {
    // "foo   " len=6, col=3 (space) → skip spaces, hit EOL
    expect(findWordMotionTarget("foo   ", 3, "forward", "end")).toBe(6);
  });

  it("e from word interior reaches end of that word", () => {
    // "foobar", col=0 → end of word is index 5
    expect(findWordMotionTarget("foobar", 0, "forward", "end")).toBe(5);
  });

  it("e from end of one word jumps to end of next word", () => {
    // "foo bar", col=2 (last 'o') → next word end is 6 ('r')
    expect(findWordMotionTarget("foo bar", 2, "forward", "end")).toBe(6);
  });
});

describe("findWordMotionTarget — backward/start (b)", () => {
  it("b from start of word lands on start of previous word", () => {
    // "foo bar", col=4 ('b') → b lands on 'f' at 0
    expect(findWordMotionTarget("foo bar", 4, "backward", "start")).toBe(0);
  });

  it("b from middle of word lands on start of current word", () => {
    // "foo bar", col=5 ('a') → b lands on 'b' at 4
    expect(findWordMotionTarget("foo bar", 5, "backward", "start")).toBe(4);
  });

  it("b from col=0 stays at 0", () => {
    expect(findWordMotionTarget("foo", 0, "backward", "start")).toBe(0);
  });

  it("b skips trailing spaces before the previous word", () => {
    // "foo   bar", col=6 ('b') → b skips '   ', lands on 'f' at 0
    expect(findWordMotionTarget("foo   bar", 6, "backward", "start")).toBe(0);
  });
});

describe("findWordMotionTarget — WORD semantics", () => {
  it("treats punctuation-joined tokens as one WORD for W/E/B", () => {
    expect(
      findWordMotionTarget("foo-bar baz", 0, "forward", "start", "WORD"),
    ).toBe(8);
    expect(
      findWordMotionTarget("foo-bar baz", 0, "forward", "end", "WORD"),
    ).toBe(6);
    expect(
      findWordMotionTarget("foo-bar baz", 8, "backward", "start", "WORD"),
    ).toBe(0);
  });

  it("uses whitespace-only delimiting transitions", () => {
    expect(
      findWordMotionTarget("foo-bar   baz", 7, "forward", "start", "WORD"),
    ).toBe(10);
    expect(
      findWordMotionTarget("foo-bar   baz", 7, "forward", "end", "WORD"),
    ).toBe(12);
  });

  it("keeps empty-line behavior", () => {
    expect(findWordMotionTarget("", 0, "forward", "start", "WORD")).toBe(0);
    expect(findWordMotionTarget("", 0, "forward", "end", "WORD")).toBe(0);
    expect(findWordMotionTarget("", 0, "backward", "start", "WORD")).toBe(0);
  });
});

describe("WordBoundaryCache", () => {
  it("keys entries by exact line content", () => {
    const cache = new WordBoundaryCache();

    const first = cache.get("alpha beta");
    const second = cache.get("alpha beta");
    const third = cache.get("alpha  beta");

    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it("separates cache entries by semantic class", () => {
    const cache = new WordBoundaryCache();

    const word = cache.get("foo-bar baz", "word");
    const wordAgain = cache.get("foo-bar baz", "word");
    const WORD = cache.get("foo-bar baz", "WORD");
    const WORDAgain = cache.get("foo-bar baz", "WORD");

    expect(word).toBe(wordAgain);
    expect(WORD).toBe(WORDAgain);
    expect(word).not.toBe(WORD);
  });

  it("evicts oldest entries when cache size is exceeded", () => {
    const cache = new WordBoundaryCache(2);

    const first = cache.get("first");
    const second = cache.get("second");
    cache.get("third");

    // "second" survives right after first eviction.
    expect(cache.get("second")).toBe(second);

    // "first" should be evicted first (FIFO eviction).
    const firstReloaded = cache.get("first");
    expect(firstReloaded).not.toBe(first);
  });

  it("falls back to default capacity for invalid maxEntries", () => {
    const cache = new WordBoundaryCache(0);

    // Should not thrash every insertion: same key remains cached.
    const first = cache.get("stable");
    const second = cache.get("stable");

    expect(first).toBe(second);
  });

  it("returns precomputed targets equivalent to canonical line scanner", () => {
    const cache = new WordBoundaryCache();
    const line = "foo_bar -- baz";

    for (const semanticClass of ["word", "WORD"] as const) {
      expect(
        cache.tryFindTarget(line, 0, "forward", "start", semanticClass),
      ).toBe(findWordMotionTarget(line, 0, "forward", "start", semanticClass));
      expect(
        cache.tryFindTarget(line, 0, "forward", "end", semanticClass),
      ).toBe(findWordMotionTarget(line, 0, "forward", "end", semanticClass));
      expect(
        cache.tryFindTarget(line, 11, "backward", "start", semanticClass),
      ).toBe(
        findWordMotionTarget(line, 11, "backward", "start", semanticClass),
      );
    }
  });

  it("supports WORD semantics in cache lookups", () => {
    const cache = new WordBoundaryCache();
    const line = "foo-bar baz";

    expect(cache.tryFindTarget(line, 0, "forward", "start", "WORD")).toBe(8);
    expect(cache.tryFindTarget(line, 0, "forward", "end", "WORD")).toBe(6);
    expect(cache.tryFindTarget(line, 8, "backward", "start", "WORD")).toBe(0);
  });

  it("returns null for uncertain cursor inputs", () => {
    const cache = new WordBoundaryCache();

    expect(cache.tryFindTarget("abc", -1, "forward", "start")).toBe(null);
    expect(cache.tryFindTarget("abc", Number.NaN, "forward", "start")).toBe(
      null,
    );
  });
});

describe("WordBoundaryCache differential", () => {
  it("matches canonical targets on generated line fixtures", () => {
    const cache = new WordBoundaryCache();
    const fixtures = makeGeneratedLineFixtures(80);

    for (const line of fixtures) {
      for (let col = 0; col <= line.length; col++) {
        const cases: Array<
          [direction: "forward" | "backward", target: "start" | "end"]
        > = [
          ["forward", "start"],
          ["forward", "end"],
          ["backward", "start"],
        ];

        for (const [direction, target] of cases) {
          for (const semanticClass of ["word", "WORD"] as const) {
            const fast = cache.tryFindTarget(
              line,
              col,
              direction,
              target,
              semanticClass,
            );
            const canonical = findWordMotionTarget(
              line,
              col,
              direction,
              target,
              semanticClass,
            );

            expect(fast).toBe(canonical);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// First non-whitespace column
// ---------------------------------------------------------------------------

describe("findFirstNonWhitespaceColumn", () => {
  it("returns 0 for blank and all-whitespace lines", () => {
    expect(findFirstNonWhitespaceColumn("")).toBe(0);
    expect(findFirstNonWhitespaceColumn("   \t")).toBe(0);
  });

  it("finds the first non-whitespace column", () => {
    expect(findFirstNonWhitespaceColumn("    foo")).toBe(4);
    expect(findFirstNonWhitespaceColumn("\t  foo")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Paragraph scanner helpers
// ---------------------------------------------------------------------------

describe("paragraph scanner helpers", () => {
  const lines = [
    "alpha",
    "alpha tail",
    "",
    "   ",
    "beta",
    "beta tail",
    "",
    "gamma",
    "",
    "   ",
  ];

  it("detects blank lines using ^\\s*$ semantics", () => {
    expect(isBlankLine("")).toBe(true);
    expect(isBlankLine("   \t")).toBe(true);
    expect(isBlankLine("  x  ")).toBe(false);
  });

  it("detects paragraph starts: non-blank line at BOF or after blank", () => {
    expect(isParagraphStart(lines, 0)).toBe(true);
    expect(isParagraphStart(lines, 1)).toBe(false);
    expect(isParagraphStart(lines, 2)).toBe(false);
    expect(isParagraphStart(lines, 4)).toBe(true);
    expect(isParagraphStart(lines, 7)).toBe(true);
  });

  it("scans next paragraph start from non-blank and blank-run positions", () => {
    expect(findNextParagraphStart(lines, 0)).toBe(4);
    expect(findNextParagraphStart(lines, 1)).toBe(4);
    expect(findNextParagraphStart(lines, 2)).toBe(4);
    expect(findNextParagraphStart(lines, 3)).toBe(4);
  });

  it("scans previous paragraph start from non-blank and blank-run positions", () => {
    expect(findPrevParagraphStart(lines, 5)).toBe(4);
    expect(findPrevParagraphStart(lines, 4)).toBe(0);
    expect(findPrevParagraphStart(lines, 6)).toBe(4);
    expect(findPrevParagraphStart(lines, 8)).toBe(7);
  });

  it("clamps to EOF/BOF when no paragraph start exists in direction", () => {
    expect(findNextParagraphStart(lines, 7)).toBe(9);
    expect(findNextParagraphStart(lines, 9)).toBe(9);
    expect(findPrevParagraphStart(lines, 0)).toBe(0);

    const leadingBlankLines = ["", "  ", "alpha"];
    expect(findPrevParagraphStart(leadingBlankLines, 2)).toBe(0);
  });

  it("supports counted traversal and clamps after exhausting paragraph starts", () => {
    expect(findParagraphMotionTarget(lines, 0, "forward", 1)).toBe(4);
    expect(findParagraphMotionTarget(lines, 0, "forward", 2)).toBe(7);
    expect(findParagraphMotionTarget(lines, 0, "forward", 3)).toBe(9);

    expect(findParagraphMotionTarget(lines, 7, "backward", 1)).toBe(4);
    expect(findParagraphMotionTarget(lines, 7, "backward", 2)).toBe(0);
    expect(findParagraphMotionTarget(lines, 7, "backward", 3)).toBe(0);

    expect(findParagraphMotionTarget(lines, 3, "forward", 2)).toBe(7);
    expect(findParagraphMotionTarget(lines, 6, "backward", 2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findCharMotionTarget
// ---------------------------------------------------------------------------

describe("findCharMotionTarget — f (inclusive forward)", () => {
  it("f finds first occurrence after cursor", () => {
    // "abcabc", col=2 ('c') — f 'a' finds 'a' at index 3
    expect(findCharMotionTarget("abcabc", 2, "f", "a")).toBe(3);
  });

  it("f finds char immediately after cursor", () => {
    // "abc", col=0 — f 'b' finds 'b' at 1
    expect(findCharMotionTarget("abc", 0, "f", "b")).toBe(1);
  });

  it("f returns null when char not found forward", () => {
    expect(findCharMotionTarget("abc", 0, "f", "z")).toBe(null);
  });

  it("f does not match char at current col (searches col+1 onward)", () => {
    // cursor is on 'a' at col=0; f 'a' should find next 'a' at 3, not 0
    expect(findCharMotionTarget("abca", 0, "f", "a")).toBe(3);
  });
});

describe("findCharMotionTarget — t (exclusive forward / till)", () => {
  it("t lands one before target", () => {
    // "abcabc", col=0 — t 'c' finds 'c' at 2, stops at 1
    expect(findCharMotionTarget("abcabc", 0, "t", "c")).toBe(1);
  });

  it("t returns null when char not found", () => {
    expect(findCharMotionTarget("abc", 0, "t", "z")).toBe(null);
  });

  it("t with isRepeat=true skips one extra char (;-repeat semantics)", () => {
    // "aXbXc", last t 'X' stopped at col=1 (before X@2); repeat starts at col+2
    // isRepeat: searchStart = col+1+1 = col+2+1 = 3 → finds 'X' at 3, returns 2
    expect(findCharMotionTarget("aXbXc", 1, "t", "X", true)).toBe(2);
  });

  it("t isRepeat=false uses normal offset", () => {
    // without repeat, from col=1 searchStart=2, finds 'X' at 3, returns 2
    expect(findCharMotionTarget("aXbXc", 1, "t", "X", false)).toBe(2);
  });
});

describe("findCharMotionTarget — F (inclusive backward)", () => {
  it("F finds last occurrence before cursor", () => {
    // "abcabc", col=4 ('b') — F 'a' searches up to col-1=3 → finds 'a' at 3
    expect(findCharMotionTarget("abcabc", 4, "F", "a")).toBe(3);
  });

  it("F finds char immediately before cursor", () => {
    // "abc", col=2 — F 'b' finds 'b' at 1
    expect(findCharMotionTarget("abc", 2, "F", "b")).toBe(1);
  });

  it("F returns null when char not found backward", () => {
    expect(findCharMotionTarget("abc", 2, "F", "z")).toBe(null);
  });

  it("F does not match char at current col", () => {
    // col=3 on 'a'; F 'a' should find previous 'a' at 0, not 3
    expect(findCharMotionTarget("abca", 3, "F", "a")).toBe(0);
  });
});

describe("findCharMotionTarget — T (exclusive backward / till)", () => {
  it("T lands one after target", () => {
    // "abcabc", col=4 — T 'a' finds 'a' at 3, stops at 3+1=4 (same col, no move)
    expect(findCharMotionTarget("abcabc", 4, "T", "a")).toBe(4);
  });

  it("T finds char and steps one forward (exclusive)", () => {
    // "abcde", col=4 ('e') — T 'b' finds 'b' at 1, returns 1+1=2
    expect(findCharMotionTarget("abcde", 4, "T", "b")).toBe(2);
  });

  it("T returns null when char not found backward", () => {
    expect(findCharMotionTarget("abc", 2, "T", "z")).toBe(null);
  });

  it("T with isRepeat=true skips one extra char for ; semantics", () => {
    // "aXbXc", last T 'X' stopped at col=4 (after X@3); repeat searchStart = col-1-1
    // from col=4: searchStart=4-1-1=2 → lastIndexOf('X', 2): not found (X only at 1,3)
    // actually let's use "XbXa", col=3 ('a') — T 'X' repeat: searchStart=3-1-1=1
    // lastIndexOf('X',1) = 0, return 0+1 = 1
    expect(findCharMotionTarget("XbXa", 3, "T", "X", true)).toBe(1);
  });
});
