import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ModelEntry, ModelRoutingConfig } from "#src/config";
import { readModelRouting, resolveModelsForType } from "#src/config";

// ──────────────────────────────────────────────
// Helper: temp config directory
// ──────────────────────────────────────────────

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

function writeConfig(dir: string, yamlContent: string): void {
  const configDir = join(dir, "agent");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "model-routing.yml"), yamlContent, "utf-8");
}

// ──────────────────────────────────────────────
// Tests: readModelRouting
// ──────────────────────────────────────────────

describe("readModelRouting", () => {
  it("parses valid YAML with per-model thinking format", () => {
    withTempDir((dir) => {
      writeConfig(
        dir,
        [
          "roles:",
          "  Explore:",
          "    thinking: low",
          "    models:",
          "      - cheap-model",
          "  implementer:",
          "    thinking: high",
          "    models:",
          "      - primary-model",
          "      - fallback-model",
          "  reviewer:",
          "    thinking: high",
          "    models:",
          '      - "gpt-5.5"',
          "      - opus:",
          "          thinking: xhigh",
          "      - deepseek-v4-pro",
        ].join("\n"),
      );

      const result = readModelRouting(dir);
      expect(result).not.toBe("");
      expect(typeof result).toBe("object");

      const config = result as Record<string, unknown>;
      expect(config.roles).toBeDefined();
      const roles = config.roles as Record<string, unknown>;
      expect(roles.Explore).toBeDefined();
    });
  });

  it("returns error for missing config file", () => {
    const result = readModelRouting("/tmp/nonexistent-path-12345");
    expect(typeof result).toBe("string");
    expect((result as string).toLowerCase()).toContain("not found");
  });

  it("returns error for invalid YAML", () => {
    withTempDir((dir) => {
      writeConfig(dir, "  invalid yaml: [\n  broken");

      const result = readModelRouting(dir);
      expect(typeof result).toBe("string");
      expect((result as string).toLowerCase()).toContain("parse");
    });
  });

  it("returns error for empty file", () => {
    withTempDir((dir) => {
      writeConfig(dir, "");

      const result = readModelRouting(dir);
      expect(typeof result).toBe("string");
      expect((result as string).toLowerCase()).toContain("empty");
    });
  });
});

// ──────────────────────────────────────────────
// Tests: resolveModelsForType
// ──────────────────────────────────────────────

describe("resolveModelsForType", () => {
  const sampleRouting = {
    roles: {
      Explore: {
        thinking: "low",
        models: ["cheap-model", "fallback-cheap"],
      },
      implementer: {
        thinking: "high",
        models: ["primary-model", "fallback-model"],
      },
      reviewer: {
        thinking: "high",
        models: ["gpt-5.5", { opus: { thinking: "xhigh" } }, "deepseek-v4-pro"],
      },
      "general-purpose": {
        models: ["cheap-model"],
      },
      Plan: {
        thinking: "high",
        models: ["plan-model"],
      },
    },
  };

  it("resolves known types with thinking level", () => {
    const result = resolveModelsForType("Explore", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(2);
    expect(models[0].model).toBe("cheap-model");
    expect(models[0].thinking).toBe("low");
    expect(models[1].model).toBe("fallback-cheap");
    expect(models[1].thinking).toBe("low");
  });

  it("resolves case-insensitively (EXPLORE -> Explore)", () => {
    const result = resolveModelsForType("EXPLORE", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models[0].model).toBe("cheap-model");
  });

  it("resolves implementer with high thinking", () => {
    const result = resolveModelsForType("implementer", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(2);
    expect(models[0].model).toBe("primary-model");
    expect(models[0].thinking).toBe("high");
  });

  it("resolves websearch to websearch role", () => {
    const routingWithWebsearch = {
      roles: {
        websearch: {
          thinking: "low",
          models: ["search-model"],
        },
      },
    };
    const result = resolveModelsForType("websearch", routingWithWebsearch);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models[0].model).toBe("search-model");
  });

  it("resolves general-purpose to general-purpose role", () => {
    const result = resolveModelsForType("general-purpose", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models[0].model).toBe("cheap-model");
  });

  it("resolves Plan agent type", () => {
    const result = resolveModelsForType("Plan", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models[0].model).toBe("plan-model");
    expect(models[0].thinking).toBe("high");
  });

  it("returns error for unknown agent type", () => {
    const result = resolveModelsForType("custom-agent", sampleRouting);
    expect(typeof result).toBe("string");
    expect(result as string).toContain(
      "No routing config found for agent type custom-agent",
    );
  });

  it("returns error for missing role in config", () => {
    const result = resolveModelsForType("retro", {
      roles: { Explore: { models: ["m"] } },
    });
    expect(typeof result).toBe("string");
    expect(result as string).toContain(
      "No routing config found for agent type retro",
    );
  });

  it("returns error for empty models list", () => {
    const result = resolveModelsForType("Explore", {
      roles: { Explore: { models: [] } },
    });
    expect(typeof result).toBe("string");
    expect(result as string).toContain("No models configured for role");
  });

  it("returns error for undefined roles section", () => {
    const result = resolveModelsForType("Explore", {});
    expect(typeof result).toBe("string");
    expect(result as string).toContain("No roles defined");
  });

  it("applies per-model thinking override", () => {
    const result = resolveModelsForType("reviewer", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(3);

    // First model: plain string, uses role default
    expect(models[0].model).toBe("gpt-5.5");
    expect(models[0].thinking).toBe("high");

    // Second model: has per-model thinking override (xhigh)
    expect(models[1].model).toBe("opus");
    expect(models[1].thinking).toBe("xhigh");

    // Third model: plain string, uses role default
    expect(models[2].model).toBe("deepseek-v4-pro");
    expect(models[2].thinking).toBe("high");
  });

  it("handles model entry without thinking override by using role default", () => {
    const result = resolveModelsForType("reviewer", sampleRouting);
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    // opus has own thinking, gpt-5.5 uses role-level
    expect(models[0].thinking).toBe("high");
  });

  it("skips null model entries gracefully", () => {
    const routing = {
      roles: {
        Explore: {
          models: [
            null as unknown as ModelEntry,
            "valid-model",
            null as unknown as ModelEntry,
          ],
        },
      },
    };
    const result = resolveModelsForType(
      "Explore",
      routing as ModelRoutingConfig,
    );
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(1);
    expect(models[0].model).toBe("valid-model");
  });

  it("skips boolean model entries gracefully", () => {
    const routing = {
      roles: {
        Explore: {
          models: [true as unknown as ModelEntry, "good-model"],
        },
      },
    };
    const result = resolveModelsForType(
      "Explore",
      routing as ModelRoutingConfig,
    );
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(1);
    expect(models[0].model).toBe("good-model");
  });

  it("skips number model entries gracefully", () => {
    const routing = {
      roles: {
        Explore: {
          models: [42 as unknown as ModelEntry, "good-model"],
        },
      },
    };
    const result = resolveModelsForType(
      "Explore",
      routing as ModelRoutingConfig,
    );
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(1);
    expect(models[0].model).toBe("good-model");
  });

  it("skips empty object model entries gracefully", () => {
    const routing = {
      roles: {
        Explore: {
          models: [{} as unknown as ModelEntry, "good-model"],
        },
      },
    };
    const result = resolveModelsForType(
      "Explore",
      routing as ModelRoutingConfig,
    );
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(1);
    expect(models[0].model).toBe("good-model");
  });

  it("skips array model entries gracefully", () => {
    const routing = {
      roles: {
        Explore: {
          models: [[] as unknown as ModelEntry, "good-model"],
        },
      },
    };
    const result = resolveModelsForType(
      "Explore",
      routing as ModelRoutingConfig,
    );
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(1);
    expect(models[0].model).toBe("good-model");
  });

  it("returns empty array when all entries are malformed", () => {
    const routing = {
      roles: {
        Explore: {
          models: [
            null as unknown as ModelEntry,
            {} as unknown as ModelEntry,
            true as unknown as ModelEntry,
            [] as unknown as ModelEntry,
          ],
        },
      },
    };
    const result = resolveModelsForType(
      "Explore",
      routing as ModelRoutingConfig,
    );
    expect(Array.isArray(result)).toBe(true);
    const models = result as Array<{ model: string; thinking?: string }>;
    expect(models.length).toBe(0);
  });
});
