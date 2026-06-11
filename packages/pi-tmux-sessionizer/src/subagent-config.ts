import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Subagent config directory management.
 *
 * Each subagent gets an isolated config directory under
 * <PI_CODING_AGENT_DIR>/tmp/subagents/<parentSessionId>/<agentId>/
 *
 * Contains settings.json (model, thinking, tools), copied auth.json and
 * models.json from the parent config, and a sessions/ subdirectory.
 */

export interface SubagentConfigOptions {
  model?: string;
  thinking?: string;
  maxTurns?: number;
  tools?: string[];
}

/**
 * Create the config directory for a subagent.
 *
 * Returns the config directory path.
 */
export function createSubagentConfig(
  parentId: string,
  agentId: string,
  options: SubagentConfigOptions,
): { configDir: string; sessionDir: string } {
  const baseDir = getSubagentsBaseDir();
  const configDir = join(baseDir, parentId, agentId);
  const sessionDir = join(configDir, "sessions");

  // Create directories recursively
  mkdirSync(sessionDir, { recursive: true });

  // Write settings.json
  const settings: Record<string, unknown> = {};
  if (options.model) settings.model = options.model;
  if (options.thinking) settings.thinking = options.thinking;
  if (options.maxTurns !== undefined) settings.maxTurns = options.maxTurns;
  if (options.tools) settings.tools = options.tools;

  writeFileSync(
    join(configDir, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );

  // Copy auth.json from parent config if it exists
  const parentConfigDir = getParentConfigDir();
  copyIfExists(
    join(parentConfigDir, "auth.json"),
    join(configDir, "auth.json"),
  );

  // Copy models.json from parent config if it exists
  copyIfExists(
    join(parentConfigDir, "models.json"),
    join(configDir, "models.json"),
  );

  return { configDir, sessionDir };
}

/**
 * Remove the config directory for a subagent.
 */
export function destroySubagentConfig(parentId: string, agentId: string): void {
  const baseDir = getSubagentsBaseDir();
  const configDir = join(baseDir, parentId, agentId);
  if (existsSync(configDir)) {
    rmSync(configDir, { recursive: true, force: true });
  }
}

/**
 * Remove the entire subagents directory for a parent session.
 */
export function destroyParentConfigs(parentId: string): void {
  const baseDir = getSubagentsBaseDir();
  const parentDir = join(baseDir, parentId);
  if (existsSync(parentDir)) {
    rmSync(parentDir, { recursive: true, force: true });
  }
}

/**
 * Get the base directory for subagent configs.
 */
function getSubagentsBaseDir(): string {
  const piDir = getParentConfigDir();
  return join(piDir, "tmp", "subagents");
}

/**
 * Get the parent pi config directory.
 */
function getParentConfigDir(): string {
  return (
    process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "/tmp", ".pi")
  );
}

/**
 * Copy a file from source to destination if the source exists.
 */
function copyIfExists(src: string, dest: string): void {
  try {
    if (existsSync(src)) {
      copyFileSync(src, dest);
    }
  } catch {
    // Best-effort copy — log and continue
    console.warn(`[pi-tmux-sessionizer] Failed to copy ${src} to ${dest}`);
  }
}
