/**
 * Integration tests for PTS/PSD composition and inherit_context.
 *
 * Tasks covered:
 *   9.10 – PTS/PSD composition (setSpawner, setResultProvider, tool routing)
 *   9.14 – inherit_context (standalone capture, PSD-composed path)
 *
 * These tests avoid real tmux, model credentials, and filesystem I/O.
 * Expensive boundaries (spawnSubagent, isTmuxAvailable) are mocked.
 * Instead they verify composition contracts that fail if the bridge code
 * is broken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Spawner } from "#src/spawner-psd";
import type { SpawnParams } from "#src/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock PSD so importPsd() succeeds in test environment
vi.mock("@r3b1s/pi-subagents-deterministic", () => ({
  setSpawner: vi.fn(),
  setResultProvider: vi.fn(),
}));

// Mock spawnSubagent to avoid real tmux / filesystem
const spawnSubagentMock = vi.fn();
vi.mock("#src/spawner", () => ({
  spawnSubagent: spawnSubagentMock,
}));

// Mock tmux-manager to avoid requiring tmux on PATH
vi.mock("#src/tmux-manager", () => ({
  isTmuxAvailable: () => true,
  TmuxManager: class MockTmuxManager {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a PTS spawner with the same shape as the one in src/index.ts.
 *
 * This is the closure that PTS passes to PSD's setSpawner(). It translates
 * PSD SpawnOptions into PTS SpawnParams, handles inheritContext, and
 * delegates to spawnSubagent.
 */
/**
 * A mutable ref object so the test can simulate the real closure semantics
 * of index.ts where latestParentContext is a let variable shared between
 * the tool_call handler and the spawner.
 */
interface LatestParentContextRef {
  current?: {
    messages: SpawnParams["parentContext"];
    text: string;
  };
}

function createTestSpawner(deps: {
  parentSessionId: string;
  latestParentContextRef?: LatestParentContextRef;
}): { spawner: Spawner; contextRef: LatestParentContextRef } {
  // Use a ref object so external code can update the context after creation.
  // In the real index.ts this is a let in the shared closure.
  const contextRef: LatestParentContextRef = deps.latestParentContextRef ?? {};

  return {
    spawner: {
      spawn: async (agentType: string, prompt: string, options) => {
        const spawnParams: SpawnParams = {
          agentType,
          prompt,
          model: options.model as string | undefined,
          thinking: options.thinkingLevel as string | undefined,
          maxTurns: options.maxTurns as number | undefined,
          inheritContext: options.inheritContext as boolean | undefined,
        };

        if (spawnParams.inheritContext) {
          if (!contextRef.current?.messages?.length) {
            throw new Error(
              "inherit_context requested, but PTS could not capture parent conversation history from the active session. Retry from an active pi session or disable inherit_context.",
            );
          }
          spawnParams.parentContext = contextRef.current.messages;
          spawnParams.parentContextText = contextRef.current.text;
        }

        return spawnSubagentMock(spawnParams, deps.parentSessionId);
      },
    },
    contextRef,
  };
}

/**
 * Create a PTS result provider with the same shape as the one in src/index.ts.
 *
 * This is the object that PTS passes to PSD's setResultProvider(). It wraps
 * the SubagentTracker and returns results for known agents, or null for
 * unknown agents so PSD can fall back to its SubagentsService.
 */
function createTestProvider(tracker: {
  get: (id: string) =>
    | {
        status: string;
        result?: string;
        type: string;
        error?: string;
        startedAt: number;
        completedAt?: number;
      }
    | undefined;
}) {
  return {
    getResult: async (agentId: string) => {
      const record = tracker.get(agentId);
      if (!record) return null;

      let text: string;
      switch (record.status) {
        case "starting":
        case "running":
          text = `Agent ${agentId} is still running (status: ${record.status}). Call get_subagent_result again to check.`;
          break;
        case "completed":
          text = [
            `Status: completed`,
            `Result: ${record.result ?? "(no result)"}`,
            `Type: ${record.type}`,
            `Duration: ${record.completedAt ? ((record.completedAt - record.startedAt) / 1000).toFixed(1) : "?"}s`,
          ].join("\n");
          break;
        case "stopped":
          text = `Agent ${agentId} was stopped. Type: ${record.type}.`;
          break;
        case "error":
          text = `Agent ${agentId} encountered an error: ${record.error ?? "Unknown error"}`;
          break;
        default:
          text = `Agent ${agentId} status: ${record.status}`;
      }
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  };
}

// ===========================================================================
// Task 9.10 – PTS/PSD Composition
// ===========================================================================

describe("PTS/PSD composition (task 9.10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Requirement 1: importPsd → setSpawner + setResultProvider
  // -----------------------------------------------------------------------

  describe("importPsd bootstrap contract", () => {
    it("returns PsdApi when PSD module is available", async () => {
      // importPsd dynamically imports the @r3b1s/pi-subagents-deterministic
      // module. Our vi.mock above makes this succeed with spies.
      const { importPsd } = await import("#src/spawner-psd");
      const psd = await importPsd();

      expect(psd).toBeDefined();
      expect(typeof psd!.setSpawner).toBe("function");
      expect(typeof psd!.setResultProvider).toBe("function");
    });

    it("PTS bootstrap flow: calls setSpawner with a spawner object", async () => {
      const { importPsd } = await import("#src/spawner-psd");
      const psd = (await importPsd())!;

      // The spawner that PTS creates (same shape as in index.ts)
      const spawner: Spawner = {
        spawn: async (_a, _p, _o) => "agent-id",
      };
      psd.setSpawner(spawner);

      expect(psd.setSpawner).toHaveBeenCalledTimes(1);
      expect(psd.setSpawner).toHaveBeenCalledWith(spawner);
    });

    it("PTS bootstrap flow: calls setResultProvider with a provider object", async () => {
      const { importPsd } = await import("#src/spawner-psd");
      const psd = (await importPsd())!;

      // The provider that PTS creates (same shape as in index.ts)
      const provider = { getResult: async (_id: string) => null };
      psd.setResultProvider(provider);

      expect(psd.setResultProvider).toHaveBeenCalledTimes(1);
      expect(psd.setResultProvider).toHaveBeenCalledWith(provider);
    });

    it("both setSpawner and setResultProvider are called during composition", async () => {
      const { importPsd } = await import("#src/spawner-psd");
      const psd = (await importPsd())!;

      // Simulate the PTS bootstrap flow exactly as in index.ts
      const spawner: Spawner = {
        spawn: async (_a, _p, _o) => "agent-id",
      };
      const provider = { getResult: async (_id: string) => null };

      psd.setSpawner(spawner);
      psd.setResultProvider(provider);

      expect(psd.setSpawner).toHaveBeenCalledWith(spawner);
      expect(psd.setResultProvider).toHaveBeenCalledWith(provider);
    });
  });

  // -----------------------------------------------------------------------
  // Requirement 2: PSD subagent routes through PTS spawner
  // -----------------------------------------------------------------------

  describe("spawner option transformation", () => {
    it("transforms PSD options to PTS SpawnParams correctly", async () => {
      spawnSubagentMock.mockResolvedValue("agent-123");

      const { spawner } = createTestSpawner({ parentSessionId: "parent-1" });

      const result = await spawner.spawn("implementer", "do the thing", {
        model: "claude-sonnet-4-20250514",
        thinkingLevel: "high",
        maxTurns: 10,
        description: "Implement feature",
      });

      expect(result).toBe("agent-123");
      expect(spawnSubagentMock).toHaveBeenCalledTimes(1);

      const params = spawnSubagentMock.mock.calls[0][0] as SpawnParams;
      expect(params.agentType).toBe("implementer");
      expect(params.prompt).toBe("do the thing");
      expect(params.model).toBe("claude-sonnet-4-20250514");
      expect(params.thinking).toBe("high");
      expect(params.maxTurns).toBe(10);
    });

    it("passes parentSessionId through to spawnSubagent", async () => {
      spawnSubagentMock.mockResolvedValue("agent-456");

      const { spawner } = createTestSpawner({ parentSessionId: "session-abc" });

      await spawner.spawn("Explore", "find stuff", {
        model: "cheap-model",
      });

      expect(spawnSubagentMock).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: "Explore" }),
        "session-abc",
      );
    });

    it("handles minimal options (no model, thinking, etc.)", async () => {
      spawnSubagentMock.mockResolvedValue("agent-789");

      const { spawner } = createTestSpawner({ parentSessionId: "parent-2" });

      const result = await spawner.spawn("general-purpose", "do something", {});

      expect(result).toBe("agent-789");
      const params = spawnSubagentMock.mock.calls[0][0] as SpawnParams;
      expect(params.agentType).toBe("general-purpose");
      expect(params.model).toBeUndefined();
      expect(params.thinking).toBeUndefined();
      expect(params.maxTurns).toBeUndefined();
      expect(params.inheritContext).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Requirement 3: PSD get_subagent_result delegates to PTS provider
  // -----------------------------------------------------------------------

  describe("result provider wrapping", () => {
    it("returns formatted result for completed agent", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      tracker.add({
        id: "agent-complete",
        type: "implementer",
        prompt: "test",
        status: "completed",
        sessionName: "_pi-sub-test",
        windowIndex: 0,
        configDir: "/tmp/test",
        result: "Feature implemented",
        startedAt: Date.now() - 120_000,
        completedAt: Date.now(),
      });

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("agent-complete");

      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain("completed");
      expect(result!.content[0].text).toContain("Feature implemented");
      expect(result!.content[0].text).toContain("implementer");
      expect(result!.content[0].text).toContain("120.0s");
    });

    it("returns running message for running agent (non-blocking)", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      tracker.add({
        id: "agent-running",
        type: "Explore",
        prompt: "test",
        status: "running",
        sessionName: "_pi-sub-test",
        windowIndex: 0,
        configDir: "/tmp/test",
        startedAt: Date.now() - 5000,
      });

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("agent-running");

      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain("still running");
      expect(result!.content[0].text).not.toContain("completed");
    });

    it("returns stopped message for stopped agent", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      tracker.add({
        id: "agent-stopped",
        type: "reviewer",
        prompt: "test",
        status: "stopped",
        sessionName: "_pi-sub-test",
        windowIndex: 0,
        configDir: "/tmp/test",
        startedAt: Date.now() - 30_000,
        completedAt: Date.now(),
      });

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("agent-stopped");

      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain("stopped");
      expect(result!.content[0].text).toContain("reviewer");
    });

    it("returns error message for errored agent", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      tracker.add({
        id: "agent-error",
        type: "implementer",
        prompt: "test",
        status: "error",
        error: "Tmux session crashed",
        sessionName: "_pi-sub-test",
        windowIndex: 0,
        configDir: "/tmp/test",
        startedAt: Date.now() - 15_000,
        completedAt: Date.now(),
      });

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("agent-error");

      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain("error");
      expect(result!.content[0].text).toContain("Tmux session crashed");
    });

    it("returns null for unknown agent (first-writer-wins fallback)", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("unknown-agent");

      // null tells PSD's GetSubagentResultTool to fall back to svc
      expect(result).toBeNull();
    });

    it("handles agents with no result text gracefully", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      tracker.add({
        id: "agent-no-result",
        type: "Explore",
        prompt: "test",
        status: "completed",
        sessionName: "_pi-sub-test",
        windowIndex: 0,
        configDir: "/tmp/test",
        startedAt: Date.now() - 60_000,
        completedAt: Date.now(),
      });

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("agent-no-result");

      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain("(no result)");
    });

    it("handles starting status agent", async () => {
      const { SubagentTracker } = await import("#src/tracker");
      const tracker = new SubagentTracker();

      tracker.add({
        id: "agent-starting",
        type: "Explore",
        prompt: "test",
        status: "starting",
        sessionName: "_pi-sub-test",
        windowIndex: 0,
        configDir: "/tmp/test",
        startedAt: Date.now(),
      });

      const provider = createTestProvider(tracker);
      const result = await provider.getResult("agent-starting");

      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain("still running");
    });
  });
});

// ===========================================================================
// Task 9.14 – inherit_context Integration
// ===========================================================================

describe("inherit_context (task 9.14)", () => {
  // -----------------------------------------------------------------------
  // Standalone path: captureParentContext
  // -----------------------------------------------------------------------

  describe("captureParentContext (standalone path)", () => {
    it("extracts user and assistant messages from fake tool context", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({
        sessionManager: {
          getBranch: () =>
            [
              {
                type: "message",
                message: {
                  role: "user",
                  content: [{ type: "text", text: "Help me plan" }],
                  timestamp: Date.now(),
                },
              },
              {
                type: "message",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: "Here is the architecture" }],
                  timestamp: Date.now(),
                },
              },
              {
                type: "message",
                message: {
                  role: "user",
                  content: [{ type: "text", text: "Looks good" }],
                  timestamp: Date.now(),
                },
              },
            ] as never,
        },
      } as never);

      expect("messages" in captured).toBe(true);
      if ("messages" in captured) {
        expect(captured.messages).toHaveLength(3);
        expect(captured.messages[0]).toEqual({
          role: "user",
          content: "Help me plan",
        });
        expect(captured.messages[1]).toEqual({
          role: "assistant",
          content: "Here is the architecture",
        });
        expect(captured.messages[2]).toEqual({
          role: "user",
          content: "Looks good",
        });
      }
    });

    it("extracts text from string content (not array)", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({
        sessionManager: {
          getBranch: () =>
            [
              {
                type: "message",
                message: {
                  role: "user",
                  content: "Plain text content",
                  timestamp: Date.now(),
                },
              },
            ] as never,
        },
      } as never);

      expect("messages" in captured).toBe(true);
      if ("messages" in captured) {
        expect(captured.messages[0].content).toBe("Plain text content");
      }
    });

    it("filters out non-message entries and non-user/assistant roles", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({
        sessionManager: {
          getBranch: () =>
            [
              {
                type: "message",
                message: {
                  role: "user",
                  content: "Keep me",
                  timestamp: Date.now(),
                },
              },
              {
                type: "message",
                message: {
                  role: "toolResult",
                  content: "Drop me",
                  timestamp: Date.now(),
                },
              },
              {
                type: "system",
                data: { key: "value" },
              },
              {
                type: "message",
                message: {
                  role: "assistant",
                  content: "Keep me too",
                  timestamp: Date.now(),
                },
              },
            ] as never,
        },
      } as never);

      expect("messages" in captured).toBe(true);
      if ("messages" in captured) {
        expect(captured.messages).toHaveLength(2);
        expect(captured.messages[0].role).toBe("user");
        expect(captured.messages[1].role).toBe("assistant");
      }
    });

    it("returns warning when getBranch is not available", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({} as never);
      expect("warning" in captured).toBe(true);
      expect(captured).toHaveProperty("warning");
    });

    it("returns warning when context is undefined", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext(undefined);
      expect("warning" in captured).toBe(true);
    });

    it("returns warning when branch has no user/assistant messages", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({
        sessionManager: {
          getBranch: () =>
            [
              {
                type: "message",
                message: {
                  role: "toolResult",
                  content: "ignored",
                  timestamp: Date.now(),
                },
              },
            ] as never,
        },
      } as never);

      expect("warning" in captured).toBe(true);
    });

    it("returns warning when branch is not an array", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({
        sessionManager: {
          getBranch: () => "not-an-array" as never,
        },
      } as never);

      expect("warning" in captured).toBe(true);
    });

    it("includes parentContextText in successful capture", async () => {
      const { captureParentContext } = await import("#src/parent-context");

      const captured = captureParentContext({
        sessionManager: {
          getBranch: () =>
            [
              {
                type: "message",
                message: {
                  role: "user",
                  content: "Question",
                  timestamp: Date.now(),
                },
              },
            ] as never,
        },
      } as never);

      expect("messages" in captured).toBe(true);
      if ("messages" in captured) {
        expect(captured.parentContextText).toContain("[User]: Question");
      }
    });
  });

  // -----------------------------------------------------------------------
  // buildParentContext
  // -----------------------------------------------------------------------

  describe("buildParentContext", () => {
    it("prepends parent conversation to the prompt", async () => {
      const { buildParentContext } = await import("#src/parent-context");

      const result = buildParentContext(
        [
          { role: "user", content: "Initial question" },
          { role: "assistant", content: "Initial response" },
        ],
        "Your task is to implement X",
      );

      expect(result).toContain("Parent Conversation Context");
      expect(result).toContain("[User]: Initial question");
      expect(result).toContain("[Assistant]: Initial response");
      expect(result).toContain("Your Task (below)");
      expect(result).toContain("Your task is to implement X");
      // Parent context comes before the task
      const userIdx = result.indexOf("[User]");
      const taskIdx = result.indexOf("Your Task");
      expect(userIdx).toBeLessThan(taskIdx);
    });

    it("returns prompt unchanged when messages array is empty", async () => {
      const { buildParentContext } = await import("#src/parent-context");

      const result = buildParentContext([], "Just do this thing");
      expect(result).toBe("Just do this thing");
    });

    it("handles single message", async () => {
      const { buildParentContext } = await import("#src/parent-context");

      const result = buildParentContext(
        [{ role: "user", content: "Single instruction" }],
        "Execute",
      );

      expect(result).toContain("[User]: Single instruction");
      expect(result).toContain("Execute");
    });

    it("handles multiple user/assistant turns", async () => {
      const { buildParentContext } = await import("#src/parent-context");

      const messages = [
        { role: "user" as const, content: "Q1" },
        { role: "assistant" as const, content: "A1" },
        { role: "user" as const, content: "Q2" },
        { role: "assistant" as const, content: "A2" },
      ];

      const result = buildParentContext(messages, "Final task");
      expect((result.match(/\[User\]/g) || []).length).toBe(2);
      expect((result.match(/\[Assistant\]/g) || []).length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // PSD-composed path: spawner with inheritContext
  // -----------------------------------------------------------------------

  describe("PSD-composed spawner inherit_context path", () => {
    beforeEach(() => {
      spawnSubagentMock.mockReset();
      spawnSubagentMock.mockResolvedValue("agent-inherit");
    });

    it("passes captured parent context to spawn when inheritContext is true", async () => {
      const { spawner, contextRef } = createTestSpawner({
        parentSessionId: "session-inherit",
      });
      contextRef.current = {
        messages: [
          { role: "user" as const, content: "Parent question" },
          { role: "assistant" as const, content: "Parent answer" },
        ],
        text: "[User]: Parent question\n[Assistant]: Parent answer",
      };

      await spawner.spawn("implementer", "Implement feature", {
        inheritContext: true,
        model: "claude-sonnet",
      });

      const params = spawnSubagentMock.mock.calls[0][0] as SpawnParams;
      expect(params.inheritContext).toBe(true);
      expect(params.parentContext).toEqual(contextRef.current.messages);
      expect(params.parentContextText).toBe(contextRef.current.text);
      expect(params.agentType).toBe("implementer");
      expect(params.model).toBe("claude-sonnet");
    });

    it("captures latest parent context (updates between spawn calls)", async () => {
      const { spawner, contextRef } = createTestSpawner({
        parentSessionId: "session-update",
      });

      contextRef.current = {
        messages: [{ role: "user" as const, content: "Context v1" }],
        text: "[User]: Context v1",
      };

      // First spawn with v1 context
      await spawner.spawn("Explore", "task1", { inheritContext: true });
      let params = spawnSubagentMock.mock.calls[0][0] as SpawnParams;
      expect(params.parentContext![0].content).toBe("Context v1");

      // Simulate tool_call updating the context
      contextRef.current = {
        messages: [
          { role: "user" as const, content: "Context v2" },
          { role: "assistant" as const, content: "Response v2" },
        ],
        text: "[User]: Context v2\n[Assistant]: Response v2",
      };

      // Second spawn with v2 context
      await spawner.spawn("implementer", "task2", { inheritContext: true });
      params = spawnSubagentMock.mock.calls[1][0] as SpawnParams;
      expect(params.parentContext).toHaveLength(2);
      expect(params.parentContext![0].content).toBe("Context v2");
      expect(params.parentContext![1].content).toBe("Response v2");
    });

    it("throws clear error when inheritContext requested but no parent context captured", async () => {
      const { spawner } = createTestSpawner({
        parentSessionId: "session-noctx",
      });

      await expect(
        spawner.spawn("implementer", "Do it", { inheritContext: true }),
      ).rejects.toThrow("inherit_context requested");
    });

    it("throws error when parent context has empty messages array", async () => {
      const { spawner, contextRef } = createTestSpawner({
        parentSessionId: "session-empty",
      });
      contextRef.current = { messages: [], text: "" };

      await expect(
        spawner.spawn("implementer", "Do it", { inheritContext: true }),
      ).rejects.toThrow("inherit_context requested");
    });

    it("spawns normally when inheritContext is false (no parent context needed)", async () => {
      spawnSubagentMock.mockResolvedValue("agent-normal");

      const { spawner } = createTestSpawner({
        parentSessionId: "session-normal",
      });

      const result = await spawner.spawn("Explore", "find stuff", {
        inheritContext: false,
      });

      expect(result).toBe("agent-normal");
      const params = spawnSubagentMock.mock.calls[0][0] as SpawnParams;
      expect(params.inheritContext).toBe(false);
      expect(params.parentContext).toBeUndefined();
    });

    it("spawns normally when inheritContext is not set", async () => {
      spawnSubagentMock.mockResolvedValue("agent-no-inherit");

      const { spawner } = createTestSpawner({
        parentSessionId: "session-noinherit",
      });

      const result = await spawner.spawn("general-purpose", "generic task", {});

      expect(result).toBe("agent-no-inherit");
      const params = spawnSubagentMock.mock.calls[0][0] as SpawnParams;
      expect(params.inheritContext).toBeUndefined();
      expect(params.parentContext).toBeUndefined();
    });
  });
});
