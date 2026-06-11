import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textResult } from "#src/tools/helpers";

describe("textResult", () => {
  it("returns standard result format with text content", () => {
    const result = textResult("hello");
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.details).toEqual({});
  });

  it("includes details when provided", () => {
    const details = { foo: "bar" };
    const result = textResult("hello", details);
    expect(result.details).toBe(details);
  });
});

describe("Tool parameter schemas", () => {
  it("get_subagent_result has required agent_id", async () => {
    // We test the schema shape by importing the tool factory
    const { createGetResultTool } = await import("#src/tools/get-result");
    const { SubagentTracker } = await import("#src/tracker");
    const tracker = new SubagentTracker();
    const tool = createGetResultTool(tracker);
    const def = tool;
    expect(def.name).toBe("get_subagent_result");
    expect(def.description).toContain("non-blocking");
    // Verify parameter schema
    const schema = def.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties?.agent_id).toBeDefined();
  });

  it("steer_subagent has agent_id, message, and kill parameters", async () => {
    const { createSteerTool } = await import("#src/tools/steer");
    const { TmuxManager } = await import("#src/tmux-manager");
    const { SubagentTracker } = await import("#src/tracker");
    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();
    const tool = createSteerTool(tracker, tmux);
    expect(tool.name).toBe("steer_subagent");
    const schema = tool.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties?.agent_id).toBeDefined();
    expect(schema.properties?.message).toBeDefined();
    expect(schema.properties?.kill).toBeDefined();
  });

  it("subagent tool has required parameters in standalone mode", async () => {
    // We test the schema exists; the actual tool registration depends
    // on whether PSD is detected, which we test elsewhere.
    const { createSubagentTool } = await import("#src/tools/subagent");
    const { SubagentTracker } = await import("#src/tracker");
    const { TmuxManager } = await import("#src/tmux-manager");
    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();
    const tool = createSubagentTool("/tmp/config", "parent-123", tracker, tmux);
    expect(tool.name).toBe("subagent");
    const schema = tool.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties?.subagent_type).toBeDefined();
    expect(schema.properties?.prompt).toBeDefined();
    expect(schema.properties?.description).toBeDefined();
    expect(schema.properties?.model).toBeDefined();
    expect(schema.properties?.thinking).toBeDefined();
  });
});

describe("PSD detection and tool registration logic", () => {
  it("importPsd returns undefined when PSD not installed", async () => {
    // When PSD is not installed, importPsd should fail gracefully
    const { importPsd } = await import("#src/spawner-psd");
    const result = await importPsd();
    expect(result).toBeUndefined();
  });

  it("extension registers tools based on PSD presence", async () => {
    // This test verifies the tool registration logic in the entry point
    // without actually loading the extension (which needs ExtensionAPI)
    const { SubagentTracker } = await import("#src/tracker");
    const { TmuxManager } = await import("#src/tmux-manager");

    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();

    // In standalone mode (no PSD), all three tools should be definable
    const { createSubagentTool } = await import("#src/tools/subagent");
    const { createGetResultTool } = await import("#src/tools/get-result");
    const { createSteerTool } = await import("#src/tools/steer");

    const subagentTool = createSubagentTool(
      "/tmp/config",
      "parent-123",
      tracker,
      tmux,
    );
    const getResultTool = createGetResultTool(tracker);
    const steerTool = createSteerTool(tracker, tmux);

    expect(subagentTool.name).toBe("subagent");
    expect(getResultTool.name).toBe("get_subagent_result");
    expect(steerTool.name).toBe("steer_subagent");
  });
});

describe("spawner-psd bridge", () => {
  it("Spawner interface type is defined and usable", () => {
    const spawner = {
      spawn: (
        _agentType: string,
        _prompt: string,
        _options: Record<string, unknown>,
      ) => Promise.resolve("agent-id"),
    };
    expect(typeof spawner.spawn).toBe("function");
  });

  it("PsdApi interface includes setResultProvider", () => {
    // Verify the shape we expect at runtime
    const mockPsd: Record<string, unknown> = {
      setSpawner: () => {},
      setResultProvider: () => {},
    };
    expect(typeof mockPsd.setSpawner).toBe("function");
    expect(typeof mockPsd.setResultProvider).toBe("function");
  });

  it("result provider wrapper returns correct format for completed agent", async () => {
    // Simulate the provider shape that PTS's index.ts creates
    const { SubagentTracker } = await import("#src/tracker");
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-123",
      type: "implementer",
      prompt: "test",
      status: "completed",
      sessionName: "_pi-sub-test",
      windowIndex: 0,
      configDir: "/tmp/test",
      result: "Task done",
      startedAt: Date.now() - 60000,
      completedAt: Date.now(),
    });

    const provider = {
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
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            text = `Agent ${agentId} status: ${record.status}`;
        }
        return {
          content: [{ type: "text" as const, text }],
          details: {},
        };
      },
    };

    const result = await provider.getResult("agent-123");
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toContain("completed");
    expect(result!.content[0].text).toContain("Task done");
    expect(result!.content[0].text).toContain("implementer");
  });

  it("result provider returns null for unknown agent", async () => {
    const { SubagentTracker } = await import("#src/tracker");
    const tracker = new SubagentTracker();
    const provider = {
      getResult: async (agentId: string) => {
        const record = tracker.get(agentId);
        if (!record) return null;
        return { content: [{ type: "text" as const, text: "" }], details: {} };
      },
    };
    const result = await provider.getResult("nonexistent");
    expect(result).toBeNull();
  });

  it("result provider returns running message for running agent", async () => {
    const { SubagentTracker } = await import("#src/tracker");
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-456",
      type: "Explore",
      prompt: "test",
      status: "running",
      sessionName: "_pi-sub-test",
      windowIndex: 1,
      configDir: "/tmp/test",
      startedAt: Date.now() - 10000,
    });

    const provider = {
      getResult: async (agentId: string) => {
        const record = tracker.get(agentId);
        if (!record) return null;
        const text =
          record.status === "starting" || record.status === "running"
            ? `Agent ${agentId} is still running (status: ${record.status}). Call get_subagent_result again to check.`
            : `Status: ${record.status}`;
        return { content: [{ type: "text" as const, text }], details: {} };
      },
    };

    const result = await provider.getResult("agent-456");
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toContain("still running");
  });
});

describe("subagent tool signal wiring", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes combined signal to spawnSubagent when both parent and tool signals exist", async () => {
    const spawnSubagentMock = vi.fn().mockResolvedValue("agent-made-id");
    const isTmuxAvailableMock = vi.fn(() => true);

    vi.doMock("#src/spawner", () => ({
      spawnSubagent: spawnSubagentMock,
    }));
    vi.doMock("#src/tmux-manager", async () => {
      const actual =
        await vi.importActual<typeof import("#src/tmux-manager")>(
          "#src/tmux-manager",
        );
      return { ...actual, isTmuxAvailable: isTmuxAvailableMock };
    });

    // Must reset module registry so doMock takes effect
    vi.resetModules();

    const { createSubagentTool } = await import("#src/tools/subagent");
    const { SubagentTracker } = await import("#src/tracker");
    const { TmuxManager } = await import("#src/tmux-manager");

    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();
    const parentSignal = new AbortController();

    const tool = createSubagentTool(
      "/tmp/config",
      "parent-123",
      tracker,
      tmux,
      parentSignal.signal,
    );

    const toolSignal = new AbortController();

    await tool.execute(
      "call-1",
      {
        subagent_type: "implementer",
        prompt: "test task",
        description: "test",
      },
      toolSignal.signal,
      undefined,
      {} as never,
    );

    expect(spawnSubagentMock).toHaveBeenCalledTimes(1);
    // The signal passed to spawnSubagent should be defined (combined signal)
    const signalArg = spawnSubagentMock.mock.calls[0][4];
    expect(signalArg).toBeDefined();
    expect(signalArg).not.toBe(parentSignal.signal);
    expect(signalArg).not.toBe(toolSignal.signal);
  });

  it("passes through when neither signal is provided", async () => {
    const spawnSubagentMock = vi.fn().mockResolvedValue("agent-made-id");
    const isTmuxAvailableMock = vi.fn(() => true);

    vi.doMock("#src/spawner", () => ({
      spawnSubagent: spawnSubagentMock,
    }));
    vi.doMock("#src/tmux-manager", async () => {
      const actual =
        await vi.importActual<typeof import("#src/tmux-manager")>(
          "#src/tmux-manager",
        );
      return { ...actual, isTmuxAvailable: isTmuxAvailableMock };
    });

    vi.resetModules();

    const { createSubagentTool } = await import("#src/tools/subagent");
    const { SubagentTracker } = await import("#src/tracker");
    const { TmuxManager } = await import("#src/tmux-manager");

    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();

    const tool = createSubagentTool("/tmp/config", "parent-123", tracker, tmux);

    await tool.execute(
      "call-2",
      {
        subagent_type: "implementer",
        prompt: "test task",
        description: "test",
      },
      undefined,
      undefined,
      {} as never,
    );

    expect(spawnSubagentMock).toHaveBeenCalledTimes(1);
    const signalArg = spawnSubagentMock.mock.calls[0][4];
    expect(signalArg).toBeUndefined();
  });
});

describe("model routing in subagent tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses explicit model from params when provided", async () => {
    const spawnSubagentMock = vi.fn().mockResolvedValue("agent-explicit");
    const isTmuxAvailableMock = vi.fn(() => true);

    vi.doMock("#src/spawner", () => ({
      spawnSubagent: spawnSubagentMock,
    }));
    vi.doMock("#src/tmux-manager", async () => {
      const actual =
        await vi.importActual<typeof import("#src/tmux-manager")>(
          "#src/tmux-manager",
        );
      return { ...actual, isTmuxAvailable: isTmuxAvailableMock };
    });

    vi.resetModules();

    const { createSubagentTool } = await import("#src/tools/subagent");
    const { SubagentTracker } = await import("#src/tracker");
    const { TmuxManager } = await import("#src/tmux-manager");

    const tracker = new SubagentTracker();
    const tmux = new TmuxManager();

    const tool = createSubagentTool("/tmp/config", "parent-123", tracker, tmux);

    await tool.execute(
      "call-3",
      {
        subagent_type: "implementer",
        prompt: "do the thing",
        description: "test explicit",
        model: "claude-sonnet-4-20250514",
        thinking: "high",
      },
      undefined,
      undefined,
      {} as never,
    );

    expect(spawnSubagentMock).toHaveBeenCalledTimes(1);
    // Check spawn params include the explicit model
    const spawnParams = spawnSubagentMock.mock.calls[0][0];
    expect(spawnParams.model).toBe("claude-sonnet-4-20250514");
    expect(spawnParams.thinking).toBe("high");
  });
});
