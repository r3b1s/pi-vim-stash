import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  captureParentContext,
  formatParentContextText,
} from "#src/parent-context";
import { spawnSubagent } from "#src/spawner";
import type { Spawner } from "#src/spawner-psd";
import { importPsd } from "#src/spawner-psd";
import { isTmuxAvailable, TmuxManager } from "#src/tmux-manager";
import { createGetResultTool } from "#src/tools/get-result";
import { createSteerTool } from "#src/tools/steer";
import { createSubagentTool } from "#src/tools/subagent";
import { SubagentTracker } from "#src/tracker";
import type { SpawnParams } from "#src/types";

/**
 * Extract a stable parent session identifier from the extension context.
 * Falls back to a generated ID when the session context is unavailable.
 */
export function extractParentSessionInfo(pi: ExtensionAPI): {
  id: string;
  isReal: boolean;
} {
  try {
    const raw = pi as unknown as Record<string, unknown>;
    for (const candidate of [raw.session, raw.context]) {
      if (!candidate || typeof candidate !== "object") continue;
      const ctxObj = candidate as Record<string, unknown>;
      for (const value of [ctxObj.sessionId, ctxObj.id]) {
        if (typeof value === "string" && value.length > 0) {
          return { id: value, isReal: true };
        }
      }
    }
  } catch {
    // Ignore — warn below and fall back
  }

  const fallbackId = randomUUID().slice(0, 8);
  console.warn(
    `[pi-tmux-sessionizer] Could not extract parent session ID from ExtensionAPI. Falling back to generated ID ${fallbackId}.`,
  );
  return { id: fallbackId, isReal: false };
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const configDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi");

  // Initialize shared state
  const tracker = new SubagentTracker();
  const tmux = new TmuxManager();

  // Capture parent session identifier — real session ID if available, else generated
  const { id: parentSessionId, isReal: isRealSessionId } =
    extractParentSessionInfo(pi);

  // Pre-check tmux availability — warn early but don't abort (tools return
  // clear errors when tmux is missing, preserving graceful degradation).
  const tmuxReady = isTmuxAvailable();
  if (!tmuxReady) {
    console.warn(
      "[pi-tmux-sessionizer] tmux not found on PATH. Subagent tools will return clear errors. Install: apt install tmux or brew install tmux",
    );
  }

  // Snapshot latest parent conversation for PSD composition, where the PSD
  // tool owns execution but delegates spawn() back into PTS.
  let latestParentContext:
    | { messages: SpawnParams["parentContext"]; text: string }
    | undefined;

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName !== "subagent" && event.toolName !== "subagent_manual") {
      return;
    }

    const captured = captureParentContext(ctx);
    if (!("messages" in captured)) {
      latestParentContext = undefined;
      return;
    }

    latestParentContext = {
      messages: captured.messages,
      text: formatParentContextText(captured.messages),
    };
  });

  // Detect PSD (pi-subagents-deterministic) via dynamic import
  let psdDetected = false;

  try {
    const psd = await importPsd();
    if (psd && typeof psd.setSpawner === "function") {
      psdDetected = true;

      // Create a Spawner-compatible object wrapping PTS's tmux spawn.
      // Tmux availability is checked inside spawnSubagent (Blocker 4);
      // config dirs are only created after tmux is confirmed available.
      const psdSpawner: Spawner = {
        spawn: async (
          agentType: string,
          prompt: string,
          options: Record<string, unknown>,
        ): Promise<string> => {
          const spawnParams: SpawnParams = {
            agentType,
            prompt,
            model: options.model as string | undefined,
            thinking: options.thinkingLevel as string | undefined,
            maxTurns: options.maxTurns as number | undefined,
            inheritContext: options.inheritContext as boolean | undefined,
          };

          if (spawnParams.inheritContext) {
            if (!latestParentContext?.messages?.length) {
              const message =
                "inherit_context requested, but PTS could not capture parent conversation history from the active session. Retry from an active pi session or disable inherit_context.";
              console.warn(`[pi-tmux-sessionizer] ${message}`);
              throw new Error(message);
            }
            spawnParams.parentContext = latestParentContext.messages;
            spawnParams.parentContextText = latestParentContext.text;
          }

          return spawnSubagent(spawnParams, parentSessionId, tracker, tmux);
        },
      };

      psd.setSpawner(psdSpawner);

      // Inject result provider so that PSD's get_subagent_result tool
      // delegates to PTS's tracker. This handles the race where PSD
      // registers its result tool before PTS loads (first-writer-wins).
      if (typeof psd.setResultProvider === "function") {
        psd.setResultProvider({
          getResult: async (agentId: string) => {
            const record = tracker.get(agentId);
            if (!record) {
              return null; // Not a PTS agent — let PSD fall back to svc
            }
            let text: string;
            switch (record.status) {
              case "starting":
              case "running":
                text = `Agent ${agentId} is still running (status: ${record.status}). Call get_subagent_result again to check.`;
                break;
              case "completed":
                text = [
                  `Status: completed`,
                  `Result: ${record.result ?? "(no result)"}`,
                  `Type: ${record.type}`,
                  `Duration: ${record.completedAt ? ((record.completedAt - record.startedAt) / 1000).toFixed(1) : "?"}s`,
                ].join("\n");
                break;
              case "stopped":
                text = `Agent ${agentId} was stopped. Type: ${record.type}.`;
                break;
              case "error":
                text = `Agent ${agentId} encountered an error: ${record.error ?? "Unknown error"}`;
                break;
              default:
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                text = `Agent ${agentId} status: ${record.status}`;
            }
            return {
              content: [{ type: "text" as const, text }],
              details: {},
            };
          },
        });
      }

      console.log(
        `[pi-tmux-sessionizer] PSD detected — setSpawner and setResultProvider called. PSD handles subagent tool routing. Session: ${parentSessionId}${isRealSessionId ? " (from extension context)" : " (generated)"}`,
      );
    }
  } catch {
    // PSD not installed — standalone mode
    console.warn(
      `[pi-tmux-sessionizer] PSD not detected during extension init — running in standalone mode. If PSD is installed but loaded later, reload extensions/session to enable composition and avoid get_subagent_result routing races. Session: ${parentSessionId}`,
    );
  }

  // Always register get_subagent_result
  pi.registerTool(createGetResultTool(tracker));

  // Always register steer_subagent
  pi.registerTool(createSteerTool(tracker, tmux));

  // Register subagent tool only when PSD is absent (standalone mode)
  if (!psdDetected) {
    pi.registerTool(
      createSubagentTool(
        configDir,
        parentSessionId,
        tracker,
        tmux,
        undefined,
        isRealSessionId ? parentSessionId : undefined,
      ),
    );
  }

  // Handle session shutdown: clean up tmux sessions and config dirs
  pi.on("session_shutdown", async () => {
    const sessionName = `_pi-sub-${parentSessionId}`;
    try {
      if (tmux.sessionExists(sessionName)) {
        tmux.destroySession(sessionName);
      }
    } catch (err) {
      console.error(
        `[pi-tmux-sessionizer] Failed to clean up tmux session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Clean up config directories
    try {
      const { destroyParentConfigs } = await import("#src/subagent-config");
      destroyParentConfigs(parentSessionId);
    } catch {
      // Best-effort cleanup
    }

    tracker.clear();
  });
}
