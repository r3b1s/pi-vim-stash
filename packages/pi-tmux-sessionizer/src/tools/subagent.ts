import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { readModelRouting, resolveModelsForType } from "#src/model-routing";
import {
  captureParentContext,
  formatParentContextText,
} from "#src/parent-context";
import { spawnSubagent } from "#src/spawner";
import { destroySubagentConfig } from "#src/subagent-config";
import { isTmuxAvailable, type TmuxManager } from "#src/tmux-manager";
import { textResult } from "#src/tools/helpers";
import type { SubagentTracker } from "#src/tracker";
import type { SpawnParams } from "#src/types";

/**
 * Standalone subagent tool for pi-tmux-sessionizer.
 *
 * Registered only when pi-subagents-deterministic is NOT installed.
 * When both are present, PSD's subagent tool wins (name collision)
 * and routes through PTS's tmux spawner via setSpawner().
 */

/**
 * Build the plugin subagent tool definition.
 *
 * @param parentSessionLabel - When provided, included in the return text
 *   so the LLM knows which tmux session to target.
 */
export function createSubagentTool(
  configDir: string,
  parentSessionId: string,
  tracker: SubagentTracker,
  tmux: TmuxManager,
  abortSignal?: AbortSignal,
  parentSessionLabel?: string,
) {
  return defineTool({
    name: "subagent" as const,
    label: "Subagent (tmux)",
    description: [
      "Launch a specialized agent for complex, multi-step tasks.",
      "Model and thinking level are automatically resolved from model-routing.yml.",
      "The agent runs in a tmux window for full observability.",
      "Results are retrieved via get_subagent_result.",
      "Steer the agent via steer_subagent or by typing directly in the tmux window.",
      "",
      "Agent selection guidance (use subagent_type):",
      "- Code search / file exploration → Explore",
      "- Web research / information gathering → websearch",
      "- Architecture / implementation planning → Plan",
      "- Implementation from plan → implementer",
      "- Code review / quality checks → reviewer",
      "- General-purpose complex tasks → general-purpose",
      "",
      "For manual model/thinking overrides, use subagent_manual instead.",
    ].join("\n"),
    parameters: Type.Object({
      subagent_type: Type.String({
        description: "The type of specialized agent to use.",
      }),
      prompt: Type.String({
        description: "The task for the agent to perform.",
      }),
      description: Type.String({
        description:
          "A short (3-5 word) description of the task (shown in UI).",
      }),
      run_in_background: Type.Optional(
        Type.Boolean({
          description:
            "Set to true to run in background. Returns agent ID immediately.",
        }),
      ),
      inherit_context: Type.Optional(
        Type.Boolean({
          description:
            "If true, fork parent conversation into the agent. Default: false.",
        }),
      ),
      max_turns: Type.Optional(
        Type.Number({
          description: "Maximum number of agentic turns.",
          minimum: 1,
        }),
      ),
      model: Type.Optional(
        Type.String({
          description: "Model override (bypasses model-routing.yml).",
        }),
      ),
      thinking: Type.Optional(
        Type.String({
          description: "Thinking level override (bypasses model-routing.yml).",
        }),
      ),
      resume: Type.Optional(
        Type.String({
          description:
            "Resume / re-prompt an existing agent. Provide the agent ID to send a new prompt to its tmux window. Requires prompt to be set.",
        }),
      ),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: SDK theme types
    renderCall(args: Record<string, unknown>, theme: any) {
      const agentType = (args.subagent_type as string) ?? "subagent";
      const desc = (args.description as string | undefined) ?? "";
      return new Text(
        "\u25b8 " +
          theme.fg("toolTitle", theme.bold(agentType)) +
          (desc ? `  ${theme.fg("muted", desc)}` : ""),
        0,
        0,
      );
    },
    // biome-ignore lint/suspicious/noExplicitAny: SDK result types
    renderResult(result: any, _options: any, _theme: any) {
      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      return new Text(text, 0, 0);
    },
    execute: (
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      // biome-ignore lint/suspicious/noExplicitAny: SDK callback types
      _onUpdate: ((update: any) => void) | undefined,
      // biome-ignore lint/suspicious/noExplicitAny: SDK context types
      _ctx: any,
    ) =>
      execute(
        params,
        configDir,
        parentSessionId,
        tracker,
        tmux,
        // Combine the outer (parent session) abort signal with the tool
        // execution signal so either can cancel polling / spawning.
        combineSignals([abortSignal, _signal]),
        parentSessionLabel,
        _ctx,
      ),
  });
}

async function execute(
  params: Record<string, unknown>,
  configDir: string,
  parentSessionId: string,
  tracker: SubagentTracker,
  tmux: TmuxManager,
  abortSignal?: AbortSignal,
  parentSessionLabel?: string,
  toolContext?: Parameters<typeof captureParentContext>[0],
): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
  try {
    const agentType = params.subagent_type as string | undefined;
    const prompt = params.prompt as string | undefined;
    const resumeId = params.resume as string | undefined;

    if (!prompt) {
      return textResult("prompt is required.");
    }

    // Handle resume: send prompt to existing agent's tmux window
    if (resumeId) {
      const record = tracker.get(resumeId);
      if (!record) {
        return textResult(`Agent not found: ${resumeId}`);
      }

      if (!isTmuxAvailable()) {
        return textResult(
          "tmux is required but not found. Install with: apt install tmux or brew install tmux",
        );
      }

      // Send the prompt as a steer message
      const isShort = prompt.length <= 200 && !prompt.includes("\n");
      if (isShort) {
        tmux.sendKeys(record.sessionName, record.windowIndex, prompt);
      } else {
        tmux.sendKeysLong(record.sessionName, record.windowIndex, prompt);
      }
      tmux.sendEnter(record.sessionName, record.windowIndex);

      return textResult(
        `Resumed agent ${resumeId}. Prompt sent to its tmux window.`,
      );
    }

    // Normal spawn path
    if (!agentType) {
      return textResult(
        "subagent_type is required (or use resume to re-prompt an existing agent).",
      );
    }

    // Check tmux availability
    if (!isTmuxAvailable()) {
      return textResult(
        "tmux is required but not found. Install with: apt install tmux or brew install tmux",
      );
    }

    // Determine model(s) to try
    const explicitModel = params.model as string | undefined;
    const thinking = params.thinking as string | undefined;

    if (explicitModel) {
      // Explicit model provided — single attempt, fire-and-forget.
      // Returns agent ID immediately (preserves current behavior).
      return executeWithModel({
        agentType,
        prompt,
        explicitModel,
        thinking,
        params,
        configDir,
        parentSessionId,
        tracker,
        tmux,
        abortSignal,
        parentSessionLabel,
        toolContext,
      });
    }

    // Auto-routing: resolve the full model list for fallback
    const modelsToTry = resolveModelList(configDir, agentType, thinking);

    if (modelsToTry.length === 0) {
      // No routing config — proceed without a model override
      return executeWithModel({
        agentType,
        prompt,
        explicitModel: undefined,
        thinking,
        params,
        configDir,
        parentSessionId,
        tracker,
        tmux,
        abortSignal,
        parentSessionLabel,
        toolContext,
      });
    }

    // Try each model in sequence until one completes successfully
    const errors: string[] = [];

    for (let i = 0; i < modelsToTry.length; i++) {
      const entry = modelsToTry[i];

      if (abortSignal?.aborted) {
        return textResult(
          `Subagent spawn aborted after ${i} model attempt(s). Models tried: ${modelsToTry
            .slice(0, i)
            .map((m) => m.model)
            .join(", ")}`,
        );
      }

      const result = await tryModel(
        agentType,
        prompt,
        entry.model,
        entry.thinking ?? thinking,
        params,
        configDir,
        parentSessionId,
        tracker,
        tmux,
        abortSignal,
        toolContext,
      );

      if (result.completed) {
        return textResult(
          formatCompletionText(result.agentId, tracker, parentSessionLabel),
        );
      }

      // Model failed — capture error and try next
      const record = tracker.get(result.agentId);
      errors.push(
        `Model "${entry.model}" ${result.status !== "timeout" ? `(${result.status})` : "(timeout)"}: ${record?.error ?? result.error ?? "Unknown error"}`,
      );

      // Clean up failed agent config so it doesn't linger
      destroySubagentConfig(parentSessionId, result.agentId);
      tracker.remove(result.agentId);
    }

    // All models failed
    return textResult(
      `All ${modelsToTry.length} model(s) failed to produce a result:\n${errors.join("\n")}\n\nYou may retry with an explicit model override via the model parameter.`,
    );
  } catch (err) {
    return textResult(
      `Failed to spawn subagent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combine multiple optional AbortSignals into a single signal that aborts
 * when any of the inputs abort. Returns undefined if no signals provided.
 */
function combineSignals(
  signals: (AbortSignal | undefined)[],
): AbortSignal | undefined {
  const valid = signals.filter((s): s is AbortSignal => s !== undefined);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  // If any signal is already aborted, return an already-aborted signal
  for (const s of valid) {
    if (s.aborted) {
      const c = new AbortController();
      c.abort(s.reason);
      return c.signal;
    }
  }

  const controller = new AbortController();
  const onAbort = () => {
    for (const s of valid) {
      if (s.aborted) {
        controller.abort(s.reason);
        break;
      }
    }
  };

  for (const s of valid) {
    s.addEventListener("abort", onAbort, { once: true });
  }

  return controller.signal;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Context needed by both executeWithModel and tryModel.
 */
interface ModelAttemptContext {
  agentType: string;
  prompt: string;
  explicitModel?: string;
  thinking?: string;
  params: Record<string, unknown>;
  configDir: string;
  parentSessionId: string;
  tracker: SubagentTracker;
  tmux: TmuxManager;
  abortSignal?: AbortSignal;
  parentSessionLabel?: string;
  toolContext?: Parameters<typeof captureParentContext>[0];
}

/**
 * Result of a single model attempt.
 */
interface ModelAttemptResult {
  completed: boolean;
  agentId: string;
  status: string;
  error?: string;
}

/**
 * Resolve the list of models to try for a given agent type.
 * Returns an ordered list of {model, thinking} entries.
 */
function resolveModelList(
  configDir: string,
  agentType: string,
  _thinking?: string,
): { model: string; thinking?: string }[] {
  const routing = readModelRouting(configDir);
  if (!routing) return [];

  const resolved = resolveModelsForType(agentType, routing);
  if (!resolved || resolved.length === 0) return [];

  return resolved;
}

/**
 * Execute a single model attempt (fire-and-forget).
 * Used when an explicit model is provided or when there's only one model to try.
 */
async function executeWithModel(
  ctx: ModelAttemptContext,
): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
  const {
    agentType,
    prompt,
    explicitModel,
    thinking,
    params,
    configDir: _cd,
    parentSessionId,
    tracker,
    tmux,
    abortSignal,
    parentSessionLabel,
    toolContext,
  } = ctx;

  // When explicit model is given, use it directly. Otherwise resolve from routing.
  let model = explicitModel;
  let effectiveThinking = thinking;

  if (!model) {
    const routing = readModelRouting(_cd);
    if (routing) {
      const resolved = resolveModelsForType(agentType, routing);
      if (resolved && resolved.length > 0) {
        model = resolved[0].model;
        effectiveThinking = effectiveThinking ?? resolved[0].thinking;
      }
    }
  }

  // Build spawn params
  const spawnParams: SpawnParams = {
    agentType,
    prompt,
    description: params.description as string | undefined,
    model,
    thinking: effectiveThinking,
    maxTurns: params.max_turns as number | undefined,
    inheritContext: params.inherit_context as boolean | undefined,
  };

  if (spawnParams.inheritContext) {
    const captured = captureParentContext(toolContext);
    if (!("messages" in captured)) {
      console.warn(`[pi-tmux-sessionizer] ${captured.warning}`);
      return textResult(captured.warning);
    }
    spawnParams.parentContext = captured.messages;
    spawnParams.parentContextText = formatParentContextText(captured.messages);
  }

  const agentId = await spawnSubagent(
    spawnParams,
    parentSessionId,
    tracker,
    tmux,
    abortSignal,
  );

  return textResult(
    buildMetaText(agentId, tracker, parentSessionLabel, parentSessionId),
  );
}

/**
 * Try a single model: spawn the agent and wait for it to complete.
 * Returns the agent ID and whether it completed successfully.
 */
async function tryModel(
  agentType: string,
  prompt: string,
  model: string | undefined,
  thinking: string | undefined,
  params: Record<string, unknown>,
  _configDir: string,
  parentSessionId: string,
  tracker: SubagentTracker,
  tmux: TmuxManager,
  abortSignal?: AbortSignal,
  toolContext?: Parameters<typeof captureParentContext>[0],
): Promise<ModelAttemptResult> {
  const spawnParams: SpawnParams = {
    agentType,
    prompt,
    description: params.description as string | undefined,
    model,
    thinking,
    maxTurns: params.max_turns as number | undefined,
    inheritContext: params.inherit_context as boolean | undefined,
  };

  if (spawnParams.inheritContext) {
    const captured = captureParentContext(toolContext);
    if (!("messages" in captured)) {
      return {
        completed: false,
        agentId: "",
        status: "error",
        error: captured.warning,
      };
    }
    spawnParams.parentContext = captured.messages;
    spawnParams.parentContextText = formatParentContextText(captured.messages);
  }

  let agentId: string;
  try {
    agentId = await spawnSubagent(
      spawnParams,
      parentSessionId,
      tracker,
      tmux,
      abortSignal,
    );
  } catch (err) {
    return {
      completed: false,
      agentId: "",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Wait for the agent to complete (blocking)
  const status = await waitForAgentCompletion(tracker, agentId, abortSignal);

  if (status === "completed") {
    return { completed: true, agentId, status };
  }

  const record = tracker.get(agentId);
  return {
    completed: false,
    agentId,
    status,
    error: record?.error ?? `Agent ended with status: ${status}`,
  };
}

/**
 * Wait for a subagent to complete by polling the tracker.
 * Returns the terminal status: "completed", "error", "stopped", or "timeout".
 */
async function waitForAgentCompletion(
  tracker: SubagentTracker,
  agentId: string,
  signal?: AbortSignal,
  timeoutMs = 300_000,
): Promise<"completed" | "error" | "stopped" | "timeout"> {
  const startTime = Date.now();

  while (!signal?.aborted) {
    if (Date.now() - startTime > timeoutMs) {
      tracker.setError(
        agentId,
        "Agent timed out while waiting for completion.",
      );
      tracker.updateStatus(agentId, "error");
      return "timeout";
    }

    const record = tracker.get(agentId);
    if (!record) return "error";
    if (record.status === "completed") return "completed";
    if (record.status === "error") return "error";
    if (record.status === "stopped") return "stopped";

    await sleep(500);
  }

  // Signal aborted
  tracker.updateStatus(agentId, "stopped");
  return "stopped";
}

/**
 * Build the metadata text returned to the LLM after spawning an agent.
 */
function buildMetaText(
  agentId: string,
  tracker: SubagentTracker,
  parentSessionLabel?: string,
  parentSessionId?: string,
): string {
  const record = tracker.get(agentId);
  const sessionName =
    record?.sessionName ?? `_pi-sub-${parentSessionId ?? "unknown"}`;
  const windowIndex = record?.windowIndex ?? 0;
  const metaLines = [
    `Agent ${agentId} spawned in tmux session '${sessionName}', window ${windowIndex}.`,
    `Attach: tmux attach -t ${sessionName}:${windowIndex}`,
    `Use get_subagent_result to retrieve results, steer_subagent to steer.`,
  ];
  if (parentSessionLabel) {
    metaLines.push(`Parent session: ${parentSessionLabel}`);
  }
  return metaLines.join("\n");
}

/**
 * Format the completion text returned when an auto-routed agent finishes.
 */
function formatCompletionText(
  agentId: string,
  tracker: SubagentTracker,
  parentSessionLabel?: string,
): string {
  const record = tracker.get(agentId);
  const lines: string[] = [];

  lines.push(`Agent ${agentId} completed.`);

  if (record?.result) {
    // Cap the result at a reasonable size to avoid flooding
    const result =
      record.result.length > 10_000
        ? `${record.result.slice(0, 10_000)}\n... [result truncated at 10,000 characters]`
        : record.result;
    lines.push("");
    lines.push(result);
  }

  if (parentSessionLabel) {
    lines.push("");
    lines.push(`Parent session: ${parentSessionLabel}`);
  }

  return lines.join("\n");
}
