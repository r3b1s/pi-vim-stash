import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  conditionRunPaths,
  freezeIterationEvalSet,
  materializeEvalMetadata,
  parseFeedbackMarkdown,
  recordWithoutSkillBaseline,
  snapshotSkill,
  writeBenchmark,
  writeConditionArtifacts,
  writeFeedback,
  writeRunEvalSet,
} from "../src/artifacts.js";
import { createRun } from "../src/storage.js";
import type { EvalSet } from "../src/types.js";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "pi-sc-artifacts-"));
}

const evalSet: EvalSet = {
  skill_name: "demo-skill",
  evals: [
    {
      id: "basic",
      name: "Basic task",
      prompt: "Use the skill to summarize a changelog.",
      expectations: [{ text: "Mentions breaking changes" }],
    },
  ],
};

describe("skill-creator eval artifacts", () => {
  it("writes run and iteration eval artifacts", async () => {
    const root = await tempRoot();
    try {
      const state = await createRun({
        cwd: root,
        runRoot: join(root, ".pi/skill-creator/runs"),
      });
      const runEvalPath = await writeRunEvalSet(state, evalSet);
      expect(JSON.parse(await readFile(runEvalPath, "utf8")).skill_name).toBe(
        "demo-skill",
      );
      const iteration = await freezeIterationEvalSet(state, 1);
      expect(iteration.evalsPath.endsWith("iteration-1/evals.json")).toBe(true);
      const metadataPaths = await materializeEvalMetadata(state, 1, evalSet);
      expect(metadataPaths).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes feedback, condition artifacts, benchmark, and snapshots", async () => {
    const root = await tempRoot();
    try {
      const runRoot = join(root, ".pi/skill-creator/runs");
      const state = await createRun({ cwd: root, runRoot });
      const sourceSkill = join(root, "skill");
      await import("node:fs/promises").then(async (fs) => {
        await fs.mkdir(sourceSkill, { recursive: true });
        await fs.writeFile(
          join(sourceSkill, "SKILL.md"),
          "---\nname: demo\ndescription: demo\n---\n",
          "utf8",
        );
      });
      expect(
        await snapshotSkill(state, 1, sourceSkill, "with_skill"),
      ).toContain("with_skill");
      expect(await recordWithoutSkillBaseline(state, 1)).toContain(
        "without_skill.json",
      );
      await writeFeedback(
        state,
        1,
        [{ evalId: "basic", verdict: "candidate better", notes: "Clearer." }],
        true,
      );
      const parsedFeedback = await parseFeedbackMarkdown(state, 1);
      expect(parsedFeedback.entries[0]?.notes).toContain("Clearer");
      const paths = conditionRunPaths(state, 1, evalSet.evals[0], "with_skill");
      await writeConditionArtifacts(
        paths,
        {
          toolCalls: 1,
          toolErrors: 0,
          outputBytes: 0,
          transcriptBytes: 12,
          filesCreated: [],
        },
        {
          warnings: [],
          errors: [],
          outputDirectory: paths.outputsDir,
          writesOutsideOutputDir: [],
          toolResults: [],
        },
        {
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:01.000Z",
          executorDurationMs: 1000,
        },
        "assistant output",
      );
      const benchmark = await writeBenchmark(state, 1, {
        summary: "Candidate better on basic task.",
        evals: [
          {
            evalId: "basic",
            name: "Basic task",
            conditions: [
              {
                condition: "with_skill",
                metrics: { toolCalls: 1, toolErrors: 0 },
              },
            ],
          },
        ],
      });
      expect(benchmark.evals[0]?.conditions[0]?.condition).toBe("with_skill");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
