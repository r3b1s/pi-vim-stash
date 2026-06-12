/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() patterns legit */

import type { SpawnOptions, SubagentsService } from "@gotgenes/pi-subagents";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentManualTool } from "#src/tools/manual";
import type { Spawner } from "#src/tools/spawner";
import { resetSpawner, setSpawner } from "#src/tools/spawner";

// ──────────────────────────────────────────────
// Mock SubagentsService
// ──────────────────────────────────────────────

function createMockSvc(options?: {
  failModels?: string[];
  failAll?: boolean;
}): SubagentsService {
  const failModels = options?.failModels ?? [];
  const failAll = options?.failAll ?? false;

  return {
    spawn: vi.fn((type: string, _prompt: string, opts?: SpawnOptions) => {
      if (failAll) {
        throw new Error("Service unavailable");
      }
      if (opts?.model && failModels.includes(opts.model)) {
        throw new Error(`Model ${opts.model} failed`);
      }
      return `agent-${type}-${Date.now()}`;
    }),
    getRecord: vi.fn(() => undefined),
    listAgents: vi.fn(() => []),
    abort: vi.fn(() => true),
    steer: vi.fn(() => Promise.resolve(true)),
    waitForAll: vi.fn(() => Promise.resolve()),
    hasRunning: vi.fn(() => false),
    registerWorkspaceProvider: vi.fn(() => () => {}),
  };
}

// ──────────────────────────────────────────────
// Tests: Manual tool
// ──────────────────────────────────────────────

describe("SubagentManualTool", () => {
  describe("toToolDefinition", () => {
    it("has correct tool name", () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const def = tool.toToolDefinition();
      expect(def.name).toBe("subagent_manual");
    });

    it("includes model parameter", () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.model).toBeDefined();
    });

    it("includes thinking parameter", () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.thinking).toBeDefined();
    });

    it("includes base subagent parameters but not resume", () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.subagent_type).toBeDefined();
      expect(props.prompt).toBeDefined();
      expect(props.description).toBeDefined();
      expect(props.run_in_background).toBeDefined();
      expect(props.inherit_context).toBeDefined();
      expect(props.max_turns).toBeDefined();
      expect(props.resume).toBeUndefined();
    });
  });

  describe("execute", () => {
    it("passes LLM-provided model and thinking directly to SubagentsService", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Find TODOs",
        description: "Search",
        model: "opus",
        thinking: "xhigh",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Find TODOs",
        expect.objectContaining({
          model: "opus",
          thinkingLevel: "xhigh",
        }),
      );
    });

    it("bypasses model-routing.yml (no config needed)", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
        model: "custom-model",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
    });

    it("returns error when called without model and without thinking", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
      });
      expect(result.content[0].text).toBe(
        "subagent_manual requires at least model or thinking. Use subagent for automatic routing.",
      );
    });

    it("works with only model (no thinking)", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
        model: "haiku",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Test",
        expect.objectContaining({ model: "haiku" }),
      );
    });

    it("works with only thinking (no model)", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
        thinking: "high",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Test",
        expect.objectContaining({ thinkingLevel: "high" }),
      );
    });

    it("returns error when SubagentsService is undefined and no custom spawner", async () => {
      const tool = new SubagentManualTool(undefined);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
        model: "haiku",
      });
      expect(result.content[0].text).toContain("No spawn mechanism available");
    });

    it("passes run_in_background as foreground:false to spawn", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      await tool.execute({
        subagent_type: "Explore",
        prompt: "Background task",
        description: "Bg task",
        model: "haiku",
        run_in_background: true,
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Background task",
        expect.objectContaining({ foreground: false }),
      );
    });
  });
});

// ──────────────────────────────────────────────
// Tests: Spawner system
// ──────────────────────────────────────────────

describe("Spawner system", () => {
  afterEach(() => {
    resetSpawner();
  });

  it("default spawner delegates to svc.spawn() when no custom spawner set", async () => {
    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Find TODOs",
      description: "Search",
      model: "haiku",
    });
    expect(result.content[0].text).toMatch(/^agent-/);
    expect(svc.spawn).toHaveBeenCalledWith(
      "Explore",
      "Find TODOs",
      expect.objectContaining({ model: "haiku" }),
    );
  });

  it("setSpawner() overrides default spawner — custom spawner is called", async () => {
    const customSpawner: Spawner = {
      spawn: vi.fn(
        (_agentType: string, _prompt: string, _options: SpawnOptions) =>
          "custom-agent-id",
      ),
    };
    setSpawner(customSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Find TODOs",
      description: "Search",
      model: "haiku",
    });

    expect(result.content[0].text).toBe("custom-agent-id");
    // svc.spawn should NOT have been called
    expect(svc.spawn).not.toHaveBeenCalled();
    // Custom spawner should have been called
    expect(customSpawner.spawn).toHaveBeenCalledWith(
      "Explore",
      "Find TODOs",
      expect.objectContaining({ model: "haiku" }),
    );
  });

  it("setSpawner() can be called multiple times — latest spawner wins", async () => {
    const firstSpawner: Spawner = {
      spawn: vi.fn(() => "first-agent-id"),
    };
    const secondSpawner: Spawner = {
      spawn: vi.fn(() => "second-agent-id"),
    };
    setSpawner(firstSpawner);
    setSpawner(secondSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
      model: "haiku",
    });

    expect(result.content[0].text).toBe("second-agent-id");
    expect(firstSpawner.spawn).not.toHaveBeenCalled();
    expect(secondSpawner.spawn).toHaveBeenCalledTimes(1);
  });

  it("no-op spawner returns error when neither svc nor custom spawner is available", async () => {
    // No setSpawner call, no svc
    const tool = new SubagentManualTool(undefined);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
      model: "haiku",
    });
    expect(result.content[0].text).toBe(
      "No spawn mechanism available. Install @gotgenes/pi-subagents or pi-tmux-sessionizer.",
    );
  });

  it("sync spawner (string return) satisfies Spawner interface", async () => {
    const syncSpawner: Spawner = {
      spawn: (_agentType: string, _prompt: string, _options: SpawnOptions) =>
        "sync-agent-id",
    };
    setSpawner(syncSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "implementer",
      prompt: "Sync test",
      description: "Sync",
      model: "haiku",
    });
    expect(result.content[0].text).toBe("sync-agent-id");
  });

  it("async spawner (Promise<string>) satisfies Spawner interface", async () => {
    const asyncSpawner: Spawner = {
      spawn: (_agentType: string, _prompt: string, _options: SpawnOptions) =>
        Promise.resolve("async-agent-id"),
    };
    setSpawner(asyncSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "implementer",
      prompt: "Async test",
      description: "Async",
      model: "haiku",
    });
    expect(result.content[0].text).toBe("async-agent-id");
  });

  it("spawner that throws is caught and error returned from execute", async () => {
    const throwingSpawner: Spawner = {
      spawn: () => {
        throw new Error("Spawner crashed");
      },
    };
    setSpawner(throwingSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Test throw",
      description: "Throw test",
      model: "cheap-model",
    });
    expect(result.content[0].text).toContain("Failed to spawn agent");
  });

  it("spawner that rejects is caught and error returned from execute", async () => {
    const rejectingSpawner: Spawner = {
      spawn: () => Promise.reject(new Error("Spawner rejected")),
    };
    setSpawner(rejectingSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Test reject",
      description: "Reject test",
      model: "cheap-model",
    });
    expect(result.content[0].text).toContain("Failed to spawn agent");
  });

  it("subagent_manual routes through custom spawner when set", async () => {
    const customSpawner: Spawner = {
      spawn: vi.fn(
        (_agentType: string, _prompt: string, _options: SpawnOptions) =>
          "manual-agent-id",
      ),
    };
    setSpawner(customSpawner);

    const svc = createMockSvc();
    const tool = new SubagentManualTool(svc);
    const result = await tool.execute({
      subagent_type: "Explore",
      prompt: "Manual test",
      description: "Manual",
      model: "haiku",
    });

    expect(result.content[0].text).toBe("manual-agent-id");
    expect(svc.spawn).not.toHaveBeenCalled();
    expect(customSpawner.spawn).toHaveBeenCalledWith(
      "Explore",
      "Manual test",
      expect.objectContaining({ model: "haiku" }),
    );
  });
});
