import { type FSWatcher, readdirSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { analyzeSessionFile } from "#src/session-parser";
import type { SubagentTracker } from "#src/tracker";

/**
 * Monitor session files for subagent completion.
 *
 * Polls the session directory for the session file and monitors it
 * for completion using the session parser.
 */

const POLL_INTERVAL_MS = 500;
const MAX_STARTUP_WAIT_MS = 10_000;
const INACTIVITY_GRACE_MS = 3_000;

/**
 * Maximum total time to poll for agent completion before declaring timeout.
 * 5 minutes.
 */
export const MAX_POLL_TIME_MS = 300_000;

/**
 * Maximum number of consecutive polls with no entry count change while the
 * agent is not yet completed. Triggers stale-no-progress detection.
 * 30 polls × 500ms = ~15 seconds of no progress.
 */
export const MAX_STALE_POLLS = 30;

/**
 * Time to wait for the first fs.watch event before falling back to polling.
 * 30 seconds — gives the agent time to start writing but avoids hanging
 * if fs.watch is unreliable (WSL, Docker, network filesystems).
 */
export const WATCH_TIMEOUT_MS = 30_000;

/**
 * Polling interval used after falling back from fs.watch.
 * 1 second — more relaxed than the startup polling interval (500ms)
 * to reduce overhead on long-running quiet agents.
 */
export const FALLBACK_POLL_INTERVAL_MS = 1_000;

/**
 * Maximum stale polls in fallback polling mode.
 * 60 polls × 1s = 60 seconds of no progress before declaring stall.
 * Much more lenient than the normal stale threshold (15s) to avoid
 * false failures for agents that are thinking without writing output.
 */
export const FALLBACK_MAX_STALE_POLLS = 60;

/**
 * Result of monitoring a single agent.
 */
export interface MonitorResult {
  completed: boolean;
  result?: string;
}

/**
 * Monitor a single subagent's session file for completion.
 *
 * Polls the session directory until the file appears, then monitors
 * for completion. Returns once the agent completes or an error occurs.
 *
 * @param tracker - The subagent tracker to update
 * @param agentId - The agent ID to monitor
 * @param sessionDir - The session directory to scan for JSONL files
 * @param signal - Optional abort signal to cancel monitoring
 * @returns A promise that resolves with the monitor result
 */
export async function monitorSubagent(
  tracker: SubagentTracker,
  agentId: string,
  sessionDir: string,
  signal?: AbortSignal,
): Promise<MonitorResult> {
  // Wait for the session file to appear
  const filePath = await waitForSessionFile(sessionDir, agentId, signal);
  if (!filePath) {
    const msg = "Session file not found within startup timeout";
    tracker.setError(agentId, msg);
    tracker.updateStatus(agentId, "error");
    return { completed: false, result: undefined };
  }

  // Store the file path
  tracker.setSessionFilePath(agentId, filePath);
  tracker.updateStatus(agentId, "running");

  // Monitor for completion — prefer fs.watch with polling fallback
  return watchForCompletion(tracker, agentId, filePath, signal);
}

/**
 * Wait for the session file to appear (pi process startup).
 * Polls every 500ms for up to maxStartupWaitMs.
 */
async function waitForSessionFile(
  sessionDir: string,
  agentId: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_STARTUP_WAIT_MS) {
    if (signal?.aborted) return undefined;

    const filePath = findSessionFile(sessionDir, agentId);
    if (filePath) return filePath;

    await sleep(POLL_INTERVAL_MS);
  }

  return undefined;
}

/**
 * Find the session file for a given agent ID.
 *
 * The file follows pi's convention:
 * <sessionDir>/<cwd-hash>/<timestamp>_<agentId>.jsonl
 */
export function findSessionFile(
  sessionDir: string,
  agentId: string,
): string | undefined {
  let subdirs: string[];
  try {
    subdirs = readdirSync(sessionDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return undefined;
  }

  for (const subdir of subdirs) {
    const dirPath = join(sessionDir, subdir);
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      // Match something like "20240101_abc123.jsonl" where abc123 is the agentId
      if (file.endsWith(`_${agentId}.jsonl`)) {
        return join(dirPath, file);
      }
    }
  }

  return undefined;
}

/**
 * Poll for completion of a subagent.
 *
 * Check every POLL_INTERVAL_MS. Once the parser reports completed
 * (user → assistant text), wait INACTIVITY_GRACE_MS with a stable
 * entry count before declaring done. If new entries appear, restart
 * the grace period.
 */
export async function pollForCompletion(
  tracker: SubagentTracker,
  agentId: string,
  filePath: string,
  signal?: AbortSignal,
  maxPollTimeMs = MAX_POLL_TIME_MS,
  maxStalePolls = MAX_STALE_POLLS,
  pollIntervalMs = POLL_INTERVAL_MS,
): Promise<MonitorResult> {
  let lastInactivityStart: number | undefined;
  let lastEntryCount = 0;
  const startTime = Date.now();
  let stalePolls = 0;

  while (!signal?.aborted) {
    // Check overall timeout before attempting a poll cycle
    if (Date.now() - startTime >= maxPollTimeMs) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const msg = `Agent timed out after ${elapsedSec}s — no completion detected within the maximum poll time.`;
      tracker.setError(agentId, msg);
      tracker.updateStatus(agentId, "error");
      return { completed: false, result: undefined };
    }

    await sleep(pollIntervalMs);

    try {
      const analysis = analyzeSessionFile(filePath);

      if (analysis.completed && analysis.result) {
        if (analysis.entryCount === lastEntryCount) {
          // No new entries — check inactivity grace period
          if (!lastInactivityStart) {
            lastInactivityStart = Date.now();
          } else if (Date.now() - lastInactivityStart >= INACTIVITY_GRACE_MS) {
            // Stable completion — grace period elapsed
            const result = analysis.result;
            tracker.setResult(agentId, result);
            tracker.updateStatus(agentId, "completed");
            return { completed: true, result };
          }
        } else {
          // New entries appeared — record latest state and restart grace
          lastEntryCount = analysis.entryCount;
          lastInactivityStart = undefined;
        }
      } else {
        // Not yet completed — check for stale no-progress
        if (analysis.entryCount === lastEntryCount) {
          stalePolls++;
          if (stalePolls >= maxStalePolls) {
            const msg = `Agent stalled — no new entries for ${(stalePolls * pollIntervalMs) / 1000}s. Marking as error.`;
            tracker.setError(agentId, msg);
            tracker.updateStatus(agentId, "error");
            return { completed: false, result: undefined };
          }
        } else {
          stalePolls = 0;
          lastEntryCount = analysis.entryCount;
        }
        // Reset inactivity timer
        lastInactivityStart = undefined;
      }
    } catch {
      // File may be temporarily unreadable (partial write, etc.)
      // Wait and retry — reset stale counter on read error since we
      // can't reliably evaluate progress
    }
  }

  // Signal aborted
  tracker.updateStatus(agentId, "stopped");
  return { completed: false, result: undefined };
}

/**
 * Monitor a subagent's session file for completion using fs.watch
 * as the primary detection mechanism, with polling as fallback.
 *
 * After the session file is discovered, this function:
 * 1. Sets up fs.watch on the file's parent directory
 * 2. On each relevant watch event, analyzes the file for completion
 * 3. On completion with stable entry count, waits INACTIVITY_GRACE_MS
 *    before declaring completion
 * 4. If no watch events fire within WATCH_TIMEOUT_MS (30s), closes the
 *    watcher and switches permanently to FALLBACK_POLL_INTERVAL_MS polling
 * 5. If fs.watch throws or emits an error, falls back to polling
 *
 * Completion semantics (in both watch and poll modes):
 * - Need user message followed by assistant text content
 * - Stable entry count for INACTIVITY_GRACE_MS before declaring done
 * - New entries reset the grace period
 */
export async function watchForCompletion(
  tracker: SubagentTracker,
  agentId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<MonitorResult> {
  return new Promise<MonitorResult>((resolve) => {
    const dirPath = dirname(filePath);
    const fileName = basename(filePath);
    const startTime = Date.now();

    let watcher: FSWatcher | undefined;
    let watchTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let graceTimerId: ReturnType<typeof setTimeout> | undefined;
    let lastEntryCount = 0;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (watchTimeoutId) {
        clearTimeout(watchTimeoutId);
        watchTimeoutId = undefined;
      }
      if (graceTimerId) {
        clearTimeout(graceTimerId);
        graceTimerId = undefined;
      }
      if (watcher) {
        watcher.close();
        watcher = undefined;
      }
    };

    const onAbort = () => {
      if (closed) return;
      cleanup();
      signal?.removeEventListener("abort", onAbort);
      tracker.updateStatus(agentId, "stopped");
      resolve({ completed: false, result: undefined });
    };

    const fallbackToPolling = () => {
      cleanup();
      signal?.removeEventListener("abort", onAbort);
      const elapsed = Date.now() - startTime;
      const remainingTime = Math.max(MAX_POLL_TIME_MS - elapsed, 10_000);
      resolve(
        pollForCompletion(
          tracker,
          agentId,
          filePath,
          signal,
          remainingTime,
          FALLBACK_MAX_STALE_POLLS,
          FALLBACK_POLL_INTERVAL_MS,
        ),
      );
    };

    const handleWatchEvent = (
      _eventType: string,
      filename: string | Buffer | null,
    ) => {
      if (closed) return;

      // Normalize filename (may be Buffer on macOS, null on some platforms)
      if (filename !== null && filename !== undefined) {
        const eventFilename =
          typeof filename === "string" ? filename : filename.toString();
        // Only process events for our specific file
        if (eventFilename !== fileName) {
          return;
        }
      }
      // If filename is null/undefined, process the event anyway since
      // some platforms don't provide the filename on change events.

      // Got a relevant watch event — clear the first-event timeout
      if (watchTimeoutId) {
        clearTimeout(watchTimeoutId);
        watchTimeoutId = undefined;
      }

      // Analyze the session file
      try {
        const analysis = analyzeSessionFile(filePath);

        if (analysis.completed && analysis.result) {
          // Capture result for closure (TypeScript narrows through const
          // declarations but not across setTimeout boundaries)
          const capturedResult: string = analysis.result;
          if (analysis.entryCount === lastEntryCount) {
            // Stable entry count — start inactivity grace if not already
            if (!graceTimerId) {
              graceTimerId = setTimeout(() => {
                cleanup();
                signal?.removeEventListener("abort", onAbort);
                tracker.setResult(agentId, capturedResult);
                tracker.updateStatus(agentId, "completed");
                resolve({ completed: true, result: capturedResult });
              }, INACTIVITY_GRACE_MS);
            }
          } else {
            // Entry count changed — reset grace
            lastEntryCount = analysis.entryCount;
            if (graceTimerId) {
              clearTimeout(graceTimerId);
              graceTimerId = undefined;
            }
          }
        } else {
          // Not yet completed
          lastEntryCount = analysis.entryCount;
          if (graceTimerId) {
            clearTimeout(graceTimerId);
            graceTimerId = undefined;
          }
        }
      } catch {
        // File may be temporarily unreadable (partial write, etc.)
      }
    };

    // ---- early exit on pre-aborted signal ----

    if (signal?.aborted) {
      tracker.updateStatus(agentId, "stopped");
      resolve({ completed: false, result: undefined });
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    // ---- set up fs.watch ----

    try {
      watcher = watch(dirPath, handleWatchEvent);

      watcher.on("error", () => {
        if (!closed) fallbackToPolling();
      });

      // Timeout: if no relevant events fire within WATCH_TIMEOUT_MS,
      // close the watcher and switch permanently to polling.
      watchTimeoutId = setTimeout(() => {
        if (!closed) fallbackToPolling();
      }, WATCH_TIMEOUT_MS);
    } catch {
      // fs.watch setup failed — fall back immediately
      if (!closed) fallbackToPolling();
    }
  });
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
