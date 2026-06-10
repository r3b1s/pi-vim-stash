import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conditionRunPaths,
  writeConditionArtifacts,
} from "../src/artifacts.js";
import {
  aggregateBenchmarkFromConditions,
  analyzeBenchmarkPlaceholder,
  gradeTextOutput,
  writeGrading,
} from "../src/grading.js";
import { createRun } from "../src/storage.js";
import type { EvalCase } from "../src/types.js";

const evalCase: EvalCase = {
  id: "basic",
  name: "Basic",
  prompt: "Summarize",
  expectations: [{ text: "mentions risks", assertion: "risks" }],
};

describe("grading", () => {
  it("grades expectations and supports qualitative-only evals", () => {
    expect(
      gradeTextOutput(evalCase, "This mentions risks clearly.", "with_skill")
        .expectations[0]?.passed,
    ).toBe(true);
    const qualitative = gradeTextOutput(
      { id: "q", name: "Q", prompt: "Do it" },
      "output",
      "without_skill",
    );
    expect(qualitative.qualitativeOnly).toBe(true);
  });

  it("writes grading and aggregates benchmark/history", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-sc-grading-"));
    try {
      const state = await createRun({
        cwd: root,
        runRoot: join(root, ".pi/skill-creator/runs"),
      });
      const paths = conditionRunPaths(state, 1, evalCase, "with_skill");
      await writeConditionArtifacts(
        paths,
        {
          toolCalls: 0,
          toolErrors: 0,
          outputBytes: 0,
          transcriptBytes: 5,
          filesCreated: [],
        },
        {
          warnings: [],
          errors: [],
          outputDirectory: paths.outputsDir,
          writesOutsideOutputDir: [],
          toolResults: [],
        },
        { startedAt: "2026-01-01T00:00:00.000Z" },
        "risks",
      );
      await writeGrading(state, 1, evalCase, "with_skill", "risks");
      const benchmark = await aggregateBenchmarkFromConditions(state, 1, [
        { evalCase, conditions: ["with_skill"] },
      ]);
      expect(benchmark.evals[0]?.conditions[0]?.grading).toBeTruthy();
      const history = JSON.parse(
        await readFile(
          join(state.rails.artifactPaths.runDir, "history.json"),
          "utf8",
        ),
      );
      expect(history.entries[0].version).toBe("iteration-1");
      expect(analyzeBenchmarkPlaceholder({ passRate: 1 })[0]?.type).toBe(
        "non-discriminating",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
