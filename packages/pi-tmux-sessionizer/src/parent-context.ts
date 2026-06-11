import type {
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ParentContextMessage } from "#src/types";

/**
 * Parent conversation context builder.
 *
 * When inherit_context is true, the parent conversation history is prepended
 * as text to the subagent prompt. This mirrors pi-subagents'
 * buildParentContext() approach.
 */

export interface ParentContextCapture {
  messages: ParentContextMessage[];
  parentContextText: string;
}

/**
 * Build a parent context text block from an array of conversation messages.
 */
export function buildParentContext(
  messages: ParentContextMessage[],
  prompt: string,
): string {
  if (messages.length === 0) return prompt;

  const contextLines = ["# Parent Conversation Context"];

  for (const msg of messages) {
    const label = msg.role === "user" ? "User" : "Assistant";
    contextLines.push(`[${label}]: ${msg.content}`);
  }

  contextLines.push("");
  contextLines.push("---");
  contextLines.push("");
  contextLines.push("# Your Task (below)");
  contextLines.push(prompt);

  return contextLines.join("\n");
}

/**
 * Format parent context as plain text for diagnostics or alternative wiring.
 */
export function formatParentContextText(
  messages: ParentContextMessage[],
): string {
  return messages
    .map((msg) => {
      const label = msg.role === "user" ? "User" : "Assistant";
      return `[${label}]: ${msg.content}`;
    })
    .join("\n");
}

/**
 * Extract parent conversation messages from the current extension context.
 */
export function captureParentContext(
  ctx: Pick<ExtensionContext, "sessionManager"> | undefined,
): ParentContextCapture | { warning: string } {
  try {
    const branch = ctx?.sessionManager?.getBranch?.();
    if (!Array.isArray(branch)) {
      return {
        warning:
          "inherit_context requested, but the current extension context does not expose session history.",
      };
    }

    const messages = branch
      .map(extractParentMessage)
      .filter(
        (message): message is ParentContextMessage => message !== undefined,
      );

    if (messages.length === 0) {
      return {
        warning:
          "inherit_context requested, but no parent user/assistant conversation text was available.",
      };
    }

    return {
      messages,
      parentContextText: formatParentContextText(messages),
    };
  } catch (error) {
    return {
      warning: `inherit_context requested, but parent conversation extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function extractParentMessage(
  entry: SessionEntry,
): ParentContextMessage | undefined {
  if (entry.type !== "message") return undefined;

  const message = entry.message as unknown as Record<string, unknown>;
  const role = message.role;
  if (role !== "user" && role !== "assistant") {
    return undefined;
  }

  const content = extractTextContent(message.content).trim();
  if (!content) return undefined;

  return { role, content };
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .flatMap((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        return [(block as { text: string }).text];
      }
      return [];
    })
    .join("\n");
}
