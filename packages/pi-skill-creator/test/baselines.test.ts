import { describe, expect, it } from "vitest";
import {
  baselinePlanForIntent,
  conditionNamesForPlan,
} from "../src/baselines.js";

describe("baseline plans", () => {
  it("uses no-skill baseline for create-new and eval-only", () => {
    expect(conditionNamesForPlan(baselinePlanForIntent("create-new"))).toEqual([
      "with_skill",
      "without_skill",
    ]);
    expect(conditionNamesForPlan(baselinePlanForIntent("run-evals"))).toEqual([
      "with_skill",
      "without_skill",
    ]);
  });

  it("uses old_skill baseline for improve-existing", () => {
    const plan = baselinePlanForIntent("improve-existing");
    expect(plan.baselineCondition).toBe("old_skill");
    expect(plan.requiresOldSkillSnapshot).toBe(true);
  });

  it("records degraded port/adapt baseline diagnostics", () => {
    const plan = baselinePlanForIntent("port-adapt", {
      oldSkillAvailable: false,
    });
    expect(plan.baselineCondition).toBe("without_skill");
    expect(plan.degraded).toBe(true);
    expect(plan.diagnostics[0]).toContain("degraded");
  });
});
