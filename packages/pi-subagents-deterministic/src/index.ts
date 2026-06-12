import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SubagentsService } from "@gotgenes/pi-subagents";
import { SubagentCallRouter } from "./hook";
import { SubagentManualTool } from "./tools/manual";

export {
  type ResultProvider,
  setResultProvider,
} from "./tools/result-provider";
export { type Spawner, setSpawner } from "./tools/spawner";

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

  // Register tool_call hook for deterministic subagent routing.
  // Intercepts calls to pi-subagents' subagent tool and injects
  // model and thinking values from model-routing.yml into event.input.
  // No tool-name collision — PSD does not register a competing "subagent" tool.
  const router = new SubagentCallRouter(configDir);
  pi.on("tool_call", router.handler);

  // Register manual override tool (always visible alongside subagent)
  // No name conflict exists — pi-subagents does not define this name.
  const manualTool = new SubagentManualTool(svc);
  pi.registerTool(manualTool.toToolDefinition());
}
