import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/**
 * A model entry in model-routing.yml can be either a plain string
 * (model identifier) or a mapping where the key is the model identifier
 * and the value is an optional object with a thinking override.
 */
export type ModelEntry = string | Record<string, { thinking?: string }>;

export interface RoleConfig {
  thinking?: string;
  models?: ModelEntry[];
}

export interface ModelRoutingConfig {
  roles?: Record<string, RoleConfig>;
}

/** A fully resolved model entry with associated thinking level. */
export interface ResolvedModelEntry {
  model: string;
  thinking?: string;
}

// ──────────────────────────────────────────────
// Config reading
// ──────────────────────────────────────────────

/**
 * Read and parse agent/model-routing.yml from the given config directory.
 *
 * Returns the parsed config object on success, or an error message string
 * on failure (missing file, invalid YAML, empty content).
 */
export function readModelRouting(
  configDir: string,
): ModelRoutingConfig | string {
  const filePath = join(configDir, "agent", "model-routing.yml");

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return `Model routing config not found at ${configDir}/agent/model-routing.yml`;
    }
    return `Failed to read model-routing.yml: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (content.trim().length === 0) {
    return `Model routing config is empty at ${filePath}`;
  }

  let parsed: unknown;
  try {
    parsed = load(content);
  } catch (err: unknown) {
    return `Failed to parse model-routing.yml: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `Model routing config has no valid content at ${filePath}`;
  }

  return parsed;
}

// ──────────────────────────────────────────────
// Model resolution
// ──────────────────────────────────────────────

/**
 * Given an agent type string (e.g., "Explore") and a parsed routing config,
 * resolve the ordered model list with per-entry thinking levels.
 *
 * Agent type is matched case-insensitively against YAML role keys.
 * Any user-defined agent type works — no hardcoded translation table.
 *
 * Returns an array of resolved model entries on success, or an error message
 * string on failure (unknown type, missing role, empty model list).
 */
export function resolveModelsForType(
  agentType: string,
  routing: ModelRoutingConfig,
): ResolvedModelEntry[] | string {
  if (!routing.roles) {
    return `No roles defined in model-routing.yml.`;
  }

  // Case-insensitive match: agent type against YAML role keys
  const typeLower = agentType.toLowerCase();
  const roleKey = Object.keys(routing.roles).find(
    (key) => key.toLowerCase() === typeLower,
  );

  if (!roleKey) {
    return `No routing config found for agent type ${agentType}. Add a role entry to model-routing.yml.`;
  }

  const role = routing.roles[roleKey];
  if (!role) {
    return `No routing config found for role: ${roleKey}.`;
  }

  if (!role.models || role.models.length === 0) {
    return `No models configured for role: ${roleKey}.`;
  }

  const roleThinking = role.thinking;

  return role.models.flatMap((entry): ResolvedModelEntry[] => {
    if (typeof entry === "string") {
      // Plain string model identifier — use role-level thinking
      return [{ model: entry, thinking: roleThinking }];
    }

    // Skip non-object entries (null, boolean, number, array)
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      console.warn(
        `[pi-subagents-deterministic] Skipping malformed model entry in role '${roleKey}': ${JSON.stringify(entry)}`,
      );
      return [];
    }

    // Entry is a mapping: { modelName: { thinking?: string } }
    const modelName = Object.keys(entry)[0];
    // Skip empty objects
    if (!modelName) {
      console.warn(
        `[pi-subagents-deterministic] Skipping empty model entry in role '${roleKey}'`,
      );
      return [];
    }
    const modelConfig = entry[modelName];
    // Per-model thinking override wins; fall back to role-level
    const modelThinking = modelConfig?.thinking ?? roleThinking;
    return [{ model: modelName, thinking: modelThinking }];
  });
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
