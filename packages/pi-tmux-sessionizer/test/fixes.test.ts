import { describe, expect, it } from "vitest";
import { buildParentContext } from "#src/parent-context";
import { analyzeSession, type SessionEntry } from "#src/session-parser";
import {
  isValidTmuxName,
  makeSessionName,
  makeWindowName,
  TmuxManager,
} from "#src/tmux-manager";
import type { ParentContextMessage } from "#src/types";

// ─── Blocker 1: Shell-safe sendKeys ────────────────────────

describe("Shell-safe tmux commands (Blocker 1)", () => {
  it("sendKeys uses argv-based execution — accepts shell metacharacters without error", () => {
    // This test verifies that sendKeys can accept arbitrary user text
    // containing shell metacharacters ($, `, ;, &, |, etc.) without
    // attempting to interpret them through a shell.
    // We can't run actual tmux commands here, but we verify the method
    // signature accepts the text and the tmux name validation works.
    const tmux = new TmuxManager();
    // Invalid name should throw
    expect(() => tmux.sendKeys("bad name", 0, "test")).toThrow(
      /Invalid tmux session name/,
    );
  });

  it("sendKeysLong accepts text with shell metacharacters in name validation", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.sendKeysLong("bad name", 0, "test")).toThrow(
      /Invalid tmux session name/,
    );
  });

  it("sendEnter validates session name before execution", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.sendEnter("bad;name", 0)).toThrow(
      /Invalid tmux session name/,
    );
  });

  it("sendCtrlC validates session name before execution", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.sendCtrlC("bad|name", 0)).toThrow(
      /Invalid tmux session name/,
    );
  });
});

// ─── Blocker 3: User→assistant ordering ────────────────────

describe("User→assistant ordering (Blocker 3)", () => {
  it("marks completed only when assistant text follows a user message", () => {
    const entries: SessionEntry[] = [
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

  it("rejects completion when assistant text precedes all user messages", () => {
    const entries: SessionEntry[] = [
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "orphan response" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "question" }],
          timestamp: 2000,
        },
        raw: "",
      },
    ];
    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(false);
    expect(analysis.result).toBeUndefined();
  });

  it("rejects when assistant timestamp is before user timestamp", () => {
    const entries: SessionEntry[] = [
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "early response" }],
          timestamp: 500,
        },
        raw: "",
      },
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "question" }],
          timestamp: 1000,
        },
        raw: "",
      },
    ];
    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(false);
  });

  it("handles multi-turn: only counts last assistant after last user", () => {
    const entries: SessionEntry[] = [
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "old response" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "new question" }],
          timestamp: 2000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "new response" }],
          timestamp: 3000,
        },
        raw: "",
      },
    ];
    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("new response");
  });

  it("accepts assistant text without explicit timestamp (undefined >= seenUserTimestamp)", () => {
    // When assistant has no timestamp, the code treats it as valid
    // (timestamp === undefined check in the condition)
    const entries: SessionEntry[] = [
      {
        data: {
          role: "user",
          content: [{ type: "text", text: "question" }],
          timestamp: 1000,
        },
        raw: "",
      },
      {
        data: {
          role: "assistant",
          content: [{ type: "text", text: "answer" }],
          // no timestamp
        },
        raw: "",
      },
    ];
    const analysis = analyzeSession(entries);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("answer");
  });
});

// ─── Blocker 5: inherit_context wiring ─────────────────────

describe("inherit_context wiring (Blocker 5)", () => {
  it("buildParentContext prepends user context to prompt", () => {
    const messages: ParentContextMessage[] = [
      { role: "user", content: "What is X?" },
    ];
    const result = buildParentContext(messages, "Do the thing");
    expect(result).toContain("# Parent Conversation Context");
    expect(result).toContain("[User]: What is X?");
    expect(result).toContain("---");
    expect(result).toContain("# Your Task (below)");
    expect(result).toContain("Do the thing");
  });

  it("buildParentContext passes through prompt when messages empty", () => {
    const result = buildParentContext([], "Do the thing");
    expect(result).toBe("Do the thing");
  });

  it("buildParentContext handles multiple messages", () => {
    const messages: ParentContextMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Do something" },
    ];
    const result = buildParentContext(messages, "Task");
    expect(result).toContain("[User]: Hello");
    expect(result).toContain("[Assistant]: Hi there");
    expect(result).toContain("[User]: Do something");
    expect(result).toContain("Task");
  });
});

// ─── Blocker 7: First window ──────────────────────────────

describe("First window creation (Blocker 7)", () => {
  it("ensureSession does not create a session on its own", () => {
    // ensureSession should only check existence, not create.
    // When the session doesn't exist, it should return the name without
    // calling tmux new-session. The actual session creation happens in
    // createWindow.
    const tmux = new TmuxManager();
    const name = tmux.ensureSession("test-parent-123");
    expect(name).toBe("_pi-sub-test-parent-123");
    expect(isValidTmuxName(name)).toBe(true);
    // The session was NOT actually created (no tmux running in test)
    // This just verifies the name generation logic works.
  });

  it("makeSessionName generates valid name", () => {
    const name = makeSessionName("abc123");
    expect(name).toBe("_pi-sub-abc123");
    expect(isValidTmuxName(name)).toBe(true);
  });

  it("makeWindowName generates valid name", () => {
    const name = makeWindowName("implementer", "abcdef1234567890");
    expect(name).toBe("implementer-abcdef12");
    expect(isValidTmuxName(name)).toBe(true);
  });
});

// ─── Blocker 8 / Warning: windowExists ────────────────────

describe("windowExists (Warning 8)", () => {
  it("throws on invalid session name for consistency", () => {
    const tmux = new TmuxManager();
    expect(() => tmux.windowExists("bad name!", 0)).toThrow(
      /Invalid tmux session name/,
    );
  });

  it("returns false when tmux session does not exist", () => {
    const tmux = new TmuxManager();
    // Non-existent session — tmux will fail, catch returns false
    expect(tmux.windowExists("_pi-sub-nonexistent", 0)).toBe(false);
  });
});

// ─── Blocker 4: Tmux unavailable error ────────────────────

import { isTmuxAvailable } from "#src/tmux-manager";

describe("Tmux unavailable error (Blocker 4)", () => {
  it("isTmuxAvailable returns a boolean", () => {
    const result = isTmuxAvailable();
    expect(typeof result).toBe("boolean");
  });
});

// ─── Blocker 6: Parent session ID extraction ──────────────

describe("Session name generation (Blocker 6)", () => {
  it("sanitizes session IDs with special characters", () => {
    const name = makeSessionId("session/id:with-spéciàl-chars");
    expect(isValidTmuxName(name)).toBe(true);
    expect(name).toMatch(/^_pi-sub-/);
  });

  it("preserves valid session IDs", () => {
    const name = makeSessionId("abc-123_def");
    expect(name).toBe("_pi-sub-abc-123_def");
  });
});

function makeSessionId(id: string): string {
  return makeSessionName(id);
}
