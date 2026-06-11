import { randomUUID } from "node:crypto";
import { buildParentContext } from "#src/parent-context";
import { monitorSubagent } from "#src/session-monitor";
import {
  createSubagentConfig,
  destroySubagentConfig,
} from "#src/subagent-config";
import {
  isTmuxAvailable,
  makeWindowName,
  shellEscape,
  type TmuxManager,
} from "#src/tmux-manager";
import type { SubagentTracker } from "#src/tracker";
import type { SpawnParams } from "#src/types";

/**
 * Spawn a subagent in a tmux window.
 *
 * Coordinates:
 * 1. Tmux availability check (fails fast before config creation)
 * 2. Agent ID generation
 * 3. Config directory creation
 * 4. Tmux session/window creation (first subagent gets window 0)
 * 5. Pi launch command construction
 * 6. Session file monitoring (fire-and-forget)
 *
 * Returns a promise that resolves with the agent ID once the tmux
 * window has been created (monitoring continues in the background).
 */
export async function spawnSubagent(
  params: SpawnParams,
  parentSessionId: string,
  tracker: SubagentTracker,
  tmux: TmuxManager,
  abortSignal?: AbortSignal,
): Promise<string> {
  // Fail fast — check tmux before creating any config directories
  if (!isTmuxAvailable()) {
    throw new Error(
      "tmux is required but not found. Install with: apt install tmux or brew install tmux",
    );
  }

  const agentId = randomUUID();

  // Build effective prompt: prepend parent context if inheritContext is set
  let effectivePrompt = params.prompt;
  if (params.inheritContext) {
    if (params.parentContext && params.parentContext.length > 0) {
      effectivePrompt = buildParentContext(params.parentContext, params.prompt);
    } else if (params.parentContextText) {
      effectivePrompt = buildParentContext(
        [{ role: "user", content: params.parentContextText }],
        params.prompt,
      );
    } else {
      throw new Error(
        "inherit_context requested, but no parent conversation context was captured.",
      );
    }
  }

  // Create config directory
  const { configDir, sessionDir } = createSubagentConfig(
    parentSessionId,
    agentId,
    {
      model: params.model,
      thinking: params.thinking,
      maxTurns: params.maxTurns,
    },
  );

  try {
    // Build pi launch command
    const piArgs = ["pi", "--session-id", agentId];
    if (params.model) {
      piArgs.push("--model", params.model);
    }
    if (params.thinking) {
      piArgs.push("--thinking", params.thinking);
    }
    // The prompt is the last argument
    piArgs.push(effectivePrompt);

    const command = shellEscape(piArgs);

    // Create or reuse tmux session
    const sessionName = tmux.ensureSession(parentSessionId);
    const windowName = makeWindowName(params.agentType, agentId);

    // Set environment variables for the pi process
    const envCommand = `PI_CODING_AGENT_DIR=${shellEscape([configDir])} PI_CODING_AGENT_SESSION_DIR=${shellEscape([sessionDir])} ${command}`;

    // Create tmux window (first call creates session + first window)
    const windowIndex = tmux.createWindow(sessionName, windowName, envCommand);

    // Track the agent
    tracker.add({
      id: agentId,
      type: params.agentType,
      prompt: params.prompt,
      status: "starting",
      sessionName,
      windowIndex,
      configDir,
      startedAt: Date.now(),
    });

    // Start monitoring (fire-and-forget)
    monitorSubagent(tracker, agentId, sessionDir, abortSignal).catch((err) => {
      console.error(
        `[pi-tmux-sessionizer] Monitor error for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return agentId;
  } catch (error) {
    destroySubagentConfig(parentSessionId, agentId);
    throw error;
  }
}
