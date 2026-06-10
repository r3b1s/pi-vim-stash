import { beforeAll, describe, expect, it, vi } from "vitest";

// Mock node:child_process so tests never require the real rtk binary on PATH
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import type { Mock } from "vitest";
import {
  initSupportedCommands,
  rewrite,
  SYSTEMIC_COMMANDS,
} from "../src/rewrite.js";

// ---------------------------------------------------------------------------
// Mock RTK help output — simulates what `rtk help` returns.
// The parser looks for a "Commands:" section and collects non-systemic entries.
// ---------------------------------------------------------------------------
const MOCK_HELP = `Usage: rtk [OPTIONS] <COMMAND>

Commands:
  build     Compress build output
  cat       Read files
  commit    Generate commit messages
  diff      Compress diff output
  git       Run git commands through rtk
  grep      Search through rtk
  help      Print help information
  lint      Compress lint output
  log       Compress git log output
  read      Compress read operations
  status    Compress git status
  test      Compress test output

Options:
  -h, --help     Print help
  -V, --version  Print version
`;

// ---------------------------------------------------------------------------
// Setup: make execFileSync return mock help so initSupportedCommands succeeds.
// We pre-initialize so that rewrite() tests have a deterministic command set.
// ---------------------------------------------------------------------------
beforeAll(() => {
  (execFileSync as Mock).mockReturnValue(MOCK_HELP);
  initSupportedCommands();
});

// ===========================================================================
// SYSTEMIC_COMMANDS smoke checks
// ===========================================================================
describe("SYSTEMIC_COMMANDS", () => {
  it("is a Set", () => {
    expect(SYSTEMIC_COMMANDS).toBeInstanceOf(Set);
  });

  it("contains known systemic / meta commands", () => {
    expect(SYSTEMIC_COMMANDS.has("help")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("gain")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("config")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("proxy")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("rewrite")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("session")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("discover")).toBe(true);
    expect(SYSTEMIC_COMMANDS.has("init")).toBe(true);
  });

  it("does not contain optimizer commands", () => {
    expect(SYSTEMIC_COMMANDS.has("git")).toBe(false);
    expect(SYSTEMIC_COMMANDS.has("status")).toBe(false);
    expect(SYSTEMIC_COMMANDS.has("test")).toBe(false);
  });
});

// ===========================================================================
// initSupportedCommands (direct calls — each test re-executes the mock)
// ===========================================================================
describe("initSupportedCommands", () => {
  it("returns true when rtk help parses successfully", () => {
    (execFileSync as Mock).mockReturnValue(MOCK_HELP);
    expect(initSupportedCommands()).toBe(true);
  });

  it("returns false when execFileSync throws (rtk not on PATH)", () => {
    (execFileSync as Mock).mockImplementationOnce(() => {
      throw new Error("ENOENT: rtk not found");
    });
    expect(initSupportedCommands()).toBe(false);
  });

  it("returns false when no optimizer commands are found", () => {
    (execFileSync as Mock).mockReturnValueOnce(`Usage: rtk <cmd>

Commands:
  help      Print help
  config    Manage config
`);
    expect(initSupportedCommands()).toBe(false);
  });

  it("re-initializes on each call regardless of cached state", () => {
    // First call — succeeds
    (execFileSync as Mock).mockReturnValueOnce(MOCK_HELP);
    expect(initSupportedCommands()).toBe(true);

    // Second call — mock throws, init fails
    (execFileSync as Mock).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(initSupportedCommands()).toBe(false);
  });
});

// ===========================================================================
// rewrite — public API, full integration through mocked child_process
// ===========================================================================
describe("rewrite", () => {
  // ---- Supported commands ----
  it("prefixes a command supported by rtk", () => {
    expect(rewrite("git status")).toBe("rtk git status");
  });

  it("prefixes with all arguments preserved", () => {
    expect(rewrite("git diff --cached")).toBe("rtk git diff --cached");
    expect(rewrite("status --short")).toBe("rtk status --short");
    expect(rewrite("log --oneline -5")).toBe("rtk log --oneline -5");
  });

  // ---- COMMAND_MAP aliases ----
  it("maps cat to rtk read", () => {
    expect(rewrite("cat file.txt")).toBe("rtk read file.txt");
  });

  it("maps cat with flags to rtk read preserving args", () => {
    expect(rewrite("cat -n file.txt")).toBe("rtk read -n file.txt");
  });

  it("maps rg to rtk grep", () => {
    expect(rewrite("rg pattern")).toBe("rtk grep pattern");
  });

  it("maps rg with flags (no -i) to rtk grep", () => {
    // -i is caught by the interactive exclusion pattern; use a different flag
    expect(rewrite("rg --count pattern")).toBe("rtk grep --count pattern");
  });

  // ---- Unsupported commands ----
  it("returns null for an unsupported command", () => {
    expect(rewrite("ls")).toBeNull();
  });

  it("returns null for shell builtins", () => {
    expect(rewrite("cd ..")).toBeNull();
    expect(rewrite("echo hello")).toBeNull();
  });

  it("returns null for npm / npx commands", () => {
    expect(rewrite("npm test")).toBeNull();
    expect(rewrite("npx eslint .")).toBeNull();
  });

  // ---- Already-using-rtk guard ----
  it("returns null when command is already prefixed with rtk", () => {
    expect(rewrite("rtk git status")).toBeNull();
  });

  it("returns null when rtk has a full path prefix", () => {
    expect(rewrite("/usr/local/bin/rtk gain")).toBeNull();
  });

  // ---- Exclusion patterns ----
  it("returns null when command contains -i flag (interactive guard)", () => {
    expect(rewrite("vim -i")).toBeNull();
    expect(rewrite("git log -i")).toBeNull();
  });

  it("returns null when command contains --interactive", () => {
    expect(rewrite("nano --interactive")).toBeNull();
  });

  it("returns null for heredoc syntax", () => {
    expect(rewrite("cat << EOF")).toBeNull();
    expect(rewrite("git diff << 'EOF'")).toBeNull();
  });

  // ---- Env-var prefix ----
  it("preserves a single env-var prefix", () => {
    expect(rewrite("FOO=bar git status")).toBe("FOO=bar rtk git status");
  });

  it("preserves multiple env-var prefixes", () => {
    expect(rewrite("A=1 B=2 git diff")).toBe("A=1 B=2 rtk git diff");
  });

  it("handles env prefix with a longer value", () => {
    expect(rewrite("PATH=/usr/bin git status")).toBe(
      "PATH=/usr/bin rtk git status",
    );
  });

  // ---- Edge cases ----
  it("returns null for empty string", () => {
    expect(rewrite("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(rewrite("   ")).toBeNull();
  });

  it("handles multi-word arguments with quotes", () => {
    expect(rewrite("git commit -m 'fix: thing'")).toBe(
      "rtk git commit -m 'fix: thing'",
    );
  });

  it("handles paths as arguments", () => {
    expect(rewrite("cat src/index.ts")).toBe("rtk read src/index.ts");
  });

  it("does not rewrite commands with shell metacharacters that are interactive", () => {
    // Command starting with rtk already is handled by the rtk-prefix guard
    expect(rewrite("rtk gain --history")).toBeNull();
  });
});
