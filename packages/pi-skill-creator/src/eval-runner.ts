import { rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Api, Model, ThinkingLevel } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import {
  conditionRunPaths,
  listProducedFiles,
  writeConditionArtifacts,
} from "./artifacts.js";
import type {
  ConditionDiagnostics,
  ConditionMetrics,
  ConditionName,
  EvalCase,
  SkillCreatorState,
  TimingData,
  ToolResultDetail,
} from "./types.js";

export interface EvalRunSettings {
  cwd: string;
  state: SkillCreatorState;
  iteration: number;
  evalCase: EvalCase;
  condition: ConditionName;
  outputDir: string;
  skillSnapshotDir?: string;
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  retainRawEvents?: boolean;
  environment?: Record<string, string>;
}

export interface EvalBatchCondition {
  evalCase: EvalCase;
  condition: ConditionName;
  skillSnapshotDir?: string;
}

export interface EvalBatchSettings {
  cwd: string;
  state: SkillCreatorState;
  iteration: number;
  conditions: EvalBatchCondition[];
  model?: Model<Api>;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  retainRawEvents?: boolean;
  environment?: Record<string, string>;
  concurrency?: number;
}

export interface EvalRunResult {
  evalId: string;
  condition: ConditionName;
  paths: ReturnType<typeof conditionRunPaths>;
  metrics: ConditionMetrics;
  diagnostics: ConditionDiagnostics;
  timing: TimingData;
  finalAnswer: string;
}

interface MessageContentPart {
  type?: string;
  text?: string;
}

interface SessionMessage {
  role?: string;
  content?: string | MessageContentPart[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    input?: number;
    output?: number;
    tokens?: number;
    cost?: { total?: number };
    costUsd?: number;
  };
}

interface SessionEvent {
  type: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
  message?: SessionMessage;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  result?: unknown;
}

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

export function makeBatchRunSettings(
  settings: EvalBatchSettings,
): EvalRunSettings[] {
  return settings.conditions.map((condition) => {
    const paths = conditionRunPaths(
      settings.state,
      settings.iteration,
      condition.evalCase,
      condition.condition,
    );
    const runSettings: EvalRunSettings = {
      cwd: settings.cwd,
      state: settings.state,
      iteration: settings.iteration,
      evalCase: condition.evalCase,
      condition: condition.condition,
      outputDir: paths.outputsDir,
    };
    if (condition.skillSnapshotDir !== undefined)
      runSettings.skillSnapshotDir = condition.skillSnapshotDir;
    if (settings.model !== undefined) runSettings.model = settings.model;
    if (settings.thinkingLevel !== undefined)
      runSettings.thinkingLevel = settings.thinkingLevel;
    if (settings.tools !== undefined) runSettings.tools = settings.tools;
    if (settings.retainRawEvents !== undefined)
      runSettings.retainRawEvents = settings.retainRawEvents;
    if (settings.environment !== undefined)
      runSettings.environment = settings.environment;
    return runSettings;
  });
}

export async function runEvalBatch(
  settings: EvalBatchSettings,
): Promise<EvalRunResult[]> {
  const tasks = makeBatchRunSettings(settings).map(
    (runSettings) => async () => runEvalCondition(runSettings),
  );

  if (!settings.concurrency || settings.concurrency >= tasks.length) {
    return Promise.all(tasks.map((task) => task()));
  }
  return runWithConcurrency(tasks, Math.max(1, settings.concurrency));
}

export async function runEvalCondition(
  settings: EvalRunSettings,
): Promise<EvalRunResult> {
  const startedAt = new Date();
  const paths = conditionRunPaths(
    settings.state,
    settings.iteration,
    settings.evalCase,
    settings.condition,
  );
  const toolDetails: ToolResultDetail[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const transcriptLines: string[] = [];
  const rawEvents: string[] = [];
  let finalAnswer = "";
  let tokenUsage = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  const loader = new DefaultResourceLoader({
    cwd: settings.cwd,
    agentDir: getAgentDir(),
    skillsOverride: (current) => ({
      skills: settings.skillSnapshotDir
        ? [skillFromSnapshot(settings.skillSnapshotDir)]
        : [],
      diagnostics: current.diagnostics,
    }),
  });
  await loader.reload();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const sessionOptions: CreateAgentSessionOptions = {
    cwd: settings.cwd,
    tools: settings.tools ?? DEFAULT_TOOLS,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(settings.cwd),
    authStorage,
    modelRegistry,
  };
  if (settings.model !== undefined) sessionOptions.model = settings.model;
  if (settings.thinkingLevel !== undefined)
    sessionOptions.thinkingLevel = settings.thinkingLevel;
  const { session } = await createAgentSession(sessionOptions);

  const unsubscribe = session.subscribe((event: unknown) => {
    const e = event as SessionEvent;
    if (settings.retainRawEvents) rawEvents.push(JSON.stringify(e));

    if (
      e.type === "message_update" &&
      e.assistantMessageEvent?.type === "text_delta"
    ) {
      finalAnswer += String(e.assistantMessageEvent.delta ?? "");
    }

    if (e.type === "message_end") {
      const role = e.message?.role;
      const text = textFromMessage(e.message);
      if (text) transcriptLines.push(`## ${role ?? "message"}\n\n${text}\n`);
      const usage = e.message?.usage;
      if (usage) {
        inputTokens += Number(usage.inputTokens ?? usage.input ?? 0);
        outputTokens += Number(usage.outputTokens ?? usage.output ?? 0);
        tokenUsage += Number(usage.totalTokens ?? usage.tokens ?? 0);
        costUsd += Number(usage.cost?.total ?? usage.costUsd ?? 0);
      }
    }

    if (e.type === "tool_execution_start") {
      toolDetails.push({
        toolName: e.toolName ?? "",
        callId: e.toolCallId ?? "",
        isError: false,
        startedAt: new Date().toISOString(),
      });
    }

    if (e.type === "tool_execution_end") {
      const callId = e.toolCallId ?? "";
      const existing = toolDetails.find((detail) => detail.callId === callId);
      if (existing) {
        existing.isError = Boolean(e.isError);
        existing.endedAt = new Date().toISOString();
        existing.outputBytes = JSON.stringify(e.result ?? {}).length;
      } else {
        toolDetails.push({
          toolName: e.toolName ?? "",
          callId,
          isError: Boolean(e.isError),
          endedAt: new Date().toISOString(),
        });
      }
    }
  });

  try {
    await session.prompt(buildEvalPrompt(settings));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    unsubscribe();
    session.dispose();
  }

  const endedAt = new Date();
  const filesCreated = await listProducedFiles(paths.outputsDir);
  if (filesCreated.length === 0)
    warnings.push("No files were observed in the assigned output directory.");
  if (
    settings.skillSnapshotDir &&
    !(await skillMarkdownExists(settings.skillSnapshotDir))
  ) {
    warnings.push(
      `Skill snapshot has no SKILL.md: ${settings.skillSnapshotDir}`,
    );
  }

  const transcriptMarkdown = transcriptLines.length
    ? transcriptLines.join("\n")
    : `# Transcript\n\n${finalAnswer || "No assistant text captured."}\n`;
  const transcriptSize = Buffer.byteLength(transcriptMarkdown, "utf8");
  const metrics: ConditionMetrics = {
    toolCalls: toolDetails.length,
    toolErrors: toolDetails.filter((detail) => detail.isError).length,
    outputBytes: filesCreated.reduce(
      (sum, file) => sum + Buffer.byteLength(file),
      0,
    ),
    transcriptBytes: transcriptSize,
    filesCreated,
  };
  const totalTokens = tokenUsage || inputTokens + outputTokens;
  if (totalTokens) metrics.tokens = totalTokens;
  if (inputTokens) metrics.inputTokens = inputTokens;
  if (outputTokens) metrics.outputTokens = outputTokens;
  if (costUsd) metrics.costUsd = costUsd;
  const diagnostics: ConditionDiagnostics = {
    warnings,
    errors,
    outputDirectory: paths.outputsDir,
    missingOutputs: filesCreated.length === 0,
    writesOutsideOutputDir: [],
    toolResults: toolDetails,
  };
  if (settings.skillSnapshotDir)
    diagnostics.loadedSkillPath = join(settings.skillSnapshotDir, "SKILL.md");
  const timing: TimingData = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    executorDurationMs: endedAt.getTime() - startedAt.getTime(),
  };

  await writeConditionArtifacts(
    paths,
    metrics,
    diagnostics,
    timing,
    transcriptMarkdown,
    settings.retainRawEvents ? `${rawEvents.join("\n")}\n` : undefined,
  );

  return {
    evalId: settings.evalCase.id,
    condition: settings.condition,
    paths,
    metrics,
    diagnostics,
    timing,
    finalAnswer,
  };
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const current = nextIndex++;
      const task = tasks[current];
      if (!task) continue;
      results[current] = await task();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  return results;
}

export async function pruneRawEventsForRun(
  result: EvalRunResult,
): Promise<boolean> {
  try {
    await rm(result.paths.transcriptJsonl, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function buildEvalPrompt(settings: EvalRunSettings): string {
  const expectations =
    settings.evalCase.expectations
      ?.map((expectation) => `- ${expectation.text}`)
      .join("\n") ?? "(qualitative review; no formal expectations)";
  return [
    `You are running a Pi skill-creator eval condition: ${settings.condition}.`,
    `Working directory: ${settings.cwd}`,
    `Assigned output directory: ${settings.outputDir}`,
    "Save any files you create for this eval under the assigned output directory. Do not hard-fail if no files are required; provide a clear final answer.",
    settings.skillSnapshotDir
      ? `Only the intended skill snapshot for this condition should be considered loaded: ${settings.skillSnapshotDir}`
      : "No candidate or baseline skill should be loaded for this condition.",
    "",
    "## Eval Prompt",
    settings.evalCase.prompt,
    "",
    "## Expectations / Criteria",
    expectations,
  ].join("\n");
}

function skillFromSnapshot(skillSnapshotDir: string): Skill {
  return {
    name: basename(skillSnapshotDir).replace(/_/g, "-") || "skill-under-test",
    description: `Skill snapshot for eval condition ${basename(skillSnapshotDir)}`,
    filePath: join(skillSnapshotDir, "SKILL.md"),
    baseDir: skillSnapshotDir,
    sourceInfo: createSyntheticSourceInfo(join(skillSnapshotDir, "SKILL.md"), {
      source: "sdk",
    }),
    disableModelInvocation: false,
  };
}

async function skillMarkdownExists(skillSnapshotDir: string): Promise<boolean> {
  try {
    return (await stat(join(skillSnapshotDir, "SKILL.md"))).isFile();
  } catch {
    return false;
  }
}

function textFromMessage(message: SessionMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part: MessageContentPart) => {
      if (part?.type === "text") return part.text;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
