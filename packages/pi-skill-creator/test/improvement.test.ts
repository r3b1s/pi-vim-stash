import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeRunEvalSet } from "../src/artifacts.js";
import {
  createNextIteration,
  proposeDescriptionImprovement,
  saveImprovedDraft,
  summarizePostReview,
  targetEditRequiresConfirmation,
  V1_EXCLUSIONS,
} from "../src/improvement.js";
import { createRun } from "../src/storage.js";

describe("improvement flow", () => {
  it("summarizes review and proposes one-shot description improvements", () => {
    expect(
      summarizePostReview({ findings: ["Candidate clearer"], candidateWins: 1 })
        .summary,
    ).toContain("Choose next");
    expect(
      proposeDescriptionImprovement({
        currentDescription: "Use for docs.",
        feedback: ["Need API examples"],
      }),
    ).toContain("Need API examples");
    expect(targetEditRequiresConfirmation("skills/demo/SKILL.md").allowed).toBe(
      false,
    );
    expect(V1_EXCLUSIONS).toContain("automatic multi-iteration improve loops");
  });

  it("saves drafts in run dir and creates explicit next iterations", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-sc-improve-"));
    try {
      const state = await createRun({
        cwd: root,
        runRoot: join(root, ".pi/skill-creator/runs"),
      });
      await writeRunEvalSet(state, {
        skill_name: "demo",
        evals: [{ id: "e1", name: "Eval 1", prompt: "Do it" }],
      });
      const draft = await saveImprovedDraft(state, "candidate.md", "draft");
      expect(await readFile(draft, "utf8")).toBe("draft");
      const next = await createNextIteration(state, 1);
      expect(next.iterationDir).toContain("iteration-2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
