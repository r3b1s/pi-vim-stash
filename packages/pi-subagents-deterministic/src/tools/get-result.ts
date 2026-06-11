import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type {
  SubagentRecord,
  SubagentStatus,
  SubagentsService,
} from "@gotgenes/pi-subagents";
import { Type } from "@sinclair/typebox";
import { textResult } from "#src/tools/helpers";

/** Compile-time exhaustiveness check for switch statements. */
function assertNever(value: never): never {
  throw new Error(`Unexpected status: ${String(value)}`);
}

/**
 * Non-blocking get_subagent_result tool.
 *
 * Overrides pi-subagents' version. Always returns immediately — never
 * awaits record.promise (the blocking mechanism). Use SubagentsService
 * public API only (getRecord).
 *
 * Running agents: returns status message telling the LLM to call again.
 * Terminal agents (completed/error/aborted/stopped): returns result/error.
 */
export class GetSubagentResultTool {
  constructor(private readonly svc: SubagentsService | undefined) {}

  toToolDefinition() {
    return defineTool({
      name: "get_subagent_result" as const,
      label: "Get subagent result (non-blocking)",
      description: [
        "Retrieve the result of a spawned subagent.",
        "Always non-blocking — returns immediately regardless of agent status.",
        "Call again to check if a running agent has completed.",
      ].join("\n"),
      parameters: Type.Object({
        agent_id: Type.String({
          description: "The ID of the agent to retrieve results for.",
        }),
        wait: Type.Optional(
          Type.Boolean({
            description: "Ignored — always non-blocking.",
          }),
        ),
        verbose: Type.Optional(
          Type.Boolean({
            description: "Accepted for compatibility; has no effect.",
          }),
        ),
      }),
      // biome-ignore lint/suspicious/noExplicitAny: SDK theme types not exported
      renderCall(args: Record<string, unknown>, theme: any) {
        const id = (args.agent_id as string) ?? "unknown";
        return new Text(
          `\u25b8 ${theme.fg("toolTitle", theme.bold("get_subagent_result"))}  ${theme.fg("muted", id)}`,
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
      const agentId = params.agent_id as string | undefined;

      if (!agentId) {
        return textResult("agent_id is required.");
      }

      if (!this.svc) {
        return textResult(
          "SubagentsService not available. Ensure @gotgenes/pi-subagents is loaded.",
        );
      }

      // Get agent record — never awaits record.promise
      let record: SubagentRecord | undefined;
      try {
        record = this.svc.getRecord(agentId);
      } catch (err) {
        return textResult(
          `Error retrieving agent record: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!record) {
        return textResult(
          `Agent not found: ${agentId}. It may have been cleaned up.`,
        );
      }

      // Handle all agent statuses with exhaustiveness
      const status = record.status;
      switch (status) {
        case "queued":
        case "running":
          return textResult(
            "Agent is still running. Call get_subagent_result again to check its status.",
          );
        case "completed":
        case "steered":
        case "aborted":
        case "stopped":
        case "error":
          return this.formatResult(record, status);
        default:
          return assertNever(status);
      }
    } catch (err) {
      return textResult(
        `Unexpected error retrieving subagent result: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private formatResult(
    record: SubagentRecord,
    status: SubagentStatus,
  ): { content: { type: "text"; text: string }[]; details: unknown } {
    try {
      const lines: string[] = [`Status: ${status}`];
      if (record.result) {
        lines.push(`Result: ${record.result}`);
      }
      if (record.error) {
        lines.push(`Error: ${record.error}`);
      }
      lines.push(`Type: ${record.type}`);
      lines.push(`Tool uses: ${record.toolUses}`);
      if (record.completedAt) {
        const duration = (
          (record.completedAt - record.startedAt) /
          1000
        ).toFixed(1);
        lines.push(`Duration: ${duration}s`);
      }
      const usage = record.lifetimeUsage;
      if (usage && (usage.input > 0 || usage.output > 0)) {
        lines.push(
          `Token usage — input: ${usage.input.toLocaleString()}, output: ${usage.output.toLocaleString()}`,
        );
      }
      return textResult(lines.join("\n"));
    } catch (err) {
      return textResult(
        `Error formatting agent result: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
