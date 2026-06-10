import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type BenchmarkConditionSummary,
  conditionRunPaths,
  writeBenchmark,
} from "./artifacts.js";
import { appendHistoryEntry } from "./storage.js";
import type {
  ConditionDiagnostics,
  ConditionMetrics,
  ConditionName,
  EvalCase,
  SkillCreatorState,
} from "./types.js";

export interface GradingExpectationResult {
  text: string;
  passed: boolean;
  evidence: string;
}

export interface GradingFile {
  schemaVersion: 1;
  evalId: string;
  condition: ConditionName;
  qualitativeOnly: boolean;
  expectations: GradingExpectationResult[];
  summary: string;
  gradedAt: string;
}

export interface AnalyzerFinding {
  type:
    | "flaky"
    | "non-discriminating"
    | "regression"
    | "tradeoff"
    | "diagnostic"
    | "description";
  severity: "info" | "warning" | "error";
  text: string;
  evidence?: string;
}

export function gradeTextOutput(
  evalCase: EvalCase,
  output: string,
  condition: ConditionName,
): GradingFile {
  const expectations = evalCase.expectations ?? [];
  const qualitativeOnly = expectations.length === 0;
  const results = expectations.map((expectation) => {
    const assertion = expectation.assertion ?? expectation.text;
    const passed =
      output.toLowerCase().includes(assertion.toLowerCase()) ||
      output.toLowerCase().includes(expectation.text.toLowerCase());
    return {
      text: expectation.text,
      passed,
      evidence: passed
        ? `Matched expectation text/assertion: ${assertion}`
        : `No direct match for: ${assertion}`,
    };
  });
  return {
    schemaVersion: 1,
    evalId: evalCase.id,
    condition,
    qualitativeOnly,
    expectations: results,
    summary: qualitativeOnly
      ? "Qualitative review only; no formal expectations were provided."
      : summarizeGrading(results),
    gradedAt: new Date().toISOString(),
  };
}

export async function writeGrading(
  state: SkillCreatorState,
  iteration: number,
  evalCase: EvalCase,
  condition: ConditionName,
  output: string,
): Promise<GradingFile> {
  const paths = conditionRunPaths(state, iteration, evalCase, condition);
  const grading = gradeTextOutput(evalCase, output, condition);
  await writeJson(paths.gradingPath, grading);
  return grading;
}

export async function gradeFromTranscript(
  state: SkillCreatorState,
  iteration: number,
  evalCase: EvalCase,
  condition: ConditionName,
): Promise<GradingFile> {
  const paths = conditionRunPaths(state, iteration, evalCase, condition);
  const transcript = await readFile(paths.transcriptMarkdown, "utf8");
  return writeGrading(state, iteration, evalCase, condition, transcript);
}

export async function aggregateBenchmarkFromConditions(
  state: SkillCreatorState,
  iteration: number,
  evals: Array<{ evalCase: EvalCase; conditions: ConditionName[] }>,
): Promise<Awaited<ReturnType<typeof writeBenchmark>>> {
  const benchmarkEvals = [];
  for (const item of evals) {
    const conditions: BenchmarkConditionSummary[] = [];
    for (const condition of item.conditions) {
      const paths = conditionRunPaths(
        state,
        iteration,
        item.evalCase,
        condition,
      );
      conditions.push({
        condition,
        metrics: (await readOptionalJson(paths.metricsPath)) as
          | Partial<ConditionMetrics>
          | undefined,
        diagnostics: (await readOptionalJson(paths.diagnosticsPath)) as
          | Partial<ConditionDiagnostics>
          | undefined,
        grading: await readOptionalJson(paths.gradingPath),
      });
    }
    benchmarkEvals.push({
      evalId: item.evalCase.id,
      name: item.evalCase.name || item.evalCase.id,
      conditions,
    });
  }
  const benchmark = await writeBenchmark(state, iteration, {
    summary:
      "Aggregated condition metrics, diagnostics, and grading artifacts.",
    evals: benchmarkEvals,
  });
  const passRate = calculatePassRate(
    benchmark.evals.flatMap((evalResult) =>
      evalResult.conditions.map((condition) => condition.grading),
    ),
  );
  const historyEntry: Parameters<typeof appendHistoryEntry>[2] = {
    version: `iteration-${iteration}`,
    iteration,
    gradingResult:
      passRate === undefined
        ? "qualitative"
        : passRate === 1
          ? "pass"
          : passRate === 0
            ? "fail"
            : "mixed",
    benchmarkPath: join(
      state.rails.artifactPaths.runDir,
      `iteration-${iteration}`,
      "benchmark.json",
    ),
    createdAt: new Date().toISOString(),
  };
  if (passRate !== undefined) historyEntry.passRate = passRate;
  await appendHistoryEntry(
    dirname(state.rails.artifactPaths.runDir),
    state.runId,
    historyEntry,
  );
  return benchmark;
}

export function analyzeBenchmarkPlaceholder(input: {
  passRate?: number;
  toolErrors?: number;
  diagnosticsWarnings?: number;
}): AnalyzerFinding[] {
  const findings: AnalyzerFinding[] = [];
  if (
    input.passRate !== undefined &&
    (input.passRate === 0 || input.passRate === 1)
  ) {
    findings.push({
      type: "non-discriminating",
      severity: "info",
      text: "Pass rate is at an extreme; verify evals discriminate meaningful behavior.",
    });
  }
  if ((input.toolErrors ?? 0) > 0) {
    findings.push({
      type: "diagnostic",
      severity: "warning",
      text: "Tool errors were observed; inspect diagnostics before judging output quality.",
    });
  }
  if ((input.diagnosticsWarnings ?? 0) > 0) {
    findings.push({
      type: "diagnostic",
      severity: "info",
      text: "Diagnostics warnings exist; review missing outputs, skill-load status, or path issues.",
    });
  }
  return findings;
}

function summarizeGrading(results: GradingExpectationResult[]): string {
  const passed = results.filter((result) => result.passed).length;
  return `${passed}/${results.length} expectation(s) passed.`;
}

function calculatePassRate(gradings: unknown[]): number | undefined {
  const expectationResults = gradings.flatMap((grading: unknown) => {
    const g = grading as
      | { expectations?: Array<{ passed: boolean }> }
      | undefined;
    return Array.isArray(g?.expectations) ? g.expectations : [];
  });
  if (expectationResults.length === 0) return undefined;
  return (
    expectationResults.filter((result) => result.passed).length /
    expectationResults.length
  );
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
