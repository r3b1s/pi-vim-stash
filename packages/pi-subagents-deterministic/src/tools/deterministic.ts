import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SpawnOptions, SubagentsService } from "@gotgenes/pi-subagents";
import { Type } from "@sinclair/typebox";
import { readModelRouting, resolveModelsForType } from "#src/config";
import { textResult } from "#src/tools/helpers";

/**
 * Compact agent-selection guidance embedded in the tool description.
 * Only agent type names — no model names or thinking levels.
 */
const SELECTION_GUIDANCE = [
  "Agent selection guidance (use subagent_type):",
  "- Code search / file exploration \u2192 Explore",
  "- Web research / information gathering \u2192 websearch",
  "- Architecture / implementation planning \u2192 Plan",
  "- Implementation from plan \u2192 implementer",
  "- Code review / quality checks \u2192 reviewer",
  "- Project retrospective / learning \u2192 retro",
  "- Session reflection / summarization \u2192 reflect",
  "- General-purpose complex tasks \u2192 general-purpose",
  "",
  "For manual model/thinking overrides, use subagent_manual instead.",
].join("\n");

export class SubagentDeterministicTool {
  constructor(
    private readonly configDir: string,
    private readonly svc: SubagentsService | undefined,
  ) {}

  toToolDefinition() {
    return defineTool({
      name: "subagent" as const,
      label: "Subagent (deterministic)",
      description: [
        "Launch a specialized agent for complex, multi-step tasks.",
        "Model and thinking level are automatically resolved from model-routing.yml.",
        "Results are retrieved via get_subagent_result. Always non-blocking — never waits.",
        "",
        SELECTION_GUIDANCE,
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
        // Resume is not supported via SubagentsService public API.
        // Use pi-subagents' raw subagent tool for resume.
      }),
      // biome-ignore lint/suspicious/noExplicitAny: SDK theme types not exported
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
      // biome-ignore lint/suspicious/noExplicitAny: SDK result types not exported
      renderResult(result: any, _options: any, _theme: any) {
        const text =
          result.content[0]?.type === "text" ? result.content[0].text : "";
        return new Text(text, 0, 0);
      },
      execute: (
        _toolCallId: string,
        params: Record<string, unknown>,
        _signal: AbortSignal | undefined,
        // biome-ignore lint/suspicious/noExplicitAny: SDK callback types not exported
        _onUpdate: ((update: any) => void) | undefined,
        // biome-ignore lint/suspicious/noExplicitAny: SDK context types not exported
        _ctx: any,
      ) => this.execute(params),
    });
  }

  async execute(
    params: Record<string, unknown>,
  ): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
    try {
      const agentType = params.subagent_type as string | undefined;
      const prompt = params.prompt as string | undefined;

      if (!agentType || !prompt) {
        return textResult("subagent_type and prompt are required.");
      }

      // Parse remaining params
      const description = params.description as string | undefined;
      const inheritContext = params.inherit_context as boolean | undefined;
      const maxTurns = params.max_turns as number | undefined;
      const runInBackground = params.run_in_background as boolean | undefined;

      // Read config (fresh every call — no caching)
      const routing = readModelRouting(this.configDir);
      if (typeof routing === "string") {
        return textResult(routing);
      }

      // Resolve models for this agent type
      const resolved = resolveModelsForType(agentType, routing);
      if (typeof resolved === "string") {
        if (resolved.includes("No routing config found for agent type")) {
          console.warn(
            `[pi-subagents-deterministic] No routing config found for agent type: ${agentType}`,
          );
        }
        return textResult(resolved);
      }

      // Ensure SubagentsService is available
      if (!this.svc) {
        return textResult(
          "SubagentsService not available. Ensure @gotgenes/pi-subagents is loaded.",
        );
      }

      // Build spawn options
      const spawnOptions: SpawnOptions = {
        description: description ?? prompt.slice(0, 80),
        inheritContext,
        maxTurns,
      };
      // Only pass foreground when explicitly set
      if (runInBackground !== undefined) {
        spawnOptions.foreground = !runInBackground;
      }

      // Handle empty resolved list (all entries malformed)
      if (resolved.length === 0) {
        return textResult(
          `No valid models configured for agent type ${agentType}. All model entries were malformed.`,
        );
      }

      // Iterate model list with fallback
      const failedModels: string[] = [];
      for (const entry of resolved) {
        try {
          const agentId = this.svc.spawn(agentType, prompt, {
            ...spawnOptions,
            model: entry.model,
            thinkingLevel: entry.thinking,
          });
          return textResult(agentId);
        } catch {
          failedModels.push(entry.model);
        }
      }

      // All models failed
      return textResult(
        `All models failed for agent type ${agentType}: tried ${failedModels.join(", ")}.`,
      );
    } catch (err) {
      return textResult(
        `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
