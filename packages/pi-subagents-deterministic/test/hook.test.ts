/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() patterns legit */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "#src/config";
import { SubagentCallRouter } from "#src/hook";
import {
  resetResultProvider,
  setResultProvider,
} from "#src/tools/result-provider";
import type { Spawner } from "#src/tools/spawner";
import { resetSpawner, setSpawner } from "#src/tools/spawner";

// ──────────────────────────────────────────────
// Temp directory helpers
// ──────────────────────────────────────────────

let tempDir = "";

function createTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-subagents-hook-test-"));
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

function createRouter(): SubagentCallRouter {
  return new SubagentCallRouter(tempDir);
}

// ──────────────────────────────────────────────
// Sample YAML config
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
// Hook: no-op scenarios
// ──────────────────────────────────────────────

describe("SubagentCallRouter", () => {
  beforeEach(() => {
    createTempDir();
    writeRouting(SAMPLE_YAML);
  });

  afterEach(() => {
    cleanupTempDir();
    resetSpawner();
    resetResultProvider();
  });

  // ── 4.2 ─────────────────────────────────────

  it("does not mutate input when event.toolName !== 'subagent'", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-1",
      toolName: "bash",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBeUndefined();
    expect(input.thinking).toBeUndefined();
  });

  // ── 4.3 ─────────────────────────────────────

  it("does not mutate input when event.toolName === 'subagent_manual'", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-2",
      toolName: "subagent_manual",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBeUndefined();
    expect(input.thinking).toBeUndefined();
  });

  // ── 4.16 ────────────────────────────────────

  it("is no-op when event.input.subagent_type is missing", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      prompt: "test",
      description: "desc",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-3",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBeUndefined();
    expect(input.thinking).toBeUndefined();
  });

  // ──────────────────────────────────────────────
  // Model and thinking resolution
  // ──────────────────────────────────────────────

  // ── 4.4 ─────────────────────────────────────

  it("sets model and thinking from first model and role-level thinking", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Find stale TODOs",
      description: "Search TODOs",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-4",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBe("cheap-model");
    expect(input.thinking).toBe("low");
  });

  // ── 4.5 ─────────────────────────────────────

  it("matches case-insensitively and sets model/thinking", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "EXPLORE",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-5",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBe("cheap-model");
    expect(input.thinking).toBe("low");
  });

  // ── 4.6 ─────────────────────────────────────

  it("applies per-model thinking override when first model has override", () => {
    // Write a YAML where the first model has a per-model thinking override
    writeRouting(
      [
        "roles:",
        "  reviewer:",
        "    thinking: high",
        "    models:",
        "      - opus:",
        "          thinking: xhigh",
        "      - gpt-5.5",
      ].join("\n"),
    );

    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "reviewer",
      prompt: "Review code",
      description: "Code review",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-6",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBe("opus");
    expect(input.thinking).toBe("xhigh");
  });

  // ── 4.7 ─────────────────────────────────────

  it("overwrites LLM-provided model and thinking with config values", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "implementer",
      prompt: "Implement feature",
      description: "Implement",
      model: "haiku",
      thinking: "low",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-7",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(input.model).toBe("primary-model");
    expect(input.thinking).toBe("high");
  });

  // ──────────────────────────────────────────────
  // Config error blocking
  // ──────────────────────────────────────────────

  // ── 4.8 ─────────────────────────────────────

  it("blocks with correct reason when YAML is missing", () => {
    // Use a non-existent directory
    const missingDir = "/tmp/nonexistent-hook-test-12345";
    const router = new SubagentCallRouter(missingDir);
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-8",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toEqual({
      block: true,
      reason:
        "Model routing config not found at /tmp/nonexistent-hook-test-12345/agent/model-routing.yml",
    });
  });

  // ── 4.9 ─────────────────────────────────────

  it("blocks with correct reason when YAML is invalid", () => {
    writeRouting("  invalid yaml: [\n  broken");
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-9",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("Failed to parse model-routing.yml:"),
    });
  });

  // ── 4.10 ────────────────────────────────────

  it("blocks with correct reason for unknown agent type", () => {
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "custom-agent",
      prompt: "Do something",
      description: "Custom task",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-10",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toEqual({
      block: true,
      reason:
        "No routing config found for agent type custom-agent. Add a role entry to model-routing.yml.",
    });
  });

  // ── 4.11 ────────────────────────────────────

  it("blocks with correct reason for empty models list", () => {
    writeRouting(
      ["roles:", "  Explore:", "    thinking: low", "    models: []"].join(
        "\n",
      ),
    );
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-11",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toEqual({
      block: true,
      reason: "No models configured for role: Explore.",
    });
  });

  // ── 4.12 ────────────────────────────────────

  it("blocks with internal error reason for uncaught exceptions", () => {
    // Force an uncaught exception by making readModelRouting throw.
    // The hook wraps its logic in try/catch and returns
    // { block: true, reason: "Internal routing error: ..." }
    vi.spyOn(configModule, "readModelRouting").mockImplementation(() => {
      throw new Error("Unexpected failure");
    });

    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-12",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining("Internal routing error:"),
    });

    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────
  // Spawner isolation
  // ──────────────────────────────────────────────

  // ── 4.13 ─────────────────────────────────────

  it("does not call any spawner", () => {
    const mockSpawner: Spawner = {
      spawn: vi.fn(() => "mock-id"),
    };
    setSpawner(mockSpawner);

    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-13",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(mockSpawner.spawn).not.toHaveBeenCalled();
  });

  // ── 4.15 ─────────────────────────────────────

  it("does not call spawner when mock spawner is set (integration)", () => {
    const mockSpawner: Spawner = {
      spawn: vi.fn(() => "mock-id"),
    };
    setSpawner(mockSpawner);

    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "implementer",
      prompt: "Implement feature",
      description: "Implement",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-15",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    expect(mockSpawner.spawn).not.toHaveBeenCalled();
    // The hook should have set model/thinking from config
    expect(input.model).toBe("primary-model");
    expect(input.thinking).toBe("high");
  });

  // ──────────────────────────────────────────────
  // Fresh config read
  // ──────────────────────────────────────────────

  // ── 4.14 ─────────────────────────────────────

  it("re-reads YAML on every call (no caching)", () => {
    const router = createRouter();

    // First call: uses initial SAMPLE_YAML
    const input1: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "First call",
      description: "First",
    };
    const event1 = {
      type: "tool_call" as const,
      toolCallId: "call-14a",
      toolName: "subagent",
      input: input1,
    };

    const result1 = router.handler(event1, {} as never);
    expect(result1).toBeUndefined();
    expect(input1.model).toBe("cheap-model");
    expect(input1.thinking).toBe("low");

    // Rewrite YAML with different values
    writeRouting(
      [
        "roles:",
        "  Explore:",
        "    thinking: xhigh",
        "    models:",
        "      - deepseek-v4-flash",
        "      - cheap-model",
      ].join("\n"),
    );

    // Second call: should pick up new values
    const input2: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Second call",
      description: "Second",
    };
    const event2 = {
      type: "tool_call" as const,
      toolCallId: "call-14b",
      toolName: "subagent",
      input: input2,
    };

    const result2 = router.handler(event2, {} as never);
    expect(result2).toBeUndefined();
    expect(input2.model).toBe("deepseek-v4-flash");
    expect(input2.thinking).toBe("xhigh");
  });

  // ──────────────────────────────────────────────
  // Public API stability (Section 6)
  // ──────────────────────────────────────────────

  // ── 6.1 ─────────────────────────────────────

  it("exports setSpawner function", () => {
    expect(typeof setSpawner).toBe("function");
  });

  // ── 6.2 ─────────────────────────────────────

  it("exports setResultProvider function", () => {
    expect(typeof setResultProvider).toBe("function");
  });

  // ── 6.3 ─────────────────────────────────────

  it("exports Spawner type (compilation check)", () => {
    // Type-level check: this compiles if Spawner is exported correctly
    const spawner: Spawner = {
      spawn: (_agentType: string, _prompt: string) => "test",
    };
    expect(typeof spawner.spawn).toBe("function");
  });

  // ── 6.4 ─────────────────────────────────────

  it("setSpawner accepts any Spawner without throwing", () => {
    const validSpawner: Spawner = {
      spawn: () => "test",
    };
    expect(() => setSpawner(validSpawner)).not.toThrow();
  });

  // ── 6.5 ─────────────────────────────────────

  it("setResultProvider accepts any ResultProvider without throwing", () => {
    const provider = {
      getResult: async () => null,
    };
    expect(() => setResultProvider(provider)).not.toThrow();
  });

  // ── 6.6 ─────────────────────────────────────

  it("setSpawner and setResultProvider are no-ops for the deterministic subagent path", () => {
    const mockSpawner: Spawner = {
      spawn: vi.fn(() => "mock-id"),
    };
    setSpawner(mockSpawner);

    const mockProvider = {
      getResult: vi.fn(async () => null),
    };
    setResultProvider(mockProvider);

    // Invoke the hook with a valid subagent call
    const router = createRouter();
    const input: Record<string, unknown> = {
      subagent_type: "Explore",
      prompt: "Test",
      description: "Test",
    };
    const event = {
      type: "tool_call" as const,
      toolCallId: "call-66",
      toolName: "subagent",
      input,
    };

    const result = router.handler(event, {} as never);
    expect(result).toBeUndefined();
    // The hook should NOT call spawn
    expect(mockSpawner.spawn).not.toHaveBeenCalled();
    // The hook should NOT call getResult
    expect(mockProvider.getResult).not.toHaveBeenCalled();
    // The hook should have set routing values regardless
    expect(input.model).toBe("cheap-model");
    expect(input.thinking).toBe("low");
  });
});
