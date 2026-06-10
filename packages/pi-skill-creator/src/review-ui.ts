import { readFile } from "node:fs/promises";
import type { Theme as ThemeClass } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
  conditionRunPaths,
  type FeedbackEntry,
  iterationPaths,
  writeFeedback,
} from "./artifacts.js";

type Theme = Pick<ThemeClass, "fg" | "bold">;

import type { GradingExpectationResult } from "./grading.js";
import type {
  ConditionMetrics,
  EvalCase,
  EvalSet,
  SkillCreatorState,
} from "./types.js";

export interface ReviewRunView {
  condition: "with_skill" | "without_skill" | "old_skill";
  summary: string;
  files: string[];
  metrics?: Partial<ConditionMetrics>;
  transcriptPath?: string;
}

export interface ReviewItem {
  evalCase: EvalCase;
  baseline: ReviewRunView;
  candidate: ReviewRunView;
  criteria: string[];
  verdict?: FeedbackEntry["verdict"];
  notes?: string;
}

export interface ReviewPanelResult {
  entries: FeedbackEntry[];
  reviewComplete: boolean;
}

export async function loadReviewItems(
  state: SkillCreatorState,
  iteration: number,
  evalSet: EvalSet,
): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  for (const evalCase of evalSet.evals) {
    const baselineCondition =
      state.intent === "create-new" || state.intent === "run-evals"
        ? "without_skill"
        : "old_skill";
    const baseline = await loadRunView(
      state,
      iteration,
      evalCase,
      baselineCondition,
    );
    const candidate = await loadRunView(
      state,
      iteration,
      evalCase,
      "with_skill",
    );
    items.push({
      evalCase,
      baseline,
      candidate,
      criteria: await criteriaWithGrading(state, iteration, evalCase),
    });
  }
  return items;
}

export function workflowStateLines(state: SkillCreatorState): string[] {
  return [
    `Goal: ${state.rails.currentGoal ?? "TBD"}`,
    `Intent: ${state.intent}`,
    `Phase: ${state.rails.phase}`,
    `Run: ${state.runId}`,
    `Artifacts: ${state.rails.artifactPaths.runDir}`,
    "Next:",
    ...(state.rails.nextSuggestedActions.length
      ? state.rails.nextSuggestedActions.map((a) => `- ${a}`)
      : ["- Continue discovery"]),
    "Side threads:",
    ...(state.sideThreads.length
      ? state.sideThreads.map((t) => `- ${t.title} (${t.status})`)
      : ["- none"]),
  ];
}

export async function writeWorkflowSummary(
  state: SkillCreatorState,
): Promise<string> {
  const path = state.rails.artifactPaths.summary;
  await import("node:fs/promises").then((fs) =>
    fs.appendFile(
      path,
      `\n## Workflow State\n\n${workflowStateLines(state).join("\n")}\n`,
      "utf8",
    ),
  );
  return path;
}

export class ReviewPanelComponent {
  private selected = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly items: ReviewItem[],
    private readonly done: (result: ReviewPanelResult | undefined) => void,
    private readonly theme: Theme,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "right")) {
      this.selected = Math.min(this.items.length - 1, this.selected + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, "left")) {
      this.selected = Math.max(0, this.selected - 1);
      this.invalidate();
      return;
    }
    const item = this.items[this.selected];
    if (!item) return;
    if (data === "c") item.verdict = "candidate better";
    if (data === "b") item.verdict = "baseline better";
    if (data === "t") item.verdict = "tie";
    if (data === "u") item.verdict = "unclear";
    if (matchesKey(data, "backspace"))
      item.notes = (item.notes ?? "").slice(0, -1);
    if (
      data.length === 1 &&
      data.charCodeAt(0) >= 32 &&
      !["c", "b", "t", "u"].includes(data)
    ) {
      item.notes = `${item.notes ?? ""}${data}`;
    }
    if (matchesKey(data, "return")) {
      this.done({
        entries: this.items.map(toFeedbackEntry),
        reviewComplete: true,
      });
      return;
    }
    this.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const item = this.items[this.selected];
    if (!item) return ["No review items available."];
    const th = this.theme;
    const half = Math.max(20, Math.floor((width - 3) / 2));
    const lines: string[] = [];
    const add = (line: string) => lines.push(truncateToWidth(line, width));
    add(
      th.fg(
        "accent",
        th.bold(
          `Eval ${this.selected + 1}/${this.items.length}: ${item.evalCase.name || item.evalCase.id}`,
        ),
      ),
    );
    add(
      th.fg(
        "dim",
        "←/→ navigate • c candidate better • b baseline better • t tie • u unclear • type notes • enter complete • esc close",
      ),
    );
    add("─".repeat(Math.min(width, 120)));
    const left = renderRunBox("Baseline", item.baseline, half, th);
    const right = renderRunBox("Candidate", item.candidate, half, th);
    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i++)
      add(
        `${left[i] ?? ""}${" ".repeat(Math.max(1, half - visibleLen(left[i] ?? "") + 1))}${right[i] ?? ""}`,
      );
    add("─".repeat(Math.min(width, 120)));
    add(th.fg("accent", "Criteria"));
    if (item.criteria.length)
      for (const criterion of item.criteria) add(`- ${criterion}`);
    else add(th.fg("dim", "Qualitative review: no formal criteria."));
    add(`Verdict: ${item.verdict ?? "unclear"}`);
    add(`Notes: ${item.notes ?? ""}`);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    delete this.cachedWidth;
    delete this.cachedLines;
  }
}

export async function saveReviewPanelResult(
  state: SkillCreatorState,
  iteration: number,
  result: ReviewPanelResult,
): Promise<void> {
  await writeFeedback(state, iteration, result.entries, result.reviewComplete);
}

function renderRunBox(
  title: string,
  run: ReviewRunView,
  width: number,
  theme: Theme,
): string[] {
  const lines = [
    theme.fg("accent", title),
    `${run.condition}`,
    run.summary || "(no summary)",
  ];
  if (run.files.length) lines.push(`Files: ${run.files.join(", ")}`);
  if (run.transcriptPath) lines.push(`Transcript: ${run.transcriptPath}`);
  const m = run.metrics;
  const durationMs = (m as Record<string, unknown>)?.durationMs;
  lines.push(
    `Metrics: tokens=${m?.tokens ?? "?"} cost=${m?.costUsd ?? "?"} tools=${m?.toolCalls ?? "?"} errors=${m?.toolErrors ?? "?"} duration=${typeof durationMs === "number" ? durationMs : "?"}`,
  );
  return lines.flatMap((line) => wrap(line, width));
}

function wrap(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += width)
    chunks.push(line.slice(i, i + width));
  return chunks;
}

function visibleLen(line: string): number {
  return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function toFeedbackEntry(item: ReviewItem): FeedbackEntry {
  return {
    evalId: item.evalCase.id,
    verdict: item.verdict ?? "unclear",
    notes: item.notes ?? "",
  };
}

async function criteriaWithGrading(
  state: SkillCreatorState,
  iteration: number,
  evalCase: EvalCase,
): Promise<string[]> {
  const base =
    evalCase.expectations?.map((expectation) => expectation.text) ?? [];
  const candidatePaths = conditionRunPaths(
    state,
    iteration,
    evalCase,
    "with_skill",
  );
  const grading = (await readOptionalJson(candidatePaths.gradingPath)) as
    | { expectations?: GradingExpectationResult[] }
    | undefined;
  const graded = Array.isArray(grading?.expectations)
    ? grading.expectations.map(
        (entry) =>
          `${entry.passed ? "PASS" : "FAIL"}: ${entry.text}${entry.evidence ? ` — ${entry.evidence}` : ""}`,
      )
    : [];
  return graded.length ? graded : base;
}

async function loadRunView(
  state: SkillCreatorState,
  iteration: number,
  evalCase: EvalCase,
  condition: ReviewRunView["condition"],
): Promise<ReviewRunView> {
  const paths = conditionRunPaths(state, iteration, evalCase, condition);
  const transcript = await readOptional(paths.transcriptMarkdown);
  const metrics = (await readOptionalJson(paths.metricsPath)) as
    | Partial<ConditionMetrics>
    | undefined;
  const files = metrics?.filesCreated ?? [];
  return {
    condition,
    summary: firstParagraph(transcript) || "No output summary captured.",
    files,
    metrics,
    transcriptPath: paths.transcriptMarkdown,
  };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  const text = await readOptional(path);
  return text ? JSON.parse(text) : undefined;
}

function firstParagraph(text: string | undefined): string | undefined {
  return text
    ?.split(/\n\s*\n/)
    .find((part) => part.trim())
    ?.trim()
    .slice(0, 1200);
}

export function reviewFallbackPath(
  state: SkillCreatorState,
  iteration: number,
): string {
  return iterationPaths(state, iteration).feedbackMarkdown;
}
