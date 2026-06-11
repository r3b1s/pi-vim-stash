/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() patterns legit */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnOptions, SubagentsService } from "@gotgenes/pi-subagents";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentDeterministicTool } from "#src/tools/deterministic";
import { GetSubagentResultTool } from "#src/tools/get-result";
import { SubagentManualTool } from "#src/tools/manual";

// ──────────────────────────────────────────────
// Temp directory helpers
// ──────────────────────────────────────────────

let tempDir = "";

function createTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  const agentDir = join(tempDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  return tempDir;
}

function writeRouting(yaml: string): void {
  writeFileSync(join(tempDir, "agent", "model-routing.yml"), yaml, "utf-8");
}

function cleanupTempDir(): void {
  if (tempDir) {
    rmSync(tempDir, { recursive: true });
  }
}

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
// Sample YAML config (new direct-match role keys)
// ──────────────────────────────────────────────

const SAMPLE_YAML = [
  "roles:",
  "  Explore:",
  "    thinking: low",
  "    models:",
  "      - cheap-model",
  "      - fallback-cheap",
  "  implementer:",
  "    thinking: high",
  "    models:",
  "      - primary-model",
  "      - fallback-model",
  "  reviewer:",
  "    thinking: high",
  "    models:",
  "      - gpt-5.5",
  "      - opus:",
  "          thinking: xhigh",
  "      - deepseek-v4-pro",
  "  general-purpose:",
  "    models:",
  "      - cheap-model",
].join("\n");

// ──────────────────────────────────────────────
// Tests: Deterministic tool
// ──────────────────────────────────────────────

describe("SubagentDeterministicTool", () => {
  beforeEach(() => {
    createTempDir();
    writeRouting(SAMPLE_YAML);
  });

  afterEach(() => {
    cleanupTempDir();
  });

  describe("toToolDefinition", () => {
    it("has correct tool name", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      expect(def.name).toBe("subagent");
    });

    it("excludes model and thinking from parameters", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      // The schema object is a TypeBox type, check the static inferred keys
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.model).toBeUndefined();
      expect(props.thinking).toBeUndefined();
    });

    it("includes required parameters (subagent_type, prompt, description)", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.subagent_type).toBeDefined();
      expect(props.prompt).toBeDefined();
      expect(props.description).toBeDefined();
    });

    it("includes optional parameters (run_in_background, inherit_context, max_turns)", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.run_in_background).toBeDefined();
      expect(props.inherit_context).toBeDefined();
      expect(props.max_turns).toBeDefined();
      expect(props.resume).toBeUndefined();
    });

    it("description contains agent-selection guidance", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      expect(def.description).toContain("Explore");
      expect(def.description).toContain("implementer");
      expect(def.description).toContain("websearch");
    });

    it("description does NOT contain model names", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      expect(def.description).not.toContain("cheap-model");
      expect(def.description).not.toContain("gpt-5.5");
      expect(def.description).not.toContain("opus");
    });

    it("description does NOT contain thinking levels", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      expect(def.description).not.toContain("xhigh");
      expect(def.description).not.toContain("low");
    });

    it("description mentions non-blocking get_subagent_result", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      expect(def.description).toContain("non-blocking");
      expect(def.description).toContain("get_subagent_result");
    });
  });

  describe("execute", () => {
    it("returns agent ID on successful spawn", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Find stale TODOs",
        description: "Search TODOs",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Find stale TODOs",
        expect.objectContaining({
          model: "cheap-model",
          thinkingLevel: "low",
        }),
      );
    });

    it("maps thinking to thinkingLevel internally", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      await tool.execute({
        subagent_type: "implementer",
        prompt: "Implement feature",
        description: "Implement",
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "implementer",
        "Implement feature",
        expect.objectContaining({
          model: "primary-model",
          thinkingLevel: "high",
        }),
      );
    });

    it("iterates model list on spawn failure (first fails, second succeeds)", async () => {
      const svc = createMockSvc({ failModels: ["cheap-model"] });
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Find TODOs",
        description: "Search",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      // First call failed (cheap-model), second succeeded (fallback-cheap)
      expect(svc.spawn).toHaveBeenCalledTimes(2);
      expect(svc.spawn).toHaveBeenNthCalledWith(
        1,
        "Explore",
        "Find TODOs",
        expect.objectContaining({ model: "cheap-model" }),
      );
      expect(svc.spawn).toHaveBeenNthCalledWith(
        2,
        "Explore",
        "Find TODOs",
        expect.objectContaining({ model: "fallback-cheap" }),
      );
    });

    it("returns error when all models fail", async () => {
      const svc = createMockSvc({ failAll: true });
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Find TODOs",
        description: "Search",
      });
      expect(result.content[0].text).toContain(
        "All models failed for agent type Explore",
      );
      expect(result.content[0].text).toContain(
        "tried cheap-model, fallback-cheap",
      );
    });

    it("returns error for empty models list", async () => {
      const svc = createMockSvc();
      writeRouting(
        ["roles:", "  Explore:", "    thinking: low", "    models: []"].join(
          "\n",
        ),
      );
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Find TODOs",
        description: "Search",
      });
      expect(result.content[0].text).toContain("No models configured for role");
    });

    it("returns error for unknown agent type", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "custom-agent",
        prompt: "Do something",
        description: "Custom task",
      });
      expect(result.content[0].text).toContain(
        "No routing config found for agent type custom-agent",
      );
    });

    it("returns error when missing subagent_type or prompt", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        description: "Missing required fields",
      });
      expect(result.content[0].text).toContain(
        "subagent_type and prompt are required",
      );
    });

    it("returns error when SubagentsService is undefined", async () => {
      const tool = new SubagentDeterministicTool(tempDir, undefined);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Find TODOs",
        description: "Search",
      });
      expect(result.content[0].text).toContain(
        "SubagentsService not available",
      );
    });

    it("passes run_in_background as foreground:false to spawn", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      await tool.execute({
        subagent_type: "Explore",
        prompt: "Background task",
        description: "Bg task",
        run_in_background: true,
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Background task",
        expect.objectContaining({ foreground: false }),
      );
    });

    it("passes run_in_background:false as foreground:true to spawn", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      await tool.execute({
        subagent_type: "Explore",
        prompt: "Foreground task",
        description: "Fg task",
        run_in_background: false,
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Foreground task",
        expect.objectContaining({ foreground: true }),
      );
    });

    it("does not pass foreground when run_in_background is not set", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      await tool.execute({
        subagent_type: "Explore",
        prompt: "Normal task",
        description: "Normal",
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "Explore",
        "Normal task",
        expect.not.objectContaining({ foreground: expect.anything() }),
      );
    });

    it("uses per-model thinking override when applicable", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      // reviewer has per-model thinking override on opus
      // But our first model is gpt-5.5 (role default: high)
      await tool.execute({
        subagent_type: "reviewer",
        prompt: "Review code",
        description: "Code review",
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "reviewer",
        "Review code",
        expect.objectContaining({
          model: "gpt-5.5",
          thinkingLevel: "high",
        }),
      );
    });

    it("returns error for missing config file", async () => {
      // Use a non-existent directory
      const badDir = "/tmp/nonexistent-dir-12345";
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(badDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
      });
      expect(result.content[0].text).toContain("not found");
    });
  });
});

// ──────────────────────────────────────────────
// Tests: GetSubagentResultTool
// ──────────────────────────────────────────────

describe("GetSubagentResultTool", () => {
  describe("toToolDefinition", () => {
    it("has correct tool name", () => {
      const svc = createMockSvc();
      const tool = new GetSubagentResultTool(svc);
      const def = tool.toToolDefinition();
      expect(def.name).toBe("get_subagent_result");
    });

    it("includes required agent_id parameter", () => {
      const svc = createMockSvc();
      const tool = new GetSubagentResultTool(svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.agent_id).toBeDefined();
    });

    it("includes optional wait parameter", () => {
      const svc = createMockSvc();
      const tool = new GetSubagentResultTool(svc);
      const def = tool.toToolDefinition();
      const schema = def.parameters as { properties?: Record<string, unknown> };
      const props = schema.properties ?? {};
      expect(props.wait).toBeDefined();
    });

    it("description mentions non-blocking behavior", () => {
      const svc = createMockSvc();
      const tool = new GetSubagentResultTool(svc);
      const def = tool.toToolDefinition();
      expect(def.description).toContain("non-blocking");
      expect(def.description).toContain("returns immediately");
    });
  });

  describe("execute", () => {
    it("returns running message for running agent (non-blocking)", async () => {
      const svc = createMockSvc();
      // Override getRecord to return a running agent
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "running" as const,
        toolUses: 5,
        startedAt: Date.now() - 10000,
        lifetimeUsage: { input: 100, output: 50, cacheWrite: 10 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({
        agent_id: "agent-abc",
        wait: true,
      });
      expect(result.content[0].text).toContain("still running");
      expect(result.content[0].text).toContain("get_subagent_result");
    });

    it("returns running message for queued agent", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "queued" as const,
        toolUses: 0,
        startedAt: Date.now() - 5000,
        lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("still running");
    });

    it("returns result for completed agent", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "completed" as const,
        result: "Task completed successfully",
        toolUses: 10,
        startedAt: Date.now() - 60000,
        completedAt: Date.now(),
        lifetimeUsage: { input: 500, output: 200, cacheWrite: 50 },
        compactionCount: 1,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("completed");
      expect(result.content[0].text).toContain("Task completed successfully");
      expect(result.content[0].text).toContain("500");
      expect(result.content[0].text).toContain("200");
    });

    it("returns status for steered agent (terminal)", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "steered" as const,
        result: "Steered to new direction",
        toolUses: 5,
        startedAt: Date.now() - 60000,
        completedAt: Date.now(),
        lifetimeUsage: { input: 200, output: 100, cacheWrite: 0 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("steered");
      expect(result.content[0].text).toContain("Steered to new direction");
      // steered is terminal — should NOT say "still running"
      expect(result.content[0].text).not.toContain("still running");
    });

    it("returns status for aborted agent", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "aborted" as const,
        result: "Aborted",
        toolUses: 3,
        startedAt: Date.now() - 30000,
        completedAt: Date.now(),
        lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("aborted");
      expect(result.content[0].text).toContain("Aborted");
    });

    it("returns status for stopped agent", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "stopped" as const,
        result: "Stopped by user",
        toolUses: 2,
        startedAt: Date.now() - 20000,
        completedAt: Date.now(),
        lifetimeUsage: { input: 50, output: 25, cacheWrite: 0 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("stopped");
      expect(result.content[0].text).toContain("Stopped by user");
    });

    it("returns error for errored agent", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "error" as const,
        error: "Something went wrong",
        toolUses: 1,
        startedAt: Date.now() - 15000,
        completedAt: Date.now(),
        lifetimeUsage: { input: 10, output: 5, cacheWrite: 0 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("error");
      expect(result.content[0].text).toContain("Something went wrong");
    });

    it("returns error for unknown agent ID", async () => {
      const svc = createMockSvc();
      // getRecord returns undefined by default
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "nonexistent" });
      expect(result.content[0].text).toContain("Agent not found");
      expect(result.content[0].text).toContain("nonexistent");
    });

    it("ignores wait parameter (always non-blocking)", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockReturnValue({
        id: "agent-abc",
        type: "Explore",
        description: "Test agent",
        status: "running" as const,
        toolUses: 1,
        startedAt: Date.now() - 10000,
        lifetimeUsage: { input: 10, output: 5, cacheWrite: 0 },
        compactionCount: 0,
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({
        agent_id: "agent-abc",
        wait: true,
      });
      // Should return immediately without blocking
      expect(result.content[0].text).toContain("still running");
    });

    it("requires agent_id", async () => {
      const svc = createMockSvc();
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({});
      expect(result.content[0].text).toContain("agent_id is required");
    });

    it("handles getRecord throwing error", async () => {
      const svc = createMockSvc();
      (svc.getRecord as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Service unavailable");
      });
      const tool = new GetSubagentResultTool(svc);
      const result = await tool.execute({ agent_id: "agent-abc" });
      expect(result.content[0].text).toContain("Error retrieving agent record");
    });
  });
});

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

    it("returns error when SubagentsService is undefined", async () => {
      const tool = new SubagentManualTool(undefined);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test",
        description: "Test",
        model: "haiku",
      });
      expect(result.content[0].text).toContain(
        "SubagentsService not available",
      );
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
// Integration tests
// ──────────────────────────────────────────────

describe("Integration", () => {
  beforeEach(() => {
    createTempDir();
    writeRouting(SAMPLE_YAML);
  });

  afterEach(() => {
    cleanupTempDir();
  });

  describe("Model fallback with SubagentsService", () => {
    it("returns agent ID after first model succeeds", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test task",
        description: "Test",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      expect(svc.spawn).toHaveBeenCalledTimes(1);
    });

    it("falls back to second model when first fails", async () => {
      const svc = createMockSvc({ failModels: ["cheap-model"] });
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test task",
        description: "Test",
      });
      expect(result.content[0].text).toMatch(/^agent-/);
      expect(svc.spawn).toHaveBeenCalledTimes(2);
    });

    it("reports error when all models fail", async () => {
      const svc = createMockSvc({ failAll: true });
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const result = await tool.execute({
        subagent_type: "Explore",
        prompt: "Test task",
        description: "Test",
      });
      expect(result.content[0].text).toContain(
        "All models failed for agent type Explore",
      );
    });
  });

  describe("tools are registered and visible", () => {
    it("deterministic tool has correct name", () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      const def = tool.toToolDefinition();
      expect(def.name).toBe("subagent");
    });

    it("get_subagent_result tool has correct name", () => {
      const svc = createMockSvc();
      const tool = new GetSubagentResultTool(svc);
      const def = tool.toToolDefinition();
      expect(def.name).toBe("get_subagent_result");
    });

    it("manual tool has correct name", () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      const def = tool.toToolDefinition();
      expect(def.name).toBe("subagent_manual");
    });

    it("all tools have distinct names", () => {
      const svc = createMockSvc();
      const detTool = new SubagentDeterministicTool(tempDir, svc);
      const getResultTool = new GetSubagentResultTool(svc);
      const manTool = new SubagentManualTool(svc);
      const names = [
        detTool.toToolDefinition().name,
        getResultTool.toToolDefinition().name,
        manTool.toToolDefinition().name,
      ];
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it("manual tool passes LLM-provided params correctly", async () => {
      const svc = createMockSvc();
      const tool = new SubagentManualTool(svc);
      await tool.execute({
        subagent_type: "implementer",
        prompt: "Build feature",
        description: "Build",
        model: "gpt-5.5",
        thinking: "high",
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "implementer",
        "Build feature",
        expect.objectContaining({
          model: "gpt-5.5",
          thinkingLevel: "high",
        }),
      );
    });

    it("deterministic tool resolves model and thinking from config", async () => {
      const svc = createMockSvc();
      const tool = new SubagentDeterministicTool(tempDir, svc);
      await tool.execute({
        subagent_type: "implementer",
        prompt: "Implement feature",
        description: "Implement",
      });
      expect(svc.spawn).toHaveBeenCalledWith(
        "implementer",
        "Implement feature",
        expect.objectContaining({
          model: "primary-model",
          thinkingLevel: "high",
        }),
      );
    });
  });

  describe("js-yaml parsing of new format", () => {
    it("parses per-model thinking overrides via js-yaml", () => {
      // This is an end-to-end test of the config pipeline
      const parsed = load(SAMPLE_YAML) as Record<string, unknown>;
      const roles = parsed.roles as Record<string, unknown>;
      const reviewer = roles.reviewer as Record<string, unknown>;
      const models = reviewer.models as Array<unknown>;
      expect(models.length).toBe(3);
      expect(models[1]).toEqual({ opus: { thinking: "xhigh" } });
    });
  });
});
