import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SpawnOptions, SubagentsService } from "@gotgenes/pi-subagents";
import { Type } from "@sinclair/typebox";
import { textResult } from "#src/tools/helpers";

export class SubagentManualTool {
  constructor(private readonly svc: SubagentsService | undefined) {}

  toToolDefinition() {
    return defineTool({
      name: "subagent_manual" as const,
      label: "Subagent (manual override)",
      description: [
        "Launch a specialized agent with explicit model and/or thinking level override.",
        "Use this when you need a specific model or thinking level for a task.",
        "",
        "For automatic routing based on model-routing.yml, use subagent instead",
        "(no model/thinking params needed).",
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
        model: Type.Optional(
          Type.String({
            description:
              'Model override. Accepts "provider/modelId" or fuzzy name.',
          }),
        ),
        thinking: Type.Optional(
          Type.String({
            description:
              "Thinking level: off, minimal, low, medium, high, xhigh.",
          }),
        ),
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
        const agentType = (args.subagent_type as string) ?? "subagent_manual";
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
    const agentType = params.subagent_type as string | undefined;
    const prompt = params.prompt as string | undefined;
    const description = params.description as string | undefined;
    const model = params.model as string | undefined;
    const thinking = params.thinking as string | undefined;
    const inheritContext = params.inherit_context as boolean | undefined;
    const maxTurns = params.max_turns as number | undefined;
    const runInBackground = params.run_in_background as boolean | undefined;

    if (!agentType || !prompt) {
      return textResult("subagent_type and prompt are required.");
    }

    // Must provide at least model or thinking
    if (!model && !thinking) {
      return textResult(
        "subagent_manual requires at least model or thinking. Use subagent for automatic routing.",
      );
    }

    if (!this.svc) {
      return textResult(
        "SubagentsService not available. Ensure @gotgenes/pi-subagents is loaded.",
      );
    }

    try {
      const spawnOptions: SpawnOptions = {
        description: description ?? prompt.slice(0, 80),
        model,
        thinkingLevel: thinking,
        inheritContext,
        maxTurns,
      };
      // Only pass foreground when explicitly set
      if (runInBackground !== undefined) {
        spawnOptions.foreground = !runInBackground;
      }
      const agentId = this.svc.spawn(agentType, prompt, spawnOptions);
      return textResult(agentId);
    } catch (err) {
      return textResult(
        `Failed to spawn agent: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
