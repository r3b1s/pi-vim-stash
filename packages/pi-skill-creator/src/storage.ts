import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ArtifactPaths,
  HistoryEntry,
  RunId,
  RunStatus,
  SideThread,
  SkillCreatorHistory,
  SkillCreatorState,
  WorkflowIntent,
  WorkflowPhase,
} from "./types.js";

const JSON_INDENT = 2;

export interface CreateRunOptions {
  cwd: string;
  runRoot: string;
  goal?: string;
  intent?: WorkflowIntent;
}

export interface UpdateStatePatch {
  status?: RunStatus;
  intent?: WorkflowIntent;
  phase?: WorkflowPhase;
  currentGoal?: string;
  nextSuggestedActions?: string[];
  pendingConfirmations?: string[];
}

export interface AddSideThreadOptions {
  title: string;
  relation?: string;
  notes?: string[];
  nextAction?: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createRunId(date = new Date()): RunId {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `sc-${stamp}-${suffix}`;
}

export function getRunDir(runRoot: string, runId: RunId): string {
  if (!/^sc-[A-Za-z0-9TZ]+-[a-z0-9]{4,}$/.test(runId)) {
    throw new Error(`Invalid run id: ${runId}`);
  }
  return join(runRoot, runId);
}

export function artifactPaths(runRoot: string, runId: RunId): ArtifactPaths {
  const runDir = getRunDir(runRoot, runId);
  return {
    runDir,
    state: join(runDir, "state.json"),
    history: join(runDir, "history.json"),
    summary: join(runDir, "summary.md"),
    evals: join(runDir, "evals.json"),
    iterationsDir: runDir,
  };
}

export function createInitialState(
  runRoot: string,
  runId: RunId,
  goal?: string,
  intent: WorkflowIntent = "unknown",
): SkillCreatorState {
  const createdAt = nowIso();
  const paths = artifactPaths(runRoot, runId);
  return {
    schemaVersion: 1,
    runId,
    status: "active",
    intent,
    rails: {
      ...(goal !== undefined ? { currentGoal: goal } : {}),
      phase: "discover",
      nextSuggestedActions: [
        "Capture intent, examples, edge cases, and success criteria.",
      ],
      artifactPaths: paths,
    },
    sideThreads: [],
    pendingConfirmations: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function createInitialHistory(runId: RunId): SkillCreatorHistory {
  return { schemaVersion: 1, runId, entries: [], updatedAt: nowIso() };
}

export async function ensureRunRoot(runRoot: string): Promise<void> {
  await mkdir(runRoot, { recursive: true });
}

export async function createRun(
  options: CreateRunOptions,
): Promise<SkillCreatorState> {
  await ensureRunRoot(options.runRoot);
  const runId = createRunId();
  const runDir = getRunDir(options.runRoot, runId);
  await mkdir(runDir, { recursive: true });
  const state = createInitialState(
    options.runRoot,
    runId,
    options.goal,
    options.intent,
  );
  await writeJson(state.rails.artifactPaths.state, state);
  await writeJson(
    state.rails.artifactPaths.history,
    createInitialHistory(runId),
  );
  await writeFile(
    state.rails.artifactPaths.summary,
    `# Skill Creator Run ${runId}\n\nStatus: active\n\n## Goal\n\n${options.goal ?? "TBD"}\n\n## Decisions and Findings\n\n- Run created.\n`,
    "utf8",
  );
  return state;
}

export async function readState(
  runRoot: string,
  runId: RunId,
): Promise<SkillCreatorState> {
  const paths = artifactPaths(runRoot, runId);
  return validateState(
    JSON.parse(await readFile(paths.state, "utf8")) as unknown,
  );
}

export async function writeState(state: SkillCreatorState): Promise<void> {
  validateState(state);
  await writeJson(state.rails.artifactPaths.state, state);
}

export async function updateState(
  runRoot: string,
  runId: RunId,
  patch: UpdateStatePatch,
): Promise<SkillCreatorState> {
  const state = await readState(runRoot, runId);
  if (patch.status) state.status = patch.status;
  if (patch.intent) state.intent = patch.intent;
  if (patch.phase) state.rails.phase = patch.phase;
  if (patch.currentGoal !== undefined)
    state.rails.currentGoal = patch.currentGoal;
  if (patch.nextSuggestedActions)
    state.rails.nextSuggestedActions = patch.nextSuggestedActions;
  if (patch.pendingConfirmations)
    state.pendingConfirmations = patch.pendingConfirmations;
  state.updatedAt = nowIso();
  await writeState(state);
  return state;
}

export async function listRuns(runRoot: string): Promise<SkillCreatorState[]> {
  await ensureRunRoot(runRoot);
  const entries = await readdir(runRoot, { withFileTypes: true });
  const states: SkillCreatorState[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("sc-")) continue;
    try {
      states.push(await readState(runRoot, entry.name));
    } catch {
      // Ignore malformed/incomplete run dirs; tools surface validation for selected runs.
    }
  }
  return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function latestActiveRun(
  runRoot: string,
): Promise<SkillCreatorState | undefined> {
  const runs = await listRuns(runRoot);
  return runs.find(
    (run) => run.status === "active" || run.status === "reviewing",
  );
}

export async function appendHistoryEntry(
  runRoot: string,
  runId: RunId,
  entry: HistoryEntry,
): Promise<SkillCreatorHistory> {
  const paths = artifactPaths(runRoot, runId);
  const history = validateHistory(
    JSON.parse(await readFile(paths.history, "utf8")) as unknown,
  );
  history.entries.push(entry);
  history.updatedAt = nowIso();
  await writeJson(paths.history, history);
  return history;
}

export async function appendSummaryNote(
  runRoot: string,
  runId: RunId,
  heading: string,
  body: string,
): Promise<string> {
  const paths = artifactPaths(runRoot, runId);
  const stamped = `\n## ${heading}\n\n${body}\n`;
  await appendFile(paths.summary, stamped, "utf8");
  return paths.summary;
}

export async function addSideThread(
  runRoot: string,
  runId: RunId,
  options: AddSideThreadOptions,
): Promise<SkillCreatorState> {
  const state = await readState(runRoot, runId);
  const timestamp = nowIso();
  const thread: SideThread = {
    id: `side-${state.sideThreads.length + 1}`,
    title: options.title,
    status: "open",
    ...(options.relation !== undefined ? { relation: options.relation } : {}),
    notes: options.notes ?? [],
    ...(options.nextAction !== undefined
      ? { nextAction: options.nextAction }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.sideThreads.push(thread);
  state.updatedAt = timestamp;
  await writeState(state);
  return state;
}

export async function runExists(
  runRoot: string,
  runId: RunId,
): Promise<boolean> {
  try {
    return (await stat(getRunDir(runRoot, runId))).isDirectory();
  } catch {
    return false;
  }
}

export function summarizeState(state: SkillCreatorState): string {
  const goal = state.rails.currentGoal ?? "TBD";
  const actions =
    state.rails.nextSuggestedActions.map((a) => `- ${a}`).join("\n") ||
    "- Continue discovery.";
  return [
    `Run: ${state.runId}`,
    `Status: ${state.status}`,
    `Intent: ${state.intent}`,
    `Phase: ${state.rails.phase}`,
    `Goal: ${goal}`,
    "Next:",
    actions,
    `Artifacts: ${state.rails.artifactPaths.runDir}`,
  ].join("\n");
}

function validateState(value: unknown): SkillCreatorState {
  if (!value || typeof value !== "object")
    throw new Error("state.json must be an object");
  const state = value as SkillCreatorState;
  if (state.schemaVersion !== 1)
    throw new Error("Unsupported state schemaVersion");
  if (!state.runId || typeof state.runId !== "string")
    throw new Error("state.runId missing");
  if (!state.rails?.artifactPaths?.state)
    throw new Error("state rails artifact paths missing");
  if (!Array.isArray(state.sideThreads))
    throw new Error("state.sideThreads must be an array");
  if (!Array.isArray(state.pendingConfirmations))
    throw new Error("state.pendingConfirmations must be an array");
  return state;
}

function validateHistory(value: unknown): SkillCreatorHistory {
  if (!value || typeof value !== "object")
    throw new Error("history.json must be an object");
  const history = value as SkillCreatorHistory;
  if (history.schemaVersion !== 1)
    throw new Error("Unsupported history schemaVersion");
  if (!history.runId || typeof history.runId !== "string")
    throw new Error("history.runId missing");
  if (!Array.isArray(history.entries))
    throw new Error("history.entries must be an array");
  return history;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(value, null, JSON_INDENT)}\n`,
    "utf8",
  );
}

export function runLabel(state: SkillCreatorState): string {
  const goal = state.rails.currentGoal ? ` — ${state.rails.currentGoal}` : "";
  return `${basename(state.rails.artifactPaths.runDir)} (${state.status}, ${state.intent}, ${state.rails.phase})${goal}`;
}
