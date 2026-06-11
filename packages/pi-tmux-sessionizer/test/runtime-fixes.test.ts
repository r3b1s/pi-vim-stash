import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

describe("parent context capture", () => {
  it("extracts user and assistant text from session history", async () => {
    const { captureParentContext } = await import("#src/parent-context");
    const captured = captureParentContext({
      sessionManager: {
        getBranch: () =>
          [
            {
              type: "message",
              message: {
                role: "user",
                content: [{ type: "text", text: "Need help" }],
                timestamp: Date.now(),
              },
            },
            {
              type: "message",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "Here is the plan" }],
                timestamp: Date.now(),
              },
            },
            {
              type: "message",
              message: {
                role: "toolResult",
                content: [{ type: "text", text: "ignored" }],
                timestamp: Date.now(),
              },
            },
          ] as never,
      },
    } as never);

    expect("messages" in captured).toBe(true);
    if ("messages" in captured) {
      expect(captured.messages).toEqual([
        { role: "user", content: "Need help" },
        { role: "assistant", content: "Here is the plan" },
      ]);
      expect(captured.parentContextText).toContain("[User]: Need help");
      expect(captured.parentContextText).toContain(
        "[Assistant]: Here is the plan",
      );
    }
  });

  it("warns when session history is unavailable", async () => {
    const { captureParentContext } = await import("#src/parent-context");
    const captured = captureParentContext(undefined);
    expect("warning" in captured).toBe(true);
  });
});

describe("parent session extraction", () => {
  it("reports real session ids from extension context", async () => {
    const { extractParentSessionInfo } = await import("#src/index");
    const info = extractParentSessionInfo({
      context: { sessionId: "session-123" },
    } as never);
    expect(info).toEqual({ id: "session-123", isReal: true });
  });

  it("marks generated fallback ids as synthetic", async () => {
    vi.resetModules();
    vi.doMock("node:crypto", () => ({
      randomUUID: () => "fallback-id-12345678",
    }));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { extractParentSessionInfo } = await import("#src/index");
    const info = extractParentSessionInfo({} as never);

    expect(info).toEqual({ id: "fallback", isReal: false });
    expect(warn).toHaveBeenCalled();
  });
});

describe("tmux remain-on-exit", () => {
  afterEach(() => {
    execFileSyncMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("uses set-window-option for the first window", async () => {
    execFileSyncMock.mockImplementation(
      (command: string, args?: readonly string[]) => {
        if (command === "tmux" && args?.[0] === "has-session") {
          throw new Error("missing");
        }
        if (command === "tmux" && args?.[0] === "list-windows") {
          return Buffer.from("0:implementer-12345678\n") as never;
        }
        return Buffer.from("") as never;
      },
    );

    const { TmuxManager } = await import("#src/tmux-manager");

    const tmux = new TmuxManager();
    tmux.createWindow("_pi-sub-parent", "implementer-12345678", "echo hi");

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "tmux",
      ["set-window-option", "-t", "_pi-sub-parent:0", "remain-on-exit", "on"],
      expect.any(Object),
    );
  });

  it("uses set-window-option for subsequent windows", async () => {
    execFileSyncMock.mockImplementation(
      (command: string, args?: readonly string[]) => {
        if (command === "tmux" && args?.[0] === "has-session") {
          return Buffer.from("") as never;
        }
        if (command === "tmux" && args?.[0] === "list-windows") {
          return Buffer.from("0:first\n1:reviewer-12345678\n") as never;
        }
        return Buffer.from("") as never;
      },
    );

    const { TmuxManager } = await import("#src/tmux-manager");

    const tmux = new TmuxManager();
    const index = tmux.createWindow(
      "_pi-sub-parent",
      "reviewer-12345678",
      "echo hi",
    );

    expect(index).toBe(1);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "tmux",
      ["set-window-option", "-t", "_pi-sub-parent:1", "remain-on-exit", "on"],
      expect.any(Object),
    );
  });
});

describe("spawnSubagent runtime fixes", () => {
  let baseDir = "";
  let previousPiDir: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    previousPiDir = process.env.PI_CODING_AGENT_DIR;
    baseDir = mkdtempSync(join(tmpdir(), "pts-runtime-"));
    process.env.PI_CODING_AGENT_DIR = baseDir;
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    process.env.PI_CODING_AGENT_DIR = previousPiDir;
    vi.restoreAllMocks();
  });

  it("uses sanitized window names when spawning", async () => {
    vi.doMock("node:crypto", () => ({
      randomUUID: () => "12345678-1234-1234-1234-123456789abc",
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

    const { spawnSubagent } = await import("#src/spawner");
    const { SubagentTracker } = await import("#src/tracker");

    const createWindow = vi.fn(() => 0);
    const tmux = {
      ensureSession: vi.fn(() => "_pi-sub-parent"),
      createWindow,
    };

    await spawnSubagent(
      { agentType: "review/er", prompt: "Check it" },
      "parent",
      new SubagentTracker(),
      tmux as never,
    );

    expect(createWindow).toHaveBeenCalledWith(
      "_pi-sub-parent",
      "review_er-12345678",
      expect.any(String),
    );
  });

  it("cleans up config directories when tmux setup fails", async () => {
    vi.doMock("node:crypto", () => ({
      randomUUID: () => "87654321-1234-1234-1234-123456789abc",
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

    const { spawnSubagent } = await import("#src/spawner");
    const { SubagentTracker } = await import("#src/tracker");

    await expect(
      spawnSubagent(
        { agentType: "reviewer", prompt: "Check it" },
        "parent",
        new SubagentTracker(),
        {
          ensureSession: () => "_pi-sub-parent",
          createWindow: () => {
            throw new Error("tmux boom");
          },
        } as never,
      ),
    ).rejects.toThrow("tmux boom");

    expect(
      existsSync(
        join(
          baseDir,
          "tmp",
          "subagents",
          "parent",
          "87654321-1234-1234-1234-123456789abc",
        ),
      ),
    ).toBe(false);
  });

  it("fails clearly when inherit_context has no captured parent history", async () => {
    vi.doMock("node:crypto", () => ({
      randomUUID: () => "aaaaaaaa-1234-1234-1234-123456789abc",
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

    const { spawnSubagent } = await import("#src/spawner");
    const { SubagentTracker } = await import("#src/tracker");

    await expect(
      spawnSubagent(
        {
          agentType: "reviewer",
          prompt: "Check it",
          inheritContext: true,
        },
        "parent",
        new SubagentTracker(),
        {
          ensureSession: () => "_pi-sub-parent",
          createWindow: () => 0,
        } as never,
      ),
    ).rejects.toThrow(/inherit_context requested/);
  });
});

describe("sendKeysLong temp file security", () => {
  let tmpDir: string;

  afterEach(() => {
    execFileSyncMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("creates and cleans up temp file with restrictive permissions", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pts-sk-"));

    // Ensure temp files go to our controlled directory
    vi.doMock("node:os", () => ({
      tmpdir: () => tmpDir,
    }));

    execFileSyncMock.mockReturnValue(Buffer.from(""));

    const { TmuxManager } = await import("#src/tmux-manager");
    const tmux = new TmuxManager();

    // Before: no stray temp files exist
    expect(
      readdirSync(tmpDir).filter((f) => f.startsWith("pi-sub-steer-")),
    ).toHaveLength(0);

    tmux.sendKeysLong("_pi-sub-test", 0, "some text");

    // After: temp file was created and cleaned up
    expect(
      readdirSync(tmpDir).filter((f) => f.startsWith("pi-sub-steer-")),
    ).toHaveLength(0);

    // Source-level assertion: verify the code uses restrictive permissions
    // and exclusive create (cannot intercept core module calls in vitest)
    const sourcePath = new URL("../src/tmux-manager.ts", import.meta.url);
    const source = readFileSync(sourcePath, "utf-8");
    expect(source).toMatch(/openSync\([^,]+,\s*"wx",\s*0o600\)/);
    expect(source).toMatch(/rmSync\([^,]+,\s*\{ force: true \}\)/);
  });

  it("cleans up temp file when load-buffer throws", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pts-sk-"));

    vi.doMock("node:os", () => ({
      tmpdir: () => tmpDir,
    }));

    execFileSyncMock.mockImplementation(() => {
      throw new Error("tmux: load-buffer failed");
    });

    const { TmuxManager } = await import("#src/tmux-manager");
    const tmux = new TmuxManager();

    expect(() => {
      tmux.sendKeysLong("_pi-sub-test", 0, "sensitive data");
    }).toThrow("tmux: load-buffer failed");

    // Verify no temp files remain
    const files = readdirSync(tmpDir).filter((f) =>
      f.startsWith("pi-sub-steer-"),
    );
    expect(files).toHaveLength(0);
  });

  it("cleans up temp file when paste-buffer throws", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "pts-sk-"));

    vi.doMock("node:os", () => ({
      tmpdir: () => tmpDir,
    }));

    let callCount = 0;
    execFileSyncMock.mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        throw new Error("tmux: paste-buffer failed");
      }
      return Buffer.from("");
    });

    const { TmuxManager } = await import("#src/tmux-manager");
    const tmux = new TmuxManager();

    expect(() => {
      tmux.sendKeysLong("_pi-sub-test", 0, "sensitive data");
    }).toThrow("tmux: paste-buffer failed");

    // Verify no temp files remain
    const files = readdirSync(tmpDir).filter((f) =>
      f.startsWith("pi-sub-steer-"),
    );
    expect(files).toHaveLength(0);
  });
});

describe("new-session argv shape", () => {
  afterEach(() => {
    execFileSyncMock.mockReset();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("creates window without command, then sets remain-on-exit, then sends command via send-keys", async () => {
    execFileSyncMock.mockImplementation(
      (command: string, args?: readonly string[]) => {
        if (command === "tmux" && args?.[0] === "has-session") {
          throw new Error("no session");
        }
        if (command === "tmux" && args?.[0] === "list-windows") {
          return Buffer.from("0:test-window\n") as never;
        }
        return Buffer.from("") as never;
      },
    );

    const { TmuxManager } = await import("#src/tmux-manager");
    const tmux = new TmuxManager();
    tmux.createWindow("_pi-sub-test", "test-window", "echo hello");

    const calls = execFileSyncMock.mock.calls as Array<[string, string[]]>;

    // new-session should be called WITHOUT a command (command is sent
    // later via send-keys after remain-on-exit is set)
    const newSessionCall = calls.find(
      ([cmd, args]) => cmd === "tmux" && args?.[0] === "new-session",
    );
    expect(newSessionCall).toBeDefined();

    const newSessionArgs = newSessionCall![1];
    // No -- separator (no command in new-session)
    expect(newSessionArgs).not.toContain("--");
    expect(newSessionArgs).not.toContain("echo hello");
    expect(newSessionArgs).toContain("-d");
    expect(newSessionArgs).toContain("-s");
    expect(newSessionArgs).toContain("_pi-sub-test");
    expect(newSessionArgs).toContain("-n");
    expect(newSessionArgs).toContain("test-window");

    // set-window-option should be called to set remain-on-exit
    const setOptCall = calls.find(
      ([cmd, args]) => cmd === "tmux" && args?.[0] === "set-window-option",
    );
    expect(setOptCall).toBeDefined();
    expect(setOptCall![1]).toContain("remain-on-exit");
    expect(setOptCall![1]).toContain("on");

    // send-keys should be called with the command literally
    const sendKeysCall = calls.find(
      ([cmd, args]) =>
        cmd === "tmux" &&
        args?.[0] === "send-keys" &&
        args.includes("-l") &&
        args.includes("echo hello"),
    );
    expect(sendKeysCall).toBeDefined();

    // send-keys Enter should be called to execute the command
    const enterCall = calls.find(
      ([cmd, args]) =>
        cmd === "tmux" && args?.[0] === "send-keys" && args.includes("Enter"),
    );
    expect(enterCall).toBeDefined();
  });
});

describe("model fallback in subagent tool", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to second model when first model agent errors", async () => {
    vi.useFakeTimers();
    let attemptCount = 0;

    // Return two models from routing so fallback can occur
    vi.doMock("#src/model-routing", () => ({
      readModelRouting: vi.fn(() => ({
        roles: {
          implementer: {
            models: ["claude-sonnet-4-20250514", "claude-haiku-3-5-20241022"],
          },
        },
      })),
      resolveModelsForType: vi.fn((agentType: string) => {
        if (agentType.toLowerCase() === "implementer") {
          return [
            { model: "claude-sonnet-4-20250514" },
            { model: "claude-haiku-3-5-20241022" },
          ];
        }
        return undefined;
      }),
    }));

    const spawnedModels: string[] = [];

    vi.doMock("#src/spawner", () => ({
      spawnSubagent: vi.fn(
        async (
          params: Record<string, unknown>,
          _parentSessionId: string,
          tracker: import("#src/tracker").SubagentTracker,
          _tmux: unknown,
          _abortSignal?: AbortSignal,
        ) => {
          attemptCount++;
          const agentId = `00000000-0000-0000-0000-${String(attemptCount).padStart(12, "0")}`;
          spawnedModels.push((params.model as string) ?? "none");
          tracker.add({
            id: agentId,
            type: params.agentType as string,
            prompt: params.prompt as string,
            status: "starting",
            sessionName: "_pi-sub-test",
            windowIndex: 0,
            configDir: "/tmp/test",
            startedAt: Date.now(),
          });
          // Set status synchronously so waitForAgentCompletion sees it
          // immediately instead of polling forever.
          if (attemptCount === 1) {
            tracker.setError(agentId, "Model not available");
            tracker.updateStatus(agentId, "error");
          } else if (attemptCount === 2) {
            tracker.setResult(agentId, "Task complete!");
            tracker.updateStatus(agentId, "completed");
          }
          return agentId;
        },
      ),
    }));

    vi.doMock("#src/tmux-manager", async () => {
      const actual =
        await vi.importActual<typeof import("#src/tmux-manager")>(
          "#src/tmux-manager",
        );
      return { ...actual, isTmuxAvailable: () => true };
    });

    vi.doMock("#src/session-monitor", () => ({
      monitorSubagent: vi.fn(
        async (
          tracker: import("#src/tracker").SubagentTracker,
          agentId: string,
        ) => {
          // First agent fails synchronously (no await inside)
          if (agentId.endsWith("000000000001")) {
            tracker.setError(agentId, "Model not available");
            tracker.updateStatus(agentId, "error");
            return { completed: false };
          }
          // Second agent succeeds
          if (agentId.endsWith("000000000002")) {
            tracker.setResult(agentId, "Task complete!");
            tracker.updateStatus(agentId, "completed");
            return { completed: true, result: "Task complete!" };
          }
          tracker.updateStatus(agentId, "error");
          return { completed: false };
        },
      ),
    }));

    vi.doMock("#src/subagent-config", () => ({
      destroySubagentConfig: vi.fn(),
      createSubagentConfig: vi.fn(() => ({
        configDir: "/tmp/test",
        sessionDir: "/tmp/test/sessions",
      })),
      destroyParentConfigs: vi.fn(),
    }));

    vi.resetModules();

    const { createSubagentTool } = await import("#src/tools/subagent");
    const { SubagentTracker } = await import("#src/tracker");
    const { TmuxManager } = await import("#src/tmux-manager");

    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();

    const tool = createSubagentTool("/tmp/config", "parent-123", tracker, tmux);

    const result = await tool.execute(
      "call-fallback",
      {
        subagent_type: "implementer",
        prompt: "do the thing",
        description: "test fallback",
      },
      undefined,
      undefined,
      {} as never,
    );

    // Should have tried 2 models
    expect(spawnedModels).toHaveLength(2);
    expect(spawnedModels[0]).toBe("claude-sonnet-4-20250514");
    expect(spawnedModels[1]).toBe("claude-haiku-3-5-20241022");

    // Result should come from the successful (second) model
    const content = result.content as { type: "text"; text: string }[];
    expect(content[0].text).toContain("completed");
    expect(content[0].text).toContain("Task complete!");

    vi.useRealTimers();
  });
});
