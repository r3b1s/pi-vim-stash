import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentsService } from "@gotgenes/pi-subagents";
import { SubagentDeterministicTool } from "#src/tools/deterministic";
import { GetSubagentResultTool } from "#src/tools/get-result";
import { SubagentManualTool } from "#src/tools/manual";

export default async function (pi: ExtensionAPI): Promise<void> {
  // Resolve pi config directory
  // config.ts appends "agent/model-routing.yml" to this directory
  const configDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi");

  // Access SubagentsService via dynamic import
  let svc: SubagentsService | undefined;
  try {
    const mod = await import("@gotgenes/pi-subagents");
    svc = mod.getSubagentsService();
  } catch {
    // pi-subagents not loaded
  }

  // Graceful degradation: if pi-subagents not available, skip tool registration
  if (!svc) {
    console.warn(
      "[pi-subagents-deterministic] @gotgenes/pi-subagents not loaded. Tools will not be registered.",
    );
    return;
  }

  // Register deterministic subagent tool (name collision with pi-subagents)
  const deterministicTool = new SubagentDeterministicTool(configDir, svc);
  pi.registerTool(deterministicTool.toToolDefinition());

  // Register non-blocking get_subagent_result tool (name collision with pi-subagents)
  const getResultTool = new GetSubagentResultTool(svc);
  pi.registerTool(getResultTool.toToolDefinition());

  // Register manual override tool (always visible alongside subagent)
  const manualTool = new SubagentManualTool(svc);
  pi.registerTool(manualTool.toToolDefinition());
}
