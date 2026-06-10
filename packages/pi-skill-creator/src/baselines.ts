import type { ConditionName, WorkflowIntent } from "./types.js";

export interface BaselinePlan {
  intent: WorkflowIntent;
  candidateCondition: "with_skill";
  baselineCondition: Exclude<ConditionName, "with_skill">;
  requiresOldSkillSnapshot: boolean;
  degraded?: boolean;
  diagnostics: string[];
}

export function baselinePlanForIntent(
  intent: WorkflowIntent,
  options: { oldSkillAvailable?: boolean } = {},
): BaselinePlan {
  if (intent === "improve-existing") {
    return {
      intent,
      candidateCondition: "with_skill",
      baselineCondition: "old_skill",
      requiresOldSkillSnapshot: true,
      diagnostics:
        options.oldSkillAvailable === false
          ? ["old_skill baseline requires an existing skill snapshot"]
          : [],
    };
  }

  if (intent === "port-adapt") {
    const hasOld = options.oldSkillAvailable !== false;
    return {
      intent,
      candidateCondition: "with_skill",
      baselineCondition: hasOld ? "old_skill" : "without_skill",
      requiresOldSkillSnapshot: hasOld,
      degraded: !hasOld,
      diagnostics: hasOld
        ? []
        : [
            "Source/upstream skill could not be snapshotted or run cleanly; degraded to without_skill baseline metadata.",
          ],
    };
  }

  return {
    intent,
    candidateCondition: "with_skill",
    baselineCondition: "without_skill",
    requiresOldSkillSnapshot: false,
    diagnostics: [],
  };
}

export function conditionNamesForPlan(plan: BaselinePlan): ConditionName[] {
  return [plan.candidateCondition, plan.baselineCondition];
}
