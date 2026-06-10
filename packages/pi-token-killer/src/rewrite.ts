import { execFileSync } from "node:child_process";

/** RTK subcommands that are systemic/meta commands, not output optimizers. */
export const SYSTEMIC_COMMANDS = new Set<string>([
  "cc-economics",
  "config",
  "discover",
  "gain",
  "help",
  "hook",
  "hook-audit",
  "init",
  "learn",
  "proxy",
  "rewrite",
  "run",
  "session",
  "telemetry",
  "trust",
  "untrust",
  "verify",
]);

/** Map common native commands to the RTK optimizer subcommand that handles them. */
const COMMAND_MAP: Record<string, string> = {
  cat: "read",
  rg: "grep",
};

/** Commands/flags that should never be rewritten (interactive or shell-sensitive). */
const EXCLUSIONS: RegExp[] = [/\s-i\b/, /\s--interactive\b/, /<</];

/** Env-var prefix pattern: `FOO=bar BAZ=qux `. */
const ENV_PREFIX_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^ ]* +)+/;

let supportedCommands = new Set<string>();
let initialized = false;

function parseSupportedCommands(help: string): Set<string> {
  const commands = new Set<string>();
  let inCommands = false;

  for (const line of help.split("\n")) {
    if (/^\s*Commands:/.test(line)) {
      inCommands = true;
      continue;
    }

    if (!inCommands) continue;
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) break;

    const match = /^\s+(\S+)/.exec(line);
    if (!match) continue;

    const matched = match[1];
    if (!matched) continue;
    const command = matched.replace(/,$/, "");
    if (!SYSTEMIC_COMMANDS.has(command)) {
      commands.add(command);
    }
  }

  return commands;
}

/**
 * Parse `rtk help` output to enumerate optimizer subcommands dynamically.
 * Returns true if RTK is available and exposed at least one optimizer command.
 */
export function initSupportedCommands(): boolean {
  try {
    const help = execFileSync("rtk", ["help"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const parsed = parseSupportedCommands(help);
    if (parsed.size === 0) return false;

    supportedCommands = parsed;
    initialized = true;
    return true;
  } catch {
    initialized = false;
    return false;
  }
}

function ensureSupportedCommands(): boolean {
  return initialized || initSupportedCommands();
}

/**
 * Attempt to rewrite a shell command by prefixing optimizer commands with RTK.
 * Returns the rewritten command string, or null if no rewrite applies.
 */
export function rewrite(command: string): string | null {
  if (!ensureSupportedCommands()) return null;

  // Already using rtk.
  if (/^(.*\/)?rtk\s/.test(command)) return null;

  for (const exclusion of EXCLUSIONS) {
    if (exclusion.test(command)) return null;
  }

  const envMatch = ENV_PREFIX_RE.exec(command);
  const envPrefix = envMatch ? envMatch[0] : "";
  const body = envPrefix ? command.slice(envPrefix.length) : command;

  const baseMatch = /^(\S+)/.exec(body);
  if (!baseMatch) return null;

  const baseCmd = baseMatch[1];
  if (!baseCmd) return null;

  const rtkCmd = COMMAND_MAP[baseCmd] || baseCmd;
  if (!supportedCommands.has(rtkCmd)) return null;

  if (COMMAND_MAP[baseCmd]) {
    return `${envPrefix}rtk ${rtkCmd}${body.slice(baseCmd.length)}`;
  }
  return `${envPrefix}rtk ${body}`;
}
