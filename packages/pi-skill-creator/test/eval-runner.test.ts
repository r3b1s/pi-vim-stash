import { describe, expect, it } from "vitest";
import { buildEvalPrompt, makeBatchRunSettings } from "../src/eval-runner.js";
import type { SkillCreatorState } from "../src/types.js";

const state: SkillCreatorState = {
  schemaVersion: 1,
  runId: "sc-20260101T000000Z-test",
  status: "active",
  intent: "create-new",
  rails: {
    phase: "eval-running",
    nextSuggestedActions: [],
    artifactPaths: {
      runDir: "/tmp/run",
      state: "/tmp/run/state.json",
      history: "/tmp/run/history.json",
      summary: "/tmp/run/summary.md",
      evals: "/tmp/run/evals.json",
    },
  },
  sideThreads: [],
  pendingConfirmations: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const evalCase = { id: "basic", name: "Basic", prompt: "Do it" };

describe("eval runner configuration", () => {
  it("keeps candidate and baseline fair except skill condition", () => {
    const settings = makeBatchRunSettings({
      cwd: "/repo",
      state,
      iteration: 1,
      tools: ["read", "bash"],
      thinkingLevel: "low",
      environment: { CI: "1" },
      conditions: [
        {
          evalCase,
          condition: "with_skill",
          skillSnapshotDir: "/snap/with_skill",
        },
        { evalCase, condition: "without_skill" },
      ],
    });
    expect(settings[0]?.cwd).toBe(settings[1]?.cwd);
    expect(settings[0]?.tools).toEqual(settings[1]?.tools);
    expect(settings[0]?.thinkingLevel).toBe(settings[1]?.thinkingLevel);
    expect(settings[0]?.environment).toEqual(settings[1]?.environment);
    expect(settings[0]?.skillSnapshotDir).not.toBe(
      settings[1]?.skillSnapshotDir,
    );
  });

  it("builds isolated output and skill instructions", () => {
    const prompt = buildEvalPrompt({
      cwd: "/repo",
      state,
      iteration: 1,
      evalCase,
      condition: "with_skill",
      outputDir: "/tmp/out",
      skillSnapshotDir: "/snap/with_skill",
    });
    expect(prompt).toContain("Assigned output directory: /tmp/out");
    expect(prompt).toContain("Only the intended skill snapshot");
  });
});
