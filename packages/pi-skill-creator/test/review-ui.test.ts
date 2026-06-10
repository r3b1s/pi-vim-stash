import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeGrading } from "../src/grading.js";
import type { ReviewPanelResult } from "../src/review-ui.js";
import {
  loadReviewItems,
  ReviewPanelComponent,
  workflowStateLines,
} from "../src/review-ui.js";
import type { SkillCreatorState } from "../src/types.js";

const state: SkillCreatorState = {
  schemaVersion: 1,
  runId: "sc-20260101T000000Z-test",
  status: "reviewing",
  intent: "create-new",
  rails: {
    currentGoal: "Create test skill",
    phase: "review",
    nextSuggestedActions: ["Review evals"],
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

const theme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
};

describe("review UI", () => {
  it("renders workflow state lines", () => {
    expect(workflowStateLines(state)).toContain("Intent: create-new");
  });

  it("renders one eval at a time and records verdicts", () => {
    let result: ReviewPanelResult | undefined;
    const component = new ReviewPanelComponent(
      [
        {
          evalCase: { id: "e1", name: "Eval One", prompt: "Do it" },
          baseline: {
            condition: "without_skill",
            summary: "baseline",
            files: [],
            metrics: { toolCalls: 1 },
          },
          candidate: {
            condition: "with_skill",
            summary: "candidate",
            files: ["out.md"],
            metrics: { toolCalls: 1, toolErrors: 0 },
          },
          criteria: [],
        },
      ],
      (value) => (result = value),
      theme,
    );
    const lines = component.render(100).join("\n");
    expect(lines).toContain("Eval 1/1: Eval One");
    expect(lines).toContain("Qualitative review");
    component.handleInput("c");
    component.handleInput("!");
    component.handleInput("\r");
    expect(result!.entries[0].verdict).toBe("candidate better");
    expect(result!.entries[0].notes).toBe("!");
  });

  it("loads grading pass/fail evidence into criteria", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-sc-review-"));
    try {
      const reviewState = {
        ...state,
        rails: {
          ...state.rails,
          artifactPaths: {
            ...state.rails.artifactPaths,
            runDir: join(root, "run"),
          },
        },
      };
      const evalCase = {
        id: "e1",
        name: "Eval One",
        prompt: "Do it",
        expectations: [{ text: "Contains answer", assertion: "answer" }],
      };
      await writeGrading(reviewState, 1, evalCase, "with_skill", "answer");
      const items = await loadReviewItems(reviewState, 1, {
        skill_name: "demo",
        evals: [evalCase],
      });
      expect(items[0]?.criteria[0]).toContain("PASS");
      expect(items[0]?.criteria[0]).toContain("Matched");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
