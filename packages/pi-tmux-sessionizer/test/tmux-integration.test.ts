import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { isTmuxAvailable, TmuxManager } from "#src/tmux-manager";

/**
 * All test sessions use this unique prefix for reliable cleanup.
 * The prefix includes "pts" to match the CI namespace convention.
 */
const TEST_PREFIX = "_pi-sub-pts-test-";

/**
 * Check if real tmux is available by calling `tmux -V`.
 * Uses the binary directly for portability (avoids `command` which is
 * a shell builtin that may not have a standalone binary on all systems).
 */
function realTmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique test session name.
 */
function testSessionName(label: string): string {
  return `${TEST_PREFIX}${label}`;
}

/**
 * Robust cleanup: list all tmux sessions, kill any matching the test prefix.
 * Safe to call even when tmux is unavailable or no sessions exist.
 */
function cleanupTestSessions(): void {
  try {
    const output = execFileSync(
      "tmux",
      ["list-sessions", "-F", "#{session_name}"],
      { stdio: "pipe", timeout: 5000 },
    )
      .toString()
      .trim();

    if (!output) return;

    for (const session of output.split("\n")) {
      const trimmed = session.trim();
      if (trimmed?.startsWith(TEST_PREFIX)) {
        try {
          execFileSync("tmux", ["kill-session", "-t", trimmed], {
            stdio: "ignore",
            timeout: 3000,
          });
        } catch {
          // Best-effort cleanup — session may already be gone
        }
      }
    }
  } catch {
    // No tmux or no sessions — nothing to clean up
  }
}

const tmuxAvail = realTmuxAvailable();

describe.runIf(tmuxAvail)("real tmux lifecycle integration", () => {
  const tmux = new TmuxManager();

  beforeAll(() => {
    // Clean any orphan sessions from prior failed runs
    cleanupTestSessions();
  });

  afterEach(() => {
    cleanupTestSessions();
  });

  it("isTmuxAvailable returns true when tmux is installed", () => {
    expect(isTmuxAvailable()).toBe(true);
  });

  // ─── Session lifecycle ─────────────────────────────────────

  it("createWindow creates a session and window", () => {
    const sessionName = testSessionName("create");
    const windowName = "main";
    const index = tmux.createWindow(sessionName, windowName, "echo hello");

    expect(tmux.sessionExists(sessionName)).toBe(true);
    expect(tmux.windowExists(sessionName, index)).toBe(true);
    expect(index).toBeGreaterThanOrEqual(0);
  });

  it("sessionExists returns true after session creation", () => {
    const sessionName = testSessionName("exists-true");
    tmux.createWindow(sessionName, "w0", "echo hi");

    expect(tmux.sessionExists(sessionName)).toBe(true);
  });

  it("sessionExists returns false for non-existent session", () => {
    expect(tmux.sessionExists(testSessionName("nonexistent"))).toBe(false);
  });

  it("sessionExists returns false after destroySession", () => {
    const sessionName = testSessionName("exists-after-destroy");
    tmux.createWindow(sessionName, "w0", "echo hi");
    expect(tmux.sessionExists(sessionName)).toBe(true);

    tmux.destroySession(sessionName);
    expect(tmux.sessionExists(sessionName)).toBe(false);
  });

  it("destroySession throws on non-existent session", () => {
    expect(() =>
      tmux.destroySession(testSessionName("never-existed")),
    ).toThrow();
  });

  it("double destroySession throws on second call", () => {
    const sessionName = testSessionName("double-destroy");
    tmux.createWindow(sessionName, "w0", "echo hi");
    tmux.destroySession(sessionName);
    expect(() => tmux.destroySession(sessionName)).toThrow();
  });

  // ─── Window lifecycle ──────────────────────────────────────

  it("windowExists returns true after createWindow", () => {
    const sessionName = testSessionName("window-true");
    const index = tmux.createWindow(sessionName, "w0", "echo hi");

    expect(tmux.windowExists(sessionName, index)).toBe(true);
  });

  it("windowExists returns false for non-existent window indices", () => {
    const sessionName = testSessionName("window-false");
    const index = tmux.createWindow(sessionName, "w0", "echo hi");

    expect(tmux.windowExists(sessionName, index)).toBe(true);
    expect(tmux.windowExists(sessionName, 99)).toBe(false);
  });

  it("creates multiple windows in the same session with distinct indices", () => {
    const sessionName = testSessionName("multi-window");
    const idx0 = tmux.createWindow(sessionName, "w0", "echo first");
    const idx1 = tmux.createWindow(sessionName, "w1", "echo second");

    // Indices should be different (base-index means first may not be 0)
    expect(idx0).not.toBe(idx1);
    expect(tmux.windowExists(sessionName, idx0)).toBe(true);
    expect(tmux.windowExists(sessionName, idx1)).toBe(true);
  });

  // ─── remain-on-exit ────────────────────────────────────────

  it("sets remain-on-exit on created windows", () => {
    const sessionName = testSessionName("remain-on-exit");
    const index = tmux.createWindow(sessionName, "w0", "echo hi");

    const output = execFileSync(
      "tmux",
      ["show-window-options", "-t", `${sessionName}:${index}`],
      { stdio: "pipe", timeout: 5000 },
    )
      .toString()
      .trim();

    expect(output).toContain("remain-on-exit on");
  });

  it("capturePane returns output from a window with remain-on-exit", () => {
    const sessionName = testSessionName("capture");
    const marker = "CAPTURE_TEST_MARKER";
    const index = tmux.createWindow(sessionName, "w0", `echo ${marker}`);

    // Poll briefly for the command output to appear
    const maxWait = 4000;
    const start = Date.now();
    let content = "";
    while (Date.now() - start < maxWait) {
      content = tmux.capturePane(sessionName, index);
      if (content.includes(marker)) break;
    }

    expect(content).toContain(marker);
  });

  // ─── ensureSession ─────────────────────────────────────────

  it("ensureSession returns existing session name when session exists", () => {
    const sessionName = testSessionName("ensure-exists");
    // The parent session ID that generates this session name
    const parentId = sessionName.slice("_pi-sub-".length);
    tmux.createWindow(sessionName, "w0", "echo hi");

    const result = tmux.ensureSession(parentId);
    expect(result).toBe(sessionName);
  });

  it("ensureSession does NOT create a session; returns name without side effects", () => {
    const sessionName = tmux.ensureSession("non-existent-label");
    expect(sessionName).toBe("_pi-sub-non-existent-label");
    // ensureSession should NOT have created the session
    expect(tmux.sessionExists(sessionName)).toBe(false);
  });

  // ─── sendKeys methods ──────────────────────────────────────

  it("sendKeys and sendEnter work on valid targets", () => {
    const sessionName = testSessionName("send-keys");
    // Create window with a command that reads input so keys are consumed
    const index = tmux.createWindow(sessionName, "w0", "cat");

    // Send text + Enter to the running cat process
    tmux.sendKeys(sessionName, index, "SEND_KEYS_WORKS");
    tmux.sendEnter(sessionName, index);

    // Wait for cat to echo back what we sent
    const maxWait = 3000;
    const start = Date.now();
    let content = "";
    while (Date.now() - start < maxWait) {
      content = tmux.capturePane(sessionName, index);
      if (content.includes("SEND_KEYS_WORKS")) break;
    }
    expect(content).toContain("SEND_KEYS_WORKS");
  });

  // ─── Validation ────────────────────────────────────────────

  it("throws on invalid session name in all public methods", () => {
    expect(() => tmux.sessionExists("bad name!")).toThrow(
      /Invalid tmux session name/,
    );
    expect(() => tmux.windowExists("bad name!", 0)).toThrow(
      /Invalid tmux session name/,
    );
    expect(() => tmux.destroySession("bad name!")).toThrow(
      /Invalid tmux session name/,
    );
    expect(() => tmux.createWindow("bad name!", "w0", "echo")).toThrow(
      /Invalid tmux session name/,
    );
    expect(() => tmux.sendKeys("bad name!", 0, "test")).toThrow(
      /Invalid tmux session name/,
    );
    expect(() => tmux.sendEnter("bad name!", 0)).toThrow(
      /Invalid tmux session name/,
    );
    expect(() => tmux.sendCtrlC("bad name!", 0)).toThrow(
      /Invalid tmux session name/,
    );
  });
});
