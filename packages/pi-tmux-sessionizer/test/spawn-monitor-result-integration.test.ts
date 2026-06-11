import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentTracker } from "#src/tracker";

/**
 * Integration tests for the spawn → monitor → result pipeline.
 *
 * These tests connect real filesystem operations (config creation,
 * session file writing) with real parsers and trackers, without
 * requiring live LLM credentials or a running tmux.
 *
 * The chain tested:
 *   createSubagentConfig → write session file → findSessionFile
 *   → analyzeSessionFile → SubagentTracker
 */

describe("spawn → monitor → result integration", () => {
  let baseDir: string;
  let origPiDir: string | undefined;

  beforeEach(() => {
    origPiDir = process.env.PI_CODING_AGENT_DIR;
    baseDir = mkdtempSync(join(tmpdir(), "pts-spawn-monitor-"));
    process.env.PI_CODING_AGENT_DIR = baseDir;
  });

  afterEach(() => {
    process.env.PI_CODING_AGENT_DIR = origPiDir;
    if (baseDir) {
      rmSync(baseDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  /**
   * Write a session JSONL file as pi would, under sessionDir/<cwd-hash>/.
   */
  function writeSessionFile(
    sessionDir: string,
    agentId: string,
    entries: Array<Record<string, unknown>>,
  ): string {
    const subdir = join(sessionDir, "cwdhash123");
    mkdirSync(subdir, { recursive: true });
    const filePath = join(subdir, `20240101_${agentId}.jsonl`);
    const content = entries.map((e) => JSON.stringify(e)).join("\n");
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  // ─── Pipeline: config → file → find → parse → tracker ─────

  it("full pipeline: createSubagentConfig → write session file → findSessionFile → analyzeSessionFile → tracker", async () => {
    const agentId = "aaaa0000-1111-2222-3333-444455556666";
    const parentId = "full-pipeline";

    // Step 1: Create config directory
    const { createSubagentConfig } = await import("#src/subagent-config");
    const { configDir, sessionDir } = createSubagentConfig(parentId, agentId, {
      model: "test-model",
      maxTurns: 5,
    });

    expect(existsSync(configDir)).toBe(true);
    expect(existsSync(sessionDir)).toBe(true);
    expect(configDir).toContain(parentId);
    expect(configDir).toContain(agentId);
    expect(sessionDir).toContain("sessions");

    // Step 2: Write a session file as pi would
    writeSessionFile(sessionDir, agentId, [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "world" }],
        timestamp: 2000,
      },
    ]);

    // Step 3: Find the session file using findSessionFile
    const { findSessionFile } = await import("#src/session-monitor");
    const foundPath = findSessionFile(sessionDir, agentId);
    expect(foundPath).toBeDefined();
    expect(foundPath).toContain(agentId);

    // Step 4: Parse and analyze the session file
    const { analyzeSessionFile } = await import("#src/session-parser");
    const analysis = analyzeSessionFile(foundPath!);
    expect(analysis.completed).toBe(true);
    expect(analysis.result).toBe("world");
    expect(analysis.entryCount).toBe(2);

    // Step 5: Update tracker with the result
    const tracker = new SubagentTracker();
    tracker.add({
      id: agentId,
      type: "implementer",
      prompt: "test prompt",
      status: "running",
      sessionName: "_pi-sub-test",
      windowIndex: 0,
      configDir,
      startedAt: Date.now(),
    });

    tracker.setSessionFilePath(agentId, foundPath!);
    tracker.setResult(agentId, analysis.result!);
    tracker.updateStatus(agentId, "completed");

    const record = tracker.get(agentId);
    expect(record?.status).toBe("completed");
    expect(record?.result).toBe("world");
    expect(record?.sessionFilePath).toBe(foundPath);

    // Step 6: Cleanup via destroyParentConfigs
    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs(parentId);
    expect(existsSync(configDir)).toBe(false);
  });

  it("pipeline with complex multi-turn session content", async () => {
    const agentId = "bbb00000-1111-2222-3333-444455556666";
    const parentId = "complex-pipeline";

    const { createSubagentConfig } = await import("#src/subagent-config");
    const { sessionDir } = createSubagentConfig(parentId, agentId, {});

    // Multi-turn with tool calls
    writeSessionFile(sessionDir, agentId, [
      {
        role: "user",
        content: [{ type: "text", text: "Write tests" }],
        timestamp: 1000,
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I'll write tests" },
          { type: "tool_use", name: "bash", input: "npm test" },
        ],
        timestamp: 2000,
      },
      {
        role: "tool",
        content: [
          { type: "tool_result", tool_use_id: "test", content: "PASS" },
        ],
        timestamp: 3000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "All tests passed!" }],
        timestamp: 4000,
      },
    ]);

    const { findSessionFile } = await import("#src/session-monitor");
    const { analyzeSessionFile } = await import("#src/session-parser");

    const foundPath = findSessionFile(sessionDir, agentId);
    expect(foundPath).toBeDefined();

    const analysis = analyzeSessionFile(foundPath!);
    // Should detect the last assistant text after the user message
    expect(analysis.completed).toBe(true);
    // The last assistant text with content is "All tests passed!"
    expect(analysis.result).toBe("All tests passed!");
    expect(analysis.entryCount).toBe(4);

    // Tracker integration
    const tracker = new SubagentTracker();
    tracker.add({
      id: agentId,
      type: "implementer",
      prompt: "Write tests",
      status: "running",
      sessionName: "_pi-sub-test",
      windowIndex: 0,
      configDir: "/tmp/test",
      startedAt: Date.now(),
    });
    tracker.setResult(agentId, analysis.result!);
    tracker.updateStatus(agentId, "completed");

    expect(tracker.get(agentId)?.status).toBe("completed");
    expect(tracker.get(agentId)?.result).toBe("All tests passed!");

    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs(parentId);
  });

  it("pipeline detects incomplete session (user messages only)", async () => {
    const agentId = "ccc00000-1111-2222-3333-444455556666";
    const parentId = "incomplete-pipeline";

    const { createSubagentConfig } = await import("#src/subagent-config");
    const { sessionDir } = createSubagentConfig(parentId, agentId, {});

    writeSessionFile(sessionDir, agentId, [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1000,
      },
    ]);

    const { findSessionFile } = await import("#src/session-monitor");
    const { analyzeSessionFile } = await import("#src/session-parser");

    const foundPath = findSessionFile(sessionDir, agentId);
    const analysis = analyzeSessionFile(foundPath!);
    expect(analysis.completed).toBe(false);
    expect(analysis.result).toBeUndefined();
    expect(analysis.entryCount).toBe(1);

    const tracker = new SubagentTracker();
    tracker.add({
      id: agentId,
      type: "explore",
      prompt: "hello",
      status: "running",
      sessionName: "_pi-sub-test",
      windowIndex: 0,
      configDir: "/tmp/test",
      startedAt: Date.now(),
    });
    tracker.setSessionFilePath(agentId, foundPath!);

    // Should still be running — no result to set
    expect(tracker.get(agentId)?.status).toBe("running");

    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs(parentId);
  });

  // ─── findSessionFile edge cases ───────────────────────────

  it("findSessionFile returns undefined when session directory does not exist", async () => {
    const { findSessionFile } = await import("#src/session-monitor");
    const result = findSessionFile("/nonexistent/dir", "agent-123");
    expect(result).toBeUndefined();
  });

  it("findSessionFile returns undefined when no file matches the agent ID", async () => {
    const { createSubagentConfig } = await import("#src/subagent-config");
    const { sessionDir } = createSubagentConfig("p-find", "agent-mismatch", {});

    // Create a session file for a DIFFERENT agent ID
    writeSessionFile(sessionDir, "other-agent", [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);

    const { findSessionFile } = await import("#src/session-monitor");
    const result = findSessionFile(sessionDir, "agent-mismatch");
    expect(result).toBeUndefined();

    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs("p-find");
  });

  it("findSessionFile finds file across multiple subdirectories", async () => {
    const { createSubagentConfig } = await import("#src/subagent-config");
    const { sessionDir } = createSubagentConfig("p-multi", "agent-multi", {});

    // Write files in multiple subdirectories — only one matches the agent
    const subdir1 = join(sessionDir, "hash1");
    mkdirSync(subdir1, { recursive: true });
    writeFileSync(
      join(subdir1, "20240101_agent-multi.jsonl"),
      JSON.stringify({ role: "user", content: [] }),
      "utf-8",
    );

    const subdir2 = join(sessionDir, "hash2");
    mkdirSync(subdir2, { recursive: true });
    writeFileSync(
      join(subdir2, "20240102_other-agent.jsonl"),
      JSON.stringify({ role: "user", content: [] }),
      "utf-8",
    );

    const { findSessionFile } = await import("#src/session-monitor");
    const result = findSessionFile(sessionDir, "agent-multi");
    expect(result).toBeDefined();
    expect(result).toContain("agent-multi.jsonl");

    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs("p-multi");
  });

  // ─── Config lifecycle integration ─────────────────────────

  it("createSubagentConfig creates settings.json with provided options", async () => {
    const { createSubagentConfig } = await import("#src/subagent-config");
    const { configDir } = createSubagentConfig("p-settings", "agent-s", {
      model: "sonnet",
      thinking: "high",
      maxTurns: 10,
    });

    const { readFileSync } = await import("node:fs");
    const settings = JSON.parse(
      readFileSync(join(configDir, "settings.json"), "utf-8"),
    );
    expect(settings.model).toBe("sonnet");
    expect(settings.thinking).toBe("high");
    expect(settings.maxTurns).toBe(10);

    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs("p-settings");
  });

  it("destroySubagentConfig removes agent directory without affecting other agents", async () => {
    const { createSubagentConfig, destroySubagentConfig } = await import(
      "#src/subagent-config"
    );

    const { configDir: dir1 } = createSubagentConfig("p-parent", "agent-a", {});
    const { configDir: dir2 } = createSubagentConfig("p-parent", "agent-b", {});

    expect(existsSync(dir1)).toBe(true);
    expect(existsSync(dir2)).toBe(true);

    destroySubagentConfig("p-parent", "agent-a");
    expect(existsSync(dir1)).toBe(false);
    expect(existsSync(dir2)).toBe(true);

    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs("p-parent");
  });

  // ─── SpawnSubagent with mocked tmux manager ────────────────
  // Tests the spawn→track integration without requiring real tmux

  it("spawnSubagent with mocked tmux creates config and tracks agent", async () => {
    const agentId = "spawn-1111-2222-3333-444455556666";
    const parentId = "spawn-mocked";

    vi.doMock("node:crypto", () => ({
      randomUUID: () => agentId,
    }));

    vi.doMock("#src/session-monitor", () => ({
      monitorSubagent: vi.fn(() => Promise.resolve({ completed: false })),
    }));

    vi.doMock("#src/tmux-manager", async () => {
      const actual =
        await vi.importActual<typeof import("#src/tmux-manager")>(
          "#src/tmux-manager",
        );
      return { ...actual, isTmuxAvailable: () => true };
    });

    vi.resetModules();

    const { spawnSubagent } = await import("#src/spawner");
    const tracker = new SubagentTracker();

    const mockTmux = {
      ensureSession: vi.fn(() => `_pi-sub-${parentId}`),
      createWindow: vi.fn(() => 0),
    };

    const result = await spawnSubagent(
      { agentType: "implementer", prompt: "Do something" },
      parentId,
      tracker,
      mockTmux as never,
    );

    expect(result).toBe(agentId);

    // Verify config dir was created
    const configDir = join(baseDir, "tmp", "subagents", parentId, agentId);
    expect(existsSync(configDir)).toBe(true);
    expect(existsSync(join(configDir, "sessions"))).toBe(true);

    // Verify tracker has the agent
    const record = tracker.get(agentId);
    expect(record).toBeDefined();
    expect(record?.type).toBe("implementer");
    expect(record?.prompt).toBe("Do something");
    expect(record?.status).toBe("starting");
    expect(record?.sessionName).toBe(`_pi-sub-${parentId}`);
    expect(record?.windowIndex).toBe(0);

    // Cleanup
    const { destroyParentConfigs } = await import("#src/subagent-config");
    destroyParentConfigs(parentId);
    expect(existsSync(configDir)).toBe(false);
  });

  it("spawnSubagent cleans up config dir when tmux createWindow fails", async () => {
    const agentId = "cleanup-1111-2222-3333-444455556666";
    const parentId = "spawn-fail-cleanup";

    vi.doMock("node:crypto", () => ({
      randomUUID: () => agentId,
    }));

    vi.doMock("#src/session-monitor", () => ({
      monitorSubagent: vi.fn(() => Promise.resolve({ completed: false })),
    }));

    vi.doMock("#src/tmux-manager", async () => {
      const actual =
        await vi.importActual<typeof import("#src/tmux-manager")>(
          "#src/tmux-manager",
        );
      return { ...actual, isTmuxAvailable: () => true };
    });

    vi.resetModules();

    const { spawnSubagent } = await import("#src/spawner");
    const tracker = new SubagentTracker();

    const mockTmux = {
      ensureSession: vi.fn(() => "_pi-sub-cleanup-test"),
      createWindow: vi.fn(() => {
        throw new Error("tmux failure");
      }),
    };

    await expect(
      spawnSubagent(
        { agentType: "reviewer", prompt: "Review this" },
        parentId,
        tracker,
        mockTmux as never,
      ),
    ).rejects.toThrow("tmux failure");

    // Config dir should have been cleaned up (no orphan dirs)
    const configDir = join(baseDir, "tmp", "subagents", parentId, agentId);
    expect(existsSync(configDir)).toBe(false);

    // Tracker should have no record (cleanup happened before adding)
    // Actually, spawnSubagent adds to tracker BEFORE createWindow, and
    // cleanup on failure removes the config dir but NOT the tracker entry.
    // This is the current behavior — the tracker entry is left for diagnostics.
    // We verify the config cleanup is the critical part.
  });
});
