/**
 * Shared types for pi-tmux-sessionizer.
 */

/** Status of a spawned subagent tracked by this extension. */
export type SubagentStatus =
  | "starting"
  | "running"
  | "completed"
  | "stopped"
  | "error";

/** In-memory record for a tracked subagent. */
export interface SubagentRecord {
  /** Unique agent ID (UUID v4, same as --session-id). */
  id: string;
  /** Agent type (e.g. "implementer", "Explore"). */
  type: string;
  /** The original prompt. */
  prompt: string;
  /** Current status. */
  status: SubagentStatus;
  /** Tmux session name. */
  sessionName: string;
  /** Tmux window index. */
  windowIndex: number;
  /** Path to the subagent's config directory. */
  configDir: string;
  /** Path to the session file being monitored. */
  sessionFilePath?: string;
  /** Extracted result text, when completed. */
  result?: string;
  /** Error message, when errored. */
  error?: string;
  /** Timestamp when the subagent was spawned. */
  startedAt: number;
  /** Timestamp when the subagent completed or stopped. */
  completedAt?: number;
}

/** Parent conversation message captured for inherit_context. */
export interface ParentContextMessage {
  role: "user" | "assistant";
  content: string;
}

/** Parameters accepted by the spawn function. */
export interface SpawnParams {
  agentType: string;
  prompt: string;
  description?: string;
  model?: string;
  thinking?: string;
  maxTurns?: number;
  inheritContext?: boolean;
  /** Pre-formatted parent context text extracted from the parent session. */
  parentContextText?: string;
  /** Structured parent conversation messages for buildParentContext. */
  parentContext?: ParentContextMessage[];
}

/** Options passed to tmux manager commands. */
export interface TmuxOptions {
  /** Timeout in milliseconds for tmux CLI calls. Default: 5000. */
  timeout?: number;
}
