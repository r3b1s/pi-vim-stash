import { describe, expect, it } from "vitest";
import {
  approveEvalSet,
  inferToolProfile,
  proposeEvalSet,
  recommendCostFirstModel,
} from "../src/eval-config.js";

describe("eval configuration", () => {
  it("proposes two to three evals and requires approval", () => {
    const evalSet = proposeEvalSet({
      skillName: "review-skill",
      intent: "create-new",
      goal: "Review pull requests",
      successCriteria: ["Finds correctness issues"],
    });
    expect(evalSet.evals.length).toBeGreaterThanOrEqual(2);
    expect(evalSet.evals.length).toBeLessThanOrEqual(3);
    expect(evalSet.pi?.approved).toBe(false);
    expect(approveEvalSet(evalSet).pi?.approved).toBe(true);
  });

  it("recommends cost-first model and broader tools when inferred", () => {
    expect(recommendCostFirstModel(["claude-sonnet", "gemini-flash"])).toBe(
      "gemini-flash",
    );
    const profile = inferToolProfile({
      prompts: ["Investigate a GitHub pull request using browser data"],
    });
    expect(profile.profile).toBe("broader");
    expect(profile.suggestions[0]).toContain("broader");
  });
});
