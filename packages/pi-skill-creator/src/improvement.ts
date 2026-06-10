import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { freezeIterationEvalSet, iterationPaths } from "./artifacts.js";
import type { SkillCreatorState } from "./types.js";

export interface ReviewSummaryInput {
  findings: string[];
  candidateWins?: number;
  baselineWins?: number;
  ties?: number;
  unclear?: number;
  diagnostics?: string[];
}

export interface PostReviewSummary {
  summary: string;
  options: ["improve", "rerun", "finish"];
}

export interface DescriptionImprovementInput {
  currentDescription: string;
  feedback: string[];
  benchmarkFindings?: string[];
  diagnostics?: string[];
  nearMisses?: string[];
}

export function summarizePostReview(
  input: ReviewSummaryInput,
): PostReviewSummary {
  const lines = ["Review complete."];
  lines.push(
    `Candidate wins: ${input.candidateWins ?? 0}; baseline wins: ${input.baselineWins ?? 0}; ties: ${input.ties ?? 0}; unclear: ${input.unclear ?? 0}.`,
  );
  if (input.findings.length)
    lines.push("Findings:", ...input.findings.map((finding) => `- ${finding}`));
  if (input.diagnostics?.length)
    lines.push(
      "Diagnostics:",
      ...input.diagnostics.map((diagnostic) => `- ${diagnostic}`),
    );
  lines.push("Choose next: improve, rerun, or finish.");
  return { summary: lines.join("\n"), options: ["improve", "rerun", "finish"] };
}

export function proposeDescriptionImprovement(
  input: DescriptionImprovementInput,
): string {
  const signals = [
    ...input.feedback,
    ...(input.benchmarkFindings ?? []),
    ...(input.diagnostics ?? []),
    ...(input.nearMisses ?? []),
  ]
    .filter(Boolean)
    .slice(0, 8);
  if (signals.length === 0) return input.currentDescription;
  return `${input.currentDescription}\n\nUse when: ${signals.join("; ")}`.slice(
    0,
    1024,
  );
}

export async function saveImprovedDraft(
  state: SkillCreatorState,
  filename: string,
  content: string,
): Promise<string> {
  const draftsDir = join(state.rails.artifactPaths.runDir, "drafts");
  await mkdir(draftsDir, { recursive: true });
  const path = join(draftsDir, filename);
  await writeFile(path, content, "utf8");
  return path;
}

export function targetEditRequiresConfirmation(targetPath: string): {
  allowed: false;
  reason: string;
  targetPath: string;
} {
  return {
    allowed: false,
    targetPath,
    reason:
      "Target skill file edits require explicit user confirmation and must be performed through normal edit/write tools, not hidden extension writes.",
  };
}

export async function createNextIteration(
  state: SkillCreatorState,
  currentIteration: number,
): Promise<ReturnType<typeof iterationPaths>> {
  const next = currentIteration + 1;
  await freezeIterationEvalSet(state, next);
  return iterationPaths(state, next);
}

export const V1_EXCLUSIONS = [
  "automatic multi-iteration improve loops",
  "full train/test automatic trigger-description optimizer",
] as const;
