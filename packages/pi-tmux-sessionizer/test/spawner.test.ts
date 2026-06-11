import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSubagentConfig,
  destroyParentConfigs,
  destroySubagentConfig,
} from "#src/subagent-config";

let origPiDir = "";
let baseDir = "";

function setupEnv(): string {
  // Save original env
  origPiDir = process.env.PI_CODING_AGENT_DIR ?? "";
  baseDir = mkdtempSync(join(tmpdir(), "pts-test-"));
  process.env.PI_CODING_AGENT_DIR = baseDir;
  return baseDir;
}

function cleanupEnv(): void {
  if (baseDir) {
    rmSync(baseDir, { recursive: true, force: true });
  }
  process.env.PI_CODING_AGENT_DIR = origPiDir || undefined;
}

describe("createSubagentConfig", () => {
  beforeEach(() => {
    setupEnv();
  });

  afterEach(() => {
    cleanupEnv();
  });

  it("creates config directory with sessions subdirectory", () => {
    const { configDir, sessionDir } = createSubagentConfig(
      "parent-1",
      "agent-1",
      {},
    );
    expect(existsSync(configDir)).toBe(true);
    expect(existsSync(sessionDir)).toBe(true);
  });

  it("writes settings.json with provided options", () => {
    const { configDir } = createSubagentConfig("parent-1", "agent-2", {
      model: "haiku",
      thinking: "high",
      maxTurns: 10,
    });

    const settingsPath = join(configDir, "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(content.model).toBe("haiku");
    expect(content.thinking).toBe("high");
    expect(content.maxTurns).toBe(10);
  });

  it("writes empty settings when no options provided", () => {
    const { configDir } = createSubagentConfig("parent-1", "agent-3", {});
    const content = JSON.parse(
      readFileSync(join(configDir, "settings.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(Object.keys(content).length).toBe(0);
  });

  it("creates directory under PI_CODING_AGENT_DIR/tmp/subagents", () => {
    const { configDir } = createSubagentConfig("p1", "a1", {});
    expect(configDir).toBe(join(baseDir, "tmp", "subagents", "p1", "a1"));
    expect(existsSync(configDir)).toBe(true);
  });
});

describe("destroySubagentConfig", () => {
  beforeEach(() => {
    setupEnv();
  });

  afterEach(() => {
    cleanupEnv();
  });

  it("removes agent config directory", () => {
    const { configDir } = createSubagentConfig("p1", "a1", {});
    expect(existsSync(configDir)).toBe(true);

    destroySubagentConfig("p1", "a1");
    expect(existsSync(configDir)).toBe(false);
  });

  it("does not throw when agent directory does not exist", () => {
    expect(() => destroySubagentConfig("nonexistent", "agent")).not.toThrow();
  });
});

describe("destroyParentConfigs", () => {
  beforeEach(() => {
    setupEnv();
  });

  afterEach(() => {
    cleanupEnv();
  });

  it("removes all configs for a parent session", () => {
    createSubagentConfig("p1", "a1", {});
    createSubagentConfig("p1", "a2", {});
    const parentDir = join(baseDir, "tmp", "subagents", "p1");
    expect(existsSync(parentDir)).toBe(true);

    destroyParentConfigs("p1");
    expect(existsSync(parentDir)).toBe(false);
  });

  it("does not affect other parent sessions", () => {
    createSubagentConfig("p1", "a1", {});
    createSubagentConfig("p2", "b1", {});
    const parent1Dir = join(baseDir, "tmp", "subagents", "p1");
    const parent2Dir = join(baseDir, "tmp", "subagents", "p2");

    destroyParentConfigs("p1");
    expect(existsSync(parent1Dir)).toBe(false);
    expect(existsSync(parent2Dir)).toBe(true);
  });
});
