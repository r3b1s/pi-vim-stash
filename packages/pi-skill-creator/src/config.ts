import { isAbsolute, resolve } from "node:path";

export const DEFAULT_RUN_ROOT = ".pi/skill-creator/runs";

export interface SkillCreatorConfig {
  runRoot: string;
}

export interface RunRootOverrideSource {
  runRoot?: string;
  env?: NodeJS.ProcessEnv;
}

export function getRunRoot(
  cwd: string,
  override: RunRootOverrideSource = {},
): string {
  const configured =
    override.runRoot ??
    override.env?.PI_SKILL_CREATOR_RUN_ROOT ??
    DEFAULT_RUN_ROOT;
  return isAbsolute(configured) ? configured : resolve(cwd, configured);
}

export function getConfig(
  cwd: string,
  override: RunRootOverrideSource = {},
): SkillCreatorConfig {
  return { runRoot: getRunRoot(cwd, override) };
}
