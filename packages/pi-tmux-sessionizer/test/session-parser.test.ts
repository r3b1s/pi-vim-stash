import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analyzeSession,
  analyzeSessionFile,
  parseSessionFile,
} from "#src/session-parser";

let tempDir = "";
let filePath = "";

function createTempFile(content: string): string {
  tempDir = mkdtempSync(join(tmpdir(), "pts-test-"));
  filePath = join(tempDir, "session.jsonl");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function cleanup(): void {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("parseSessionFile", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it("parses valid JSONL entries", () => {
    createTempFile(
      [
        '{"role":"user","content":[{"type":"text","text":"hello"}],"timestamp":1000}',
        '{"role":"assistant","content":[{"type":"text","text":"hi there"}],"timestamp":2000}',
      ].join("\n"),
    );

    const entries = parseSessionFile(filePath);
    expect(entries.length).toBe(2);
    expect(entries[0].data.role).toBe("user");
    expect(entries[1].data.role).toBe("assistant");
  });

  it("skips empty lines and malformed JSON", () => {
    createTempFile(
      [
        '{"role":"user","content":[]}',
        "",
        "not valid json",
        '{"role":"assistant","content":[]}',
      ].join("\n"),
    );

    const entries = parseSessionFile(filePath);
    expect(entries.length).toBe(2);
  });

  it("throws on missing file", () => {
    expect(() => parseSessionFile("/nonexistent/file.jsonl")).toThrow();
  });
});

describe("analyzeSession", () => {
  it("detects completion when user message followed by assistant text", () => {
    const entries = [
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "response" }],
          timestamp: 2000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("response");
  });

  it("returns completed=false when only user messages exist", () => {
    const entries = [
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(false);
    expect(analysis.result).toBeUndefined();
  });

  it("returns completed=false with empty entries", () => {
    const analysis = analyzeSession([]);
    expect(analysis.completed).toBe(false);
  });

  it("extracts text from mixed content blocks", () => {
    const entries = [
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "do something" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [
            { type: "text", text: "Let me work on that" },
            { type: "tool_use", name: "bash", input: "ls" },
          ],
          timestamp: 2000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("Let me work on that");
  });

  it("returns completed=false for assistant with only tool_use blocks (no text)", () => {
    const entries = [
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "do something" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [{ type: "tool_use", name: "bash", input: "ls" }],
          timestamp: 2000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(false);
    expect(analysis.result).toBeUndefined();
  });

  it("returns completed=false when assistant text precedes all user messages", () => {
    const entries = [
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "do something" }],
          timestamp: 2000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(false);
    expect(analysis.result).toBeUndefined();
  });

  it("returns completed=true when assistant text follows user message", () => {
    const entries = [
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "stale response" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "real question" }],
          timestamp: 2000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "real answer" }],
          timestamp: 3000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("real answer");
  });

  it("returns completed=false when user message has no timestamp and assistant text has no timestamp but is first entry", () => {
    // Edge case: no timestamps — assistant text entry that appears before
    // any user entry in the array should not count as completed.
    const entries = [
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "pre-response" }],
        },
        raw: "",
      },
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "question" }],
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    // Assistant text was first — no user message preceded it
    expect(analysis.completed).toBe(false);
  });

  it("concatenates multiple text blocks", () => {
    const entries = [
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "task" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" },
          ],
          timestamp: 2000,
        },
        raw: "",
      },
    ];

    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("First part\nSecond part");
  });
});

describe("analyzeSessionFile", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it("parses and analyzes a real JSONL file", () => {
    createTempFile(
      [
        '{"role":"user","content":[{"type":"text","text":"hello"}],"timestamp":1000}',
        '{"role":"assistant","content":[{"type":"text","text":"world"}],"timestamp":2000}',
      ].join("\n"),
    );

    const analysis = analyzeSessionFile(filePath);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("world");
    expect(analysis.entryCount).toBe(2);
  });
});
