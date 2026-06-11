import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { isTmuxAvailable, type TmuxManager } from "#src/tmux-manager";
import { textResult } from "#src/tools/helpers";
import type { SubagentTracker } from "#src/tracker";

/**
 * Steer subagent tool for pi-tmux-sessionizer.
 *
 * Sends a message to a subagent's tmux window via send-keys.
 * For short messages (<200 chars, single line): tmux send-keys -l
 * For long/multiline messages: tmux load-buffer + paste-buffer
 * For kill: tmux send-keys C-c
 */

const SHORT_MESSAGE_MAX_LENGTH = 200;

export function createSteerTool(tracker: SubagentTracker, tmux: TmuxManager) {
  return defineTool({
    name: "steer_subagent" as const,
    label: "Steer subagent (tmux)",
    description: [
      "Send a message to a running subagent in its tmux window.",
      "The subagent processes it as user input (steering).",
      "",
      "To kill a subagent, use the kill parameter.",
      "To send a message, use the message parameter.",
    ].join("\n"),
    parameters: Type.Object({
      agent_id: Type.String({
        description: "The ID of the agent to steer or kill.",
      }),
      message: Type.Optional(
        Type.String({
          description:
            "The message to send to the subagent. Text it types into its running conversation.",
        }),
      ),
      kill: Type.Optional(
        Type.Boolean({
          description: "Set to true to kill/stop the subagent (sends Ctrl+C).",
        }),
      ),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: SDK theme types
    renderCall(args: Record<string, unknown>, theme: any) {
      const id = (args.agent_id as string) ?? "unknown";
      const action = args.kill ? "kill" : "steer";
      return new Text(
        `\u25b8 ${theme.fg("toolTitle", theme.bold(action))}  ${theme.fg("muted", id)}`,
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
    ) => execute(params, tracker, tmux),
  });
}

async function execute(
  params: Record<string, unknown>,
  tracker: SubagentTracker,
  tmux: TmuxManager,
): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
  try {
    const agentId = params.agent_id as string | undefined;

    if (!agentId) {
      return textResult("agent_id is required.");
    }

    // Check tmux availability
    if (!isTmuxAvailable()) {
      return textResult(
        "tmux is required but not found. Install with: apt install tmux or brew install tmux",
      );
    }

    const record = tracker.get(agentId);
    if (!record) {
      return textResult(`Agent not found: ${agentId}`);
    }

    const kill = params.kill === true;

    if (kill) {
      tmux.sendCtrlC(record.sessionName, record.windowIndex);
      tracker.updateStatus(agentId, "stopped");
      return textResult(`Ctrl+C sent to agent ${agentId}.`);
    }

    const message = params.message as string | undefined;
    if (!message) {
      return textResult("Either message or kill=true is required.");
    }

    // Determine send method based on message length and content
    const isShort =
      message.length <= SHORT_MESSAGE_MAX_LENGTH && !message.includes("\n");

    if (isShort) {
      tmux.sendKeys(record.sessionName, record.windowIndex, message);
    } else {
      tmux.sendKeysLong(record.sessionName, record.windowIndex, message);
    }
    tmux.sendEnter(record.sessionName, record.windowIndex);

    return textResult(`Message sent to agent ${agentId}.`);
  } catch (err) {
    return textResult(
      `Failed to steer subagent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
