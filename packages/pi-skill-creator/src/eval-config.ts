import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultEvalId,
  displayNameForSkillDir,
  writeRunEvalSet,
} from "./artifacts.js";
import type {
  EvalCase,
  EvalSet,
  SkillCreatorState,
  WorkflowIntent,
} from "./types.js";

export type ToolProfile = "normal" | "broader" | "custom";

export interface EvalModelPreference {
  model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  toolProfile: ToolProfile;
  concurrency?: number;
  updatedAt: string;
}

export interface EvalPromptProposalInput {
  skillName: string;
  intent: WorkflowIntent;
  goal?: string;
  examples?: string[];
  edgeCases?: string[];
  successCriteria?: string[];
}

export function proposeEvalSet(
  input: EvalPromptProposalInput,
  count = 3,
): EvalSet {
  const prompts = buildPromptIdeas(input).slice(
    0,
    Math.max(2, Math.min(count, 3)),
  );
  const evals: EvalCase[] = prompts.map((prompt, index) => ({
    id: defaultEvalId(prompt, index),
    name: prompt.split(".")[0]?.slice(0, 80) || `Eval ${index + 1}`,
    prompt,
    expectations: input.successCriteria?.map((text) => ({ text })) ?? [],
    metadata: { source: "pi-skill-creator-proposal", intent: input.intent },
  }));
  return {
    skill_name: input.skillName,
    evals,
    pi: { approved: false, intent: input.intent },
  };
}

export async function saveProposedEvalSet(
  state: SkillCreatorState,
  evalSet: EvalSet,
): Promise<string> {
  return writeRunEvalSet(state, evalSet);
}

export function approveEvalSet(evalSet: EvalSet): EvalSet {
  return { ...evalSet, pi: { ...(evalSet.pi ?? {}), approved: true } };
}

export function recommendCostFirstModel(
  availableModelNames: string[],
): string | undefined {
  return (
    availableModelNames.find((name) =>
      /haiku|flash|mini|small|lite/i.test(name),
    ) ??
    availableModelNames.find((name) => /sonnet|gpt|gemini/i.test(name)) ??
    availableModelNames[0]
  );
}

export function inferToolProfile(input: {
  prompts: string[];
  skillDir?: string;
  userRequestedTools?: string[];
}): { profile: ToolProfile; suggestions: string[] } {
  const text = `${input.prompts.join("\n")} ${input.skillDir ?? ""}`;
  const suggestions: string[] = [];
  if (
    /browser|web|http|api|github|issue|pull request|database|container|kubernetes/i.test(
      text,
    )
  ) {
    suggestions.push(
      "Eval prompts may need broader custom or MCP tools; ask the user before adding them.",
    );
  }
  if (input.userRequestedTools?.length) {
    suggestions.push(
      `User requested tools: ${input.userRequestedTools.join(", ")}`,
    );
    return { profile: "custom", suggestions };
  }
  return { profile: suggestions.length ? "broader" : "normal", suggestions };
}

export async function writeEvalPreference(
  state: SkillCreatorState,
  preference: Omit<EvalModelPreference, "updatedAt">,
): Promise<string> {
  const path = evalPreferencePath(state);
  await import("node:fs/promises").then(async (fs) => {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(
      path,
      `${JSON.stringify({ ...preference, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  });
  return path;
}

export async function readEvalPreference(
  state: SkillCreatorState,
): Promise<EvalModelPreference | undefined> {
  try {
    return JSON.parse(
      await readFile(evalPreferencePath(state), "utf8"),
    ) as EvalModelPreference;
  } catch {
    return undefined;
  }
}

export function evalPreferencePath(state: SkillCreatorState): string {
  return join(state.rails.artifactPaths.runDir, "eval-settings.json");
}

export function skillNameFromTarget(
  targetSkillDir: string | undefined,
  fallback = "candidate-skill",
): string {
  return targetSkillDir ? displayNameForSkillDir(targetSkillDir) : fallback;
}

function buildPromptIdeas(input: EvalPromptProposalInput): string[] {
  const baseGoal =
    input.goal ?? `Use the ${input.skillName} skill for a realistic user task`;
  const examples = input.examples?.filter(Boolean) ?? [];
  const edgeCases = input.edgeCases?.filter(Boolean) ?? [];
  const prompts = [
    examples[0] ??
      `${baseGoal}. Produce the expected deliverable and save any requested files in the assigned output directory.`,
    examples[1] ??
      `Handle a realistic follow-up or variant for ${input.skillName}, explaining decisions briefly and producing any requested artifact.`,
    edgeCases[0] ??
      `Handle an edge case for ${input.skillName}: ambiguous requirements, incomplete inputs, or conflicting constraints. Ask only necessary clarifying questions or state assumptions.`,
  ];
  return prompts;
}
