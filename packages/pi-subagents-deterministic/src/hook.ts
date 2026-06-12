import type {
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { readModelRouting, resolveModelsForType } from "./config";

/**
 * SubagentCallRouter intercepts tool_call events for the "subagent" tool
 * and injects deterministic model and thinking values from model-routing.yml
 * into event.input before the tool executes.
 *
 * Construction captures configDir from the extension factory's closure scope
 * for use on every handler invocation.
 */
export class SubagentCallRouter {
  constructor(private readonly configDir: string) {}

  /**
   * Handler for pi.on("tool_call", ...).
   *
   * - If toolName !== "subagent": returns undefined (no-op, passes through)
   * - If event.input.subagent_type is absent: returns undefined (no-op, lets
   *   downstream validation handle it)
   * - Reads agent/model-routing.yml from configDir; on read or parse failure
   *   returns `{ block: true, reason }` with the exact error message
   * - Resolves the agent type against YAML role keys (case-insensitive);
   *   on unknown type or empty model list returns `{ block: true, reason }`
   * - Always overwrites event.input.model and event.input.thinking with the
   *   resolved values — routing config is authoritative
   * - On any uncaught exception returns `{ block: true, reason: "Internal
   *   routing error: ..." }` to avoid crashing the session
   *
   * Returns undefined (allow execution with mutated input) on success.
   */
  handler = (
    event: ToolCallEvent,
    _ctx: ExtensionContext,
  ): ToolCallEventResult | undefined => {
    // Short-circuit: only intercept subagent tool calls.
    // pi-subagents' subagent tool is a custom tool (CustomToolCallEvent).
    // subagent_manual passes through unmodified.
    if (event.toolName !== "subagent") return;

    // At this point TypeScript narrows event to CustomToolCallEvent,
    // whose input is Record<string, unknown>.
    const input = event.input;

    try {
      const agentType = input.subagent_type as string | undefined;

      // No subagent_type — let pi-subagents' own validation handle it.
      // This avoids double-blocking on malformed calls.
      if (!agentType) return;

      // Read config (fresh every call — no caching).
      // Edits to model-routing.yml are picked up without a session restart.
      const routing = readModelRouting(this.configDir);
      if (typeof routing === "string") {
        // routing is an error message from config.ts (missing file, invalid YAML)
        return { block: true, reason: routing };
      }

      // Resolve models for this agent type (case-insensitive role match).
      const resolved = resolveModelsForType(agentType, routing);
      if (typeof resolved === "string") {
        // resolved is an error message from config.ts (unknown type, empty models)
        console.warn(
          `[pi-subagents-deterministic] Routing blocked for agent type ${agentType}: ${resolved}`,
        );
        return { block: true, reason: resolved };
      }

      // Empty array means all model entries were malformed/skipped.
      if (resolved.length === 0) {
        return {
          block: true,
          reason: `No models configured for role: ${agentType}.`,
        };
      }

      // Use the first resolved model from the ordered list.
      const firstEntry = resolved[0];

      // Always overwrite — the routing config is authoritative.
      // The LLM may have set model/thinking via pi-subagents' tool schema;
      // we replace those values with the deterministic routing result.
      input.model = firstEntry.model;
      input.thinking = firstEntry.thinking;

      // Allow execution with mutated input. pi-subagents' subagent tool
      // will receive the injected model and thinking values.
      return;
    } catch (err) {
      // Safety net: any unexpected error blocks the call with a clear reason.
      return {
        block: true,
        reason: `Internal routing error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}
