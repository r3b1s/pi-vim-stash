import { readFileSync } from "node:fs";

/**
 * A parsed JSONL entry from a pi session file.
 */
export interface SessionEntry {
  /** The raw parsed JSON object. */
  data: Record<string, unknown>;
  /** The original line text. */
  raw: string;
}

/**
 * Result of parsing and analyzing a session file.
 */
export interface SessionAnalysis {
  /** Whether the subagent has completed its task. */
  completed: boolean;
  /** The extracted result text, if completed. */
  result?: string;
  /** The last user timestamp detected. */
  lastUserTimestamp?: number;
  /** The last assistant timestamp detected. */
  lastAssistantTimestamp?: number;
  /** Number of entries parsed. */
  entryCount: number;
}

/**
 * Parse a session JSONL file into entries.
 *
 * Skips malformed or empty lines.
 */
export function parseSessionFile(filePath: string): SessionEntry[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read session file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const entries: SessionEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      entries.push({ data, raw: trimmed });
    } catch {}
  }

  return entries;
}

/**
 * Detect the type of a session entry.
 */
function getEntryType(
  entry: SessionEntry,
): "user" | "assistant" | "tool" | "unknown" {
  const role = entry.data.role;
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool";
  return "unknown";
}

/**
 * Check if an assistant message has text content (not just tool_use blocks).
 */
function hasAssistantText(entry: SessionEntry): boolean {
  const content = entry.data.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string" &&
      (block as Record<string, unknown>).text !== "",
  );
}

/**
 * Extract text content blocks from the last assistant message.
 */
function extractAssistantText(entry: SessionEntry): string {
  const content = entry.data.content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block: unknown): block is Record<string, unknown> =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>).type === "text",
    )
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

/**
 * Analyze a session file for completion detection and result extraction.
 *
 * A subagent is considered complete when there's at least one user message
 * followed by an assistant message with text content (assistant timestamp
 * must be >= the preceding user timestamp). The monitor then enforces an
 * inactivity grace period externally.
 */
export function analyzeSession(entries: SessionEntry[]): SessionAnalysis {
  let seenUserTimestamp: number | undefined;
  let lastAssistantTimestamp: number | undefined;
  let lastAssistantEntry: SessionEntry | undefined;
  let completed = false;

  for (const entry of entries) {
    const type = getEntryType(entry);
    const timestamp = entry.data.timestamp as number | undefined;

    if (type === "user") {
      // Update the latest user timestamp so we can verify assistant comes after
      if (timestamp) seenUserTimestamp = timestamp;
    } else if (type === "assistant") {
      if (timestamp) lastAssistantTimestamp = timestamp;
      // Check if this assistant message has text content AND comes after
      // at least one user message
      if (
        hasAssistantText(entry) &&
        seenUserTimestamp !== undefined &&
        (timestamp === undefined || timestamp >= seenUserTimestamp)
      ) {
        lastAssistantEntry = entry;
      }
    }
  }

  // A subagent is considered to have responded only when a user message
  // was followed by an assistant text response after it.
  if (lastAssistantEntry) {
    completed = true;
  }

  const result = completed
    ? extractAssistantText(lastAssistantEntry!)
    : undefined;

  return {
    completed,
    result,
    lastUserTimestamp: seenUserTimestamp,
    lastAssistantTimestamp,
    entryCount: entries.length,
  };
}

/**
 * Convenience function: parse and analyze a session file in one call.
 */
export function analyzeSessionFile(filePath: string): SessionAnalysis {
  const entries = parseSessionFile(filePath);
  return analyzeSession(entries);
}
