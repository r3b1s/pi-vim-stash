import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { initSupportedCommands, rewrite } from "./rewrite.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RTK_PROMPT = readFileSync(join(__dirname, "..", "rtk.md"), "utf-8");

export default async function (pi: ExtensionAPI) {
  initSupportedCommands();

  // Inject RTK meta-command docs into system prompt
  pi.on(
    "before_agent_start",
    async (
      event: BeforeAgentStartEvent,
    ): Promise<BeforeAgentStartEventResult> => ({
      systemPrompt: `${event.systemPrompt}\n\n${RTK_PROMPT}`,
    }),
  );

  // Rewrite bash commands through rtk
  pi.on("tool_call", async (event: ToolCallEvent) => {
    if (event.toolName !== "bash") return;
    const cmd = event.input.command;
    if (typeof cmd !== "string") return;
    const rewritten = rewrite(cmd);
    if (rewritten) {
      event.input.command = rewritten;
    }
  });
}
