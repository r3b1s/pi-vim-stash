import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { textResult } from "#src/tools/helpers";
import type { SubagentTracker } from "#src/tracker";

/**
 * Get subagent result tool for pi-tmux-sessionizer.
 *
 * Always non-blocking — returns immediately with the current status.
 * Uses the in-memory tracker to retrieve results.
 */

export function createGetResultTool(tracker: SubagentTracker) {
  return defineTool({
    name: "get_subagent_result" as const,
    label: "Get subagent result (tmux)",
    description: [
      "Retrieve the result of a spawned subagent.",
      "Always non-blocking — returns immediately regardless of agent status.",
      "Call again to check if a running agent has completed.",
      "Subagents run in tmux windows — attach with: tmux attach -t _pi-sub-<sessionId>",
    ].join("\n"),
    parameters: Type.Object({
      agent_id: Type.String({
        description: "The ID of the agent to retrieve results for.",
      }),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: SDK theme types
    renderCall(args: Record<string, unknown>, theme: any) {
      const id = (args.agent_id as string) ?? "unknown";
      return new Text(
        `\u25b8 ${theme.fg("toolTitle", theme.bold("get_subagent_result"))}  ${theme.fg("muted", id)}`,
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
    ) => execute(params, tracker),
  });
}

async function execute(
  params: Record<string, unknown>,
  tracker: SubagentTracker,
): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
  try {
    const agentId = params.agent_id as string | undefined;

    if (!agentId) {
      return textResult("agent_id is required.");
    }

    const record = tracker.get(agentId);
    if (!record) {
      return textResult(`Agent not found: ${agentId}`);
    }

    switch (record.status) {
      case "starting":
      case "running":
        return textResult(
          `Agent ${agentId} is still running (status: ${record.status}). Call get_subagent_result again to check.`,
        );
      case "completed":
        return textResult(
          [
            `Status: completed`,
            `Result: ${record.result ?? "(no result)"}`,
            `Type: ${record.type}`,
            `Duration: ${record.completedAt ? ((record.completedAt - record.startedAt) / 1000).toFixed(1) : "?"}s`,
          ].join("\n"),
        );
      case "stopped":
        return textResult(
          `Agent ${agentId} was stopped. Type: ${record.type}.`,
        );
      case "error":
        return textResult(
          `Agent ${agentId} encountered an error: ${record.error ?? "Unknown error"}`,
        );
      default:
        return textResult(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `Agent ${agentId} status: ${record.status}`,
        );
    }
  } catch (err) {
    return textResult(
      `Error retrieving agent result: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
