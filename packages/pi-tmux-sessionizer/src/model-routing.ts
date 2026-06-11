import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

/**
 * Standalone model routing configuration reader.
 *
 * Reads agent/model-routing.yml from the pi config directory.
 * Used when pi-subagents-deterministic is not installed.
 */

export interface ModelEntry {
  model: string;
  thinking?: string;
}

export interface ResolvedEntry {
  model: string;
  thinking?: string;
}

export interface RoleConfig {
  thinking?: string;
  models?: Array<string | Record<string, { thinking?: string }>>;
}

export interface ModelRoutingConfig {
  roles?: Record<string, RoleConfig>;
}

/**
 * Read and parse model-routing.yml from the given config directory.
 */
export function readModelRouting(
  configDir: string,
): ModelRoutingConfig | undefined {
  const filePath = join(configDir, "agent", "model-routing.yml");

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }

  if (content.trim().length === 0) return undefined;

  try {
    const parsed = load(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as ModelRoutingConfig;
  } catch {
    return undefined;
  }
}

/**
 * Resolve models for a given agent type from the routing config.
 * Case-insensitive matching.
 */
export function resolveModelsForType(
  agentType: string,
  routing: ModelRoutingConfig,
): ResolvedEntry[] | undefined {
  if (!routing.roles) return undefined;

  const typeLower = agentType.toLowerCase();
  const roleKey = Object.keys(routing.roles).find(
    (key) => key.toLowerCase() === typeLower,
  );

  if (!roleKey) return undefined;

  const role = routing.roles[roleKey];
  if (!role?.models || role.models.length === 0) return undefined;

  const roleThinking = role.thinking;
  const entries: ResolvedEntry[] = [];

  for (const entry of role.models) {
    if (typeof entry === "string") {
      entries.push({ model: entry, thinking: roleThinking });
    } else if (typeof entry === "object" && entry !== null) {
      const modelName = Object.keys(entry)[0];
      if (modelName) {
        const modelConfig = entry[modelName];
        entries.push({
          model: modelName,
          thinking: modelConfig?.thinking ?? roleThinking,
        });
      }
    }
  }

  return entries.length > 0 ? entries : undefined;
}
