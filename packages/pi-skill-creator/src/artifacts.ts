import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ConditionDiagnostics,
  ConditionMetrics,
  ConditionName,
  EvalCase,
  EvalExpectation,
  EvalSet,
  RunId,
  SkillCreatorState,
  TimingData,
} from "./types.js";

const INDENT = 2;

export interface IterationPaths {
  iterationDir: string;
  evalsPath: string;
  snapshotsDir: string;
  feedbackMarkdown: string;
  feedbackJson: string;
  benchmarkJson: string;
  benchmarkMarkdown: string;
}

export interface EvalCasePaths {
  evalDir: string;
  metadataPath: string;
}

export interface ConditionRunPaths {
  conditionDir: string;
  outputsDir: string;
  metricsPath: string;
  diagnosticsPath: string;
  timingPath: string;
  transcriptMarkdown: string;
  transcriptJsonl: string;
  gradingPath: string;
}

export interface FeedbackEntry {
  evalId: string;
  verdict: "candidate better" | "baseline better" | "tie" | "unclear";
  notes: string;
}

export interface FeedbackFile {
  schemaVersion: 1;
  runId: RunId;
  iteration: number;
  entries: FeedbackEntry[];
  reviewComplete: boolean;
  updatedAt: string;
}

export interface BenchmarkConditionSummary {
  condition: ConditionName;
  metrics?: Partial<ConditionMetrics>;
  diagnostics?: Partial<ConditionDiagnostics>;
  grading?: unknown;
}

export interface BenchmarkFile {
  schemaVersion: 1;
  runId: RunId;
  iteration: number;
  generatedAt: string;
  evals: Array<{
    evalId: string;
    name: string;
    conditions: BenchmarkConditionSummary[];
  }>;
  summary?: string;
}

export function iterationPaths(
  state: SkillCreatorState,
  iteration: number,
): IterationPaths {
  const iterationDir = join(
    state.rails.artifactPaths.runDir,
    `iteration-${iteration}`,
  );
  return {
    iterationDir,
    evalsPath: join(iterationDir, "evals.json"),
    snapshotsDir: join(iterationDir, "skill-snapshots"),
    feedbackMarkdown: join(iterationDir, "feedback.md"),
    feedbackJson: join(iterationDir, "feedback.json"),
    benchmarkJson: join(iterationDir, "benchmark.json"),
    benchmarkMarkdown: join(iterationDir, "benchmark.md"),
  };
}

export function slugifyEvalName(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "eval"
  );
}

export function evalCasePaths(
  state: SkillCreatorState,
  iteration: number,
  evalCase: EvalCase,
): EvalCasePaths {
  const base = `${slugifyEvalName(evalCase.name || evalCase.id)}-${evalCase.id}`;
  const evalDir = join(iterationPaths(state, iteration).iterationDir, base);
  return { evalDir, metadataPath: join(evalDir, "eval_metadata.json") };
}

export function conditionRunPaths(
  state: SkillCreatorState,
  iteration: number,
  evalCase: EvalCase,
  condition: ConditionName,
): ConditionRunPaths {
  const evalPaths = evalCasePaths(state, iteration, evalCase);
  const conditionDir = join(evalPaths.evalDir, condition);
  return {
    conditionDir,
    outputsDir: join(conditionDir, "outputs"),
    metricsPath: join(conditionDir, "metrics.json"),
    diagnosticsPath: join(conditionDir, "diagnostics.json"),
    timingPath: join(conditionDir, "timing.json"),
    transcriptMarkdown: join(conditionDir, "transcript.md"),
    transcriptJsonl: join(conditionDir, "transcript.jsonl"),
    gradingPath: join(conditionDir, "grading.json"),
  };
}

export async function readEvalSet(path: string): Promise<EvalSet> {
  return validateEvalSet(JSON.parse(await readFile(path, "utf8")) as unknown);
}

export async function writeRunEvalSet(
  state: SkillCreatorState,
  evalSet: EvalSet,
): Promise<string> {
  const path = state.rails.artifactPaths.evals;
  await writeJson(path, normalizeEvalSet(evalSet));
  return path;
}

export async function freezeIterationEvalSet(
  state: SkillCreatorState,
  iteration: number,
  evalSet?: EvalSet,
): Promise<IterationPaths> {
  const paths = iterationPaths(state, iteration);
  await mkdir(paths.iterationDir, { recursive: true });
  const source =
    evalSet ?? (await readEvalSet(state.rails.artifactPaths.evals));
  await writeJson(paths.evalsPath, normalizeEvalSet(source));
  return paths;
}

export async function exportReusableEvalSet(
  evalSet: EvalSet,
  targetSkillDir: string,
): Promise<string> {
  const path = join(targetSkillDir, "evals", "evals.json");
  await writeJson(path, normalizeEvalSet(evalSet));
  return path;
}

export async function materializeEvalMetadata(
  state: SkillCreatorState,
  iteration: number,
  evalSet: EvalSet,
): Promise<string[]> {
  const paths: string[] = [];
  for (const evalCase of evalSet.evals) {
    const evalPaths = evalCasePaths(state, iteration, evalCase);
    const metadata = {
      id: evalCase.id,
      name: evalCase.name || evalCase.id,
      prompt: evalCase.prompt,
      expected_output: evalCase.expected_output,
      files: evalCase.files ?? [],
      expectations: evalCase.expectations ?? [],
      metadata: evalCase.metadata ?? {},
    };
    await writeJson(evalPaths.metadataPath, metadata);
    paths.push(evalPaths.metadataPath);
  }
  return paths;
}

export async function writeFeedback(
  state: SkillCreatorState,
  iteration: number,
  entries: FeedbackEntry[],
  reviewComplete = false,
): Promise<FeedbackFile> {
  const paths = iterationPaths(state, iteration);
  const feedback: FeedbackFile = {
    schemaVersion: 1,
    runId: state.runId,
    iteration,
    entries,
    reviewComplete,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(paths.feedbackJson, feedback);
  const lines = [`# Feedback for iteration ${iteration}`, ""];
  for (const entry of entries) {
    lines.push(
      `## ${entry.evalId}`,
      "",
      `Verdict: ${entry.verdict}`,
      "",
      entry.notes || "(no notes)",
      "",
    );
  }
  if (entries.length === 0) lines.push("No feedback recorded yet.", "");
  await writeText(paths.feedbackMarkdown, lines.join("\n"));
  return feedback;
}

export async function parseFeedbackMarkdown(
  state: SkillCreatorState,
  iteration: number,
): Promise<FeedbackFile> {
  const paths = iterationPaths(state, iteration);
  const markdown = await readFile(paths.feedbackMarkdown, "utf8");
  const entries: FeedbackEntry[] = [];
  for (const block of markdown.split(/^##\s+/m).slice(1)) {
    const [heading = "", ...rest] = block.split("\n");
    const body = rest.join("\n").trim();
    const verdictMatch =
      /^Verdict:\s*(candidate better|baseline better|tie|unclear)/m.exec(body);
    const verdict = (verdictMatch?.[1] ??
      "unclear") as FeedbackEntry["verdict"];
    const notes = body.replace(/^Verdict:.*$/m, "").trim();
    entries.push({ evalId: heading.trim(), verdict, notes });
  }
  const feedback: FeedbackFile = {
    schemaVersion: 1,
    runId: state.runId,
    iteration,
    entries,
    reviewComplete: false,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(paths.feedbackJson, feedback);
  return feedback;
}

export async function writeConditionArtifacts(
  paths: ConditionRunPaths,
  metrics: ConditionMetrics,
  diagnostics: ConditionDiagnostics,
  timing: TimingData,
  transcriptMarkdown: string,
  transcriptJsonl?: string,
): Promise<void> {
  await mkdir(paths.outputsDir, { recursive: true });
  await writeJson(paths.metricsPath, metrics);
  await writeJson(paths.diagnosticsPath, diagnostics);
  await writeJson(paths.timingPath, timing);
  await writeText(paths.transcriptMarkdown, transcriptMarkdown);
  if (transcriptJsonl !== undefined)
    await writeText(paths.transcriptJsonl, transcriptJsonl);
}

export async function writeBenchmark(
  state: SkillCreatorState,
  iteration: number,
  benchmark: Omit<
    BenchmarkFile,
    "schemaVersion" | "runId" | "iteration" | "generatedAt"
  >,
): Promise<BenchmarkFile> {
  const paths = iterationPaths(state, iteration);
  const file: BenchmarkFile = {
    schemaVersion: 1,
    runId: state.runId,
    iteration,
    generatedAt: new Date().toISOString(),
    ...benchmark,
  };
  await writeJson(paths.benchmarkJson, file);
  await writeText(paths.benchmarkMarkdown, renderBenchmarkMarkdown(file));
  return file;
}

export async function snapshotSkill(
  state: SkillCreatorState,
  iteration: number,
  sourceSkillDir: string,
  condition: Extract<ConditionName, "with_skill" | "old_skill">,
): Promise<string> {
  const target = join(iterationPaths(state, iteration).snapshotsDir, condition);
  await mkdir(dirname(target), { recursive: true });
  await cp(sourceSkillDir, target, {
    recursive: true,
    force: true,
    dereference: false,
  });
  return target;
}

export async function recordWithoutSkillBaseline(
  state: SkillCreatorState,
  iteration: number,
): Promise<string> {
  const target = join(
    iterationPaths(state, iteration).snapshotsDir,
    "without_skill.json",
  );
  await writeJson(target, {
    condition: "without_skill",
    skillLoaded: false,
    createdAt: new Date().toISOString(),
  });
  return target;
}

export async function listProducedFiles(outputsDir: string): Promise<string[]> {
  try {
    const out: string[] = [];
    for (const entry of await readdir(outputsDir, { withFileTypes: true })) {
      out.push(entry.name + (entry.isDirectory() ? "/" : ""));
    }
    return out.sort();
  } catch {
    return [];
  }
}

function normalizeEvalSet(evalSet: EvalSet): EvalSet {
  return validateEvalSet({
    ...evalSet,
    evals: evalSet.evals.map(normalizeEvalCase),
  });
}

function normalizeEvalCase(evalCase: EvalCase): EvalCase {
  const expectations = normalizeExpectations(evalCase.expectations);
  return {
    ...evalCase,
    name: evalCase.name || evalCase.id,
    ...(expectations !== undefined ? { expectations } : {}),
  };
}

function normalizeExpectations(
  expectations: EvalExpectation[] | undefined,
): EvalExpectation[] | undefined {
  if (!expectations || expectations.length === 0) return expectations;
  return expectations.map((expectation) => ({
    ...expectation,
    text: expectation.text.trim(),
  }));
}

function validateEvalSet(value: unknown): EvalSet {
  if (!value || typeof value !== "object")
    throw new Error("evals.json must be an object");
  const evalSet = value as EvalSet;
  if (typeof evalSet.skill_name !== "string" || !evalSet.skill_name.trim())
    throw new Error("evals.skill_name is required");
  if (!Array.isArray(evalSet.evals))
    throw new Error("evals.evals must be an array");
  for (const evalCase of evalSet.evals) {
    if (!evalCase.id || typeof evalCase.id !== "string")
      throw new Error("Each eval requires id");
    if (!evalCase.prompt || typeof evalCase.prompt !== "string")
      throw new Error(`Eval ${evalCase.id} requires prompt`);
  }
  return evalSet;
}

function renderBenchmarkMarkdown(file: BenchmarkFile): string {
  const lines = [
    `# Benchmark iteration ${file.iteration}`,
    "",
    file.summary ?? "",
    "",
  ];
  for (const evalResult of file.evals) {
    lines.push(
      `## ${evalResult.name}`,
      "",
      `Eval id: ${evalResult.evalId}`,
      "",
    );
    for (const condition of evalResult.conditions) {
      lines.push(
        `- ${condition.condition}: tokens=${condition.metrics?.tokens ?? "unknown"}, toolCalls=${condition.metrics?.toolCalls ?? "unknown"}, errors=${condition.metrics?.toolErrors ?? "unknown"}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, INDENT)}\n`, "utf8");
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export function defaultEvalId(prompt: string, index: number): string {
  return `${String(index + 1).padStart(2, "0")}-${slugifyEvalName(prompt).slice(0, 40)}`;
}

export function displayNameForSkillDir(skillDir: string): string {
  return basename(skillDir.replace(/\/$/, ""));
}
