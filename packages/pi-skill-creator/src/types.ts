export type RunId = string;

export type WorkflowIntent =
  | "unknown"
  | "create-new"
  | "improve-existing"
  | "run-evals"
  | "port-adapt";

export type WorkflowPhase =
  | "discover"
  | "draft"
  | "eval-planning"
  | "eval-running"
  | "review"
  | "improve"
  | "complete";

export type RunStatus =
  | "active"
  | "reviewing"
  | "completed"
  | "parked"
  | "errored";

export type SideThreadStatus = "open" | "parked" | "resolved";

export interface SideThread {
  id: string;
  title: string;
  status: SideThreadStatus;
  relation?: string;
  notes: string[];
  nextAction?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactPaths {
  runDir: string;
  state: string;
  history: string;
  summary: string;
  evals: string;
  iterationsDir?: string;
  targetSkillDir?: string;
  sourceSkillDir?: string;
}

export interface IterationRef {
  number: number;
  status: "planned" | "running" | "ready-for-review" | "reviewed" | "failed";
  path: string;
  benchmarkPath?: string;
  feedbackPath?: string;
}

export interface WorkflowRails {
  currentGoal?: string;
  phase: WorkflowPhase;
  nextSuggestedActions: string[];
  activeIteration?: IterationRef;
  artifactPaths: ArtifactPaths;
}

export interface SkillCreatorState {
  schemaVersion: 1;
  runId: RunId;
  status: RunStatus;
  intent: WorkflowIntent;
  rails: WorkflowRails;
  sideThreads: SideThread[];
  pendingConfirmations: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  version: string;
  parentVersion?: string;
  iteration?: number;
  passRate?: number;
  gradingResult?: "pass" | "fail" | "mixed" | "qualitative";
  currentBest?: boolean;
  benchmarkPath?: string;
  createdAt: string;
}

export interface SkillCreatorHistory {
  schemaVersion: 1;
  runId: RunId;
  entries: HistoryEntry[];
  updatedAt: string;
}

export interface EvalExpectation {
  text: string;
  assertion?: string;
  weight?: number;
}

export interface EvalCase {
  id: string;
  name: string;
  prompt: string;
  expected_output?: string;
  files?: string[];
  expectations?: EvalExpectation[];
  metadata?: Record<string, unknown>;
}

export interface EvalSet {
  skill_name: string;
  evals: EvalCase[];
  pi?: {
    approved?: boolean;
    intent?: WorkflowIntent;
    targetSkillDir?: string;
    baselineSkillDir?: string;
  };
}

export type ConditionName = "with_skill" | "without_skill" | "old_skill";

export interface ConditionMetrics {
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  toolCalls: number;
  toolErrors: number;
  outputBytes: number;
  transcriptBytes: number;
  filesCreated: string[];
}

export interface ToolResultDetail {
  toolName: string;
  callId?: string;
  isError: boolean;
  startedAt?: string;
  endedAt?: string;
  outputBytes?: number;
  paths?: string[];
}

export interface ConditionDiagnostics {
  warnings: string[];
  errors: string[];
  loadedSkillPath?: string;
  outputDirectory: string;
  missingOutputs?: boolean;
  writesOutsideOutputDir: string[];
  toolResults: ToolResultDetail[];
}

export interface TimingData {
  startedAt: string;
  endedAt?: string;
  executorDurationMs?: number;
  graderDurationMs?: number;
}

export interface ToolSummaryResult<
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> {
  content: Array<{ type: "text"; text: string }>;
  details: TDetails;
}
