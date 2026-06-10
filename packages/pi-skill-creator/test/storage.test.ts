import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addSideThread,
  appendSummaryNote,
  createRun,
  latestActiveRun,
  listRuns,
  readState,
  updateState,
} from "../src/storage.js";

async function tempRoot() {
  return mkdtemp(join(tmpdir(), "pi-sc-"));
}

describe("skill-creator run storage", () => {
  it("creates state, history, and summary artifacts", async () => {
    const root = await tempRoot();
    try {
      const state = await createRun({
        cwd: root,
        runRoot: join(root, ".pi/skill-creator/runs"),
        goal: "Create docs skill",
      });
      expect(state.status).toBe("active");
      expect(state.rails.currentGoal).toBe("Create docs skill");
      const loaded = await readState(
        join(root, ".pi/skill-creator/runs"),
        state.runId,
      );
      expect(loaded.runId).toBe(state.runId);
      expect(
        await latestActiveRun(join(root, ".pi/skill-creator/runs")),
      ).toMatchObject({ runId: state.runId });
      expect(await listRuns(join(root, ".pi/skill-creator/runs"))).toHaveLength(
        1,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("updates rails, side threads, status, and summary", async () => {
    const root = await tempRoot();
    try {
      const runRoot = join(root, ".pi/skill-creator/runs");
      const created = await createRun({ cwd: root, runRoot });
      const updated = await updateState(runRoot, created.runId, {
        intent: "improve-existing",
        phase: "review",
        status: "reviewing",
        nextSuggestedActions: ["Review benchmark"],
      });
      expect(updated.intent).toBe("improve-existing");
      expect(updated.rails.phase).toBe("review");
      const withThread = await addSideThread(runRoot, created.runId, {
        title: "Track source license",
        notes: ["Apache-2.0"],
      });
      expect(withThread.sideThreads[0]?.title).toBe("Track source license");
      const summaryPath = await appendSummaryNote(
        runRoot,
        created.runId,
        "Decision",
        "Use Pi-native rewrite.",
      );
      expect(summaryPath.endsWith("summary.md")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
