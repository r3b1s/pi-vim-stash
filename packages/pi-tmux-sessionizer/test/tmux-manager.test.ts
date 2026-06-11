import { describe, expect, it } from "vitest";
import {
  isValidTmuxName,
  makeSessionName,
  makeWindowName,
  sanitizeTmuxName,
  shellEscape,
  TmuxManager,
} from "#src/tmux-manager";

describe("isValidTmuxName", () => {
  it("accepts alphanumeric names", () => {
    expect(isValidTmuxName("abc123")).toBe(true);
    expect(isValidTmuxName("_pi-sub-abc")).toBe(true);
    expect(isValidTmuxName("implementer-a1b2c3d4")).toBe(true);
  });

  it("rejects names with special characters", () => {
    expect(isValidTmuxName("abc!123")).toBe(false);
    expect(isValidTmuxName("abc 123")).toBe(false);
    expect(isValidTmuxName("abc.123")).toBe(false);
    expect(isValidTmuxName("abc/123")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidTmuxName("")).toBe(false);
  });
});

describe("sanitizeTmuxName", () => {
  it("replaces invalid characters with underscores", () => {
    expect(sanitizeTmuxName("hello world!")).toBe("hello_world_");
    expect(sanitizeTmuxName("a.b/c")).toBe("a_b_c");
  });

  it("does not modify safe names", () => {
    expect(sanitizeTmuxName("abc123")).toBe("abc123");
    expect(sanitizeTmuxName("_pi-sub-test")).toBe("_pi-sub-test");
  });
});

describe("makeSessionName", () => {
  it("creates session name with underscore prefix", () => {
    const name = makeSessionName("abc123");
    expect(name).toBe("_pi-sub-abc123");
    expect(name.startsWith("_pi-sub-")).toBe(true);
  });

  it("sanitizes parent session ID", () => {
    const name = makeSessionName("abc!@#");
    expect(isValidTmuxName(name)).toBe(true);
    expect(name).toBe("_pi-sub-abc___");
  });
});

describe("makeWindowName", () => {
  it("creates window name with agent type and short ID", () => {
    const name = makeWindowName("implementer", "abcdef1234567890");
    expect(name).toBe("implementer-abcdef12");
  });

  it("sanitizes agent type", () => {
    const name = makeWindowName("Implementer!", "abc123456789");
    expect(isValidTmuxName(name)).toBe(true);
  });

  it("truncates agent ID to 8 characters", () => {
    const name = makeWindowName("test", "abcdefghijklmnop");
    expect(name).toBe("test-abcdefgh");
    expect(name.length).toBe(13); // 4 + 1 + 8
  });
});

describe("shellEscape", () => {
  it("wraps arguments in single quotes", () => {
    const result = shellEscape(["pi", "--session-id", "abc"]);
    expect(result).toBe("'pi' '--session-id' 'abc'");
  });

  it("handles embedded single quotes", () => {
    const result = shellEscape(["it's a test"]);
    expect(result).toBe("'it'\\''s a test'");
  });

  it("escapes special characters in prompts", () => {
    const result = shellEscape(['write tests for "foo.ts"']);
    // The inner string has quotes that get escaped by shellEscape
    expect(result).toContain("foo.ts");
  });
});

// Note: sendKeys/sendEnter/sendCtrlC now use execFileSync with argv arrays
// instead of shell string interpolation. This prevents shell injection from
// user-controlled text. Integration tests for tmux commands are gated on
// tmux availability (see spawner.test.ts).

describe("sessionExists", () => {
  it("throws on invalid session name for consistency with other methods", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.sessionExists("bad name!")).toThrow(
      /Invalid tmux session name/,
    );
  });

  it("throws on empty session name", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.sessionExists("")).toThrow(/Invalid tmux session name/);
  });
});

describe("windowExists", () => {
  it("throws on invalid session name for consistency with other methods", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.windowExists("bad name!", 0)).toThrow(
      /Invalid tmux session name/,
    );
  });

  it("throws on empty session name", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.windowExists("", 0)).toThrow(/Invalid tmux session name/);
  });
});

// Note: sendKeys/sendEnter/sendCtrlC now use execFileSync with argv arrays
// instead of shell string interpolation. This prevents shell injection from
// user-controlled text. Integration tests for tmux commands are gated on
// tmux availability (see spawner.test.ts).
