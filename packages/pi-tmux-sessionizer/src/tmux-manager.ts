import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TmuxOptions } from "#src/types";

/**
 * Safe characters for tmux session and window names.
 * Only alphanumeric, hyphens, and underscores are allowed.
 */
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that a name contains only safe characters for tmux CLI usage.
 */
export function isValidTmuxName(name: string): boolean {
  return SAFE_NAME_RE.test(name);
}

/**
 * Sanitize a string to contain only safe tmux name characters.
 */
export function sanitizeTmuxName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Generate a tmux session name for a parent pi session.
 * Format: _pi-sub-<parentSessionId>
 */
export function makeSessionName(parentSessionId: string): string {
  const safe = sanitizeTmuxName(parentSessionId);
  return `_pi-sub-${safe}`;
}

/**
 * Generate a tmux window name for a subagent.
 * Format: <agentType>-<agentId[:8]>
 */
export function makeWindowName(agentType: string, agentId: string): string {
  const safeType = sanitizeTmuxName(agentType);
  const shortId = agentId.slice(0, 8);
  return `${safeType}-${shortId}`;
}

/**
 * Check if tmux is available on PATH.
 */
export function isTmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Default timeout for tmux CLI calls.
 */
const DEFAULT_TMUX_TIMEOUT = 5_000;

/**
 * Build exec options for tmux commands using argv-based execution.
 */
function tmuxExecOpts(options?: TmuxOptions): ExecFileSyncOptions {
  return {
    stdio: "pipe",
    timeout: options?.timeout ?? DEFAULT_TMUX_TIMEOUT,
  };
}

/**
 * Wrapper around tmux CLI commands via child_process.execFileSync.
 *
 * All commands use argv-based execution to prevent shell injection.
 * All commands throw on failure with a descriptive error message.
 */
export class TmuxManager {
  /**
   * Ensure a detached tmux session exists for the given parent session.
   * If the session already exists, returns the existing session name.
   * Does NOT create a session — use createWindow for the first window
   * which creates the session in one step.
   * Returns the session name.
   */
  ensureSession(parentSessionId: string): string {
    const name = makeSessionName(parentSessionId);
    if (!isValidTmuxName(name)) {
      throw new Error(`Invalid tmux session name: ${name}`);
    }

    if (this.sessionExists(name)) {
      return name;
    }

    // Session doesn't exist yet — createWindow will create it with the
    // first window via `tmux new-session -d -s <name> -n <window> -- <cmd>`.
    return name;
  }

  /**
   * Check if a tmux session exists.
   */
  sessionExists(name: string): boolean {
    if (!isValidTmuxName(name)) {
      throw new Error(`Invalid tmux session name: ${name}`);
    }
    try {
      execFileSync("tmux", ["has-session", "-t", name], {
        ...tmuxExecOpts(),
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy a tmux session, killing all windows and processes.
   */
  destroySession(name: string): void {
    if (!isValidTmuxName(name)) {
      throw new Error(`Invalid tmux session name: ${name}`);
    }
    execFileSync("tmux", ["kill-session", "-t", name], tmuxExecOpts());
  }

  /**
   * Create a new window in a session. If the session does not yet exist,
   * creates the session with this as its first window via `new-session -d`.
   * If the session already exists, creates a new window via `new-window`.
   * Returns the window index.
   *
   * To prevent a race condition where the command finishes before
   * remain-on-exit is set (causing the window to close), we:
   * 1. Create the window WITHOUT a command
   * 2. Set remain-on-exit
   * 3. Send the command as keyboard input via send-keys
   */
  createWindow(
    sessionName: string,
    windowName: string,
    command: string,
  ): number {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    if (!isValidTmuxName(windowName)) {
      throw new Error(`Invalid tmux window name: ${windowName}`);
    }

    const sessionAlreadyExists = this.sessionExists(sessionName);

    if (sessionAlreadyExists) {
      // Create a new window in existing session (no command — see below)
      execFileSync(
        "tmux",
        ["new-window", "-t", sessionName, "-n", windowName],
        tmuxExecOpts(),
      );
    } else {
      // Create session + first window (no command — see below)
      execFileSync(
        "tmux",
        ["new-session", "-d", "-s", sessionName, "-n", windowName],
        tmuxExecOpts(),
      );
    }

    const windowIndex = this.findWindowIndex(sessionName, windowName);

    // Set remain-on-exit BEFORE running the command to prevent the window
    // from closing when a fast command (like echo) finishes
    execFileSync(
      "tmux",
      [
        "set-window-option",
        "-t",
        `${sessionName}:${windowIndex}`,
        "remain-on-exit",
        "on",
      ],
      tmuxExecOpts(),
    );

    // Send the command as keyboard input via send-keys
    execFileSync(
      "tmux",
      ["send-keys", "-t", `${sessionName}:${windowIndex}`, "-l", command],
      tmuxExecOpts(),
    );
    execFileSync(
      "tmux",
      ["send-keys", "-t", `${sessionName}:${windowIndex}`, "Enter"],
      tmuxExecOpts(),
    );

    return windowIndex;
  }

  private findWindowIndex(sessionName: string, windowName: string): number {
    const output = execFileSync(
      "tmux",
      [
        "list-windows",
        "-t",
        sessionName,
        "-F",
        "#{window_index}:#{window_name}",
      ],
      tmuxExecOpts(),
    )
      .toString()
      .trim();

    for (const line of output.split("\n")) {
      const [idx, name] = line.split(":", 2);
      if (name === windowName) {
        return Number.parseInt(idx, 10);
      }
    }

    throw new Error(
      `Window '${windowName}' not found after creation in session '${sessionName}'`,
    );
  }

  /**
   * Send keys (short message) to a tmux window using argv-based execution.
   * Uses `tmux send-keys -t <target> -l <text>` via execFileSync to
   * prevent shell injection from user-controlled text.
   */
  sendKeys(sessionName: string, windowIndex: number, text: string): void {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    const target = `${sessionName}:${windowIndex}`;
    execFileSync(
      "tmux",
      ["send-keys", "-t", target, "-l", text],
      tmuxExecOpts(),
    );
  }

  /**
   * Send keys (long/multiline message) using temp file + load-buffer + paste-buffer.
   */
  sendKeysLong(sessionName: string, windowIndex: number, text: string): void {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    const target = `${sessionName}:${windowIndex}`;

    // Create temp file with restrictive permissions and exclusive create
    const tmpFile = join(tmpdir(), `pi-sub-steer-${randomUUID()}`);
    const fd = openSync(tmpFile, "wx", 0o600);
    writeFileSync(fd, text, "utf-8");
    closeSync(fd);

    try {
      // Load buffer from file and paste — use execFileSync for safety
      execFileSync(
        "tmux",
        ["load-buffer", "-t", target, tmpFile],
        tmuxExecOpts(),
      );
      execFileSync(
        "tmux",
        ["paste-buffer", "-d", "-t", target],
        tmuxExecOpts(),
      );
    } finally {
      // Clean up temp file (best-effort) using Node fs API
      try {
        rmSync(tmpFile, { force: true });
      } catch {
        // Ignore cleanup failures
      }
    }
  }

  /**
   * Send a newline (Enter) to a tmux window.
   */
  sendEnter(sessionName: string, windowIndex: number): void {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    const target = `${sessionName}:${windowIndex}`;
    execFileSync("tmux", ["send-keys", "-t", target, "Enter"], tmuxExecOpts());
  }

  /**
   * Send Ctrl+C to a tmux window (kill the foreground process).
   */
  sendCtrlC(sessionName: string, windowIndex: number): void {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    const target = `${sessionName}:${windowIndex}`;
    execFileSync("tmux", ["send-keys", "-t", target, "C-c"], tmuxExecOpts());
  }

  /**
   * Capture pane contents (for inspection).
   */
  capturePane(
    sessionName: string,
    windowIndex: number,
    lines?: number,
  ): string {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    const target = `${sessionName}:${windowIndex}`;
    const args = ["capture-pane", "-t", target, "-p"];
    if (lines !== undefined) {
      args.push("-S", `-${lines}`);
    }
    return execFileSync("tmux", args, tmuxExecOpts()).toString();
  }

  /**
   * Check if a window exists in a session.
   * Returns true only when the target window index is found.
   */
  windowExists(sessionName: string, windowIndex: number): boolean {
    if (!isValidTmuxName(sessionName)) {
      throw new Error(`Invalid tmux session name: ${sessionName}`);
    }
    try {
      const output = execFileSync(
        "tmux",
        ["list-windows", "-t", sessionName, "-F", "#{window_index}"],
        {
          ...tmuxExecOpts(),
          stdio: "pipe",
        },
      )
        .toString()
        .trim()
        .split("\n");
      return output.includes(String(windowIndex));
    } catch {
      return false;
    }
  }
}

/**
 * Build a shell command string with proper escaping for the given parts.
 * Shell-escapes arguments using single quotes with handling for embedded single quotes.
 */
export function shellEscape(args: string[]): string {
  return args
    .map((arg) => {
      // Wrap in single quotes, handling embedded single quotes
      if (arg.includes("'")) {
        // Replace each ' with '\'' (end single quote, escaped single quote, start single quote)
        const escaped = arg.replace(/'/g, "'\\''");
        return `'${escaped}'`;
      }
      return `'${arg}'`;
    })
    .join(" ");
}
