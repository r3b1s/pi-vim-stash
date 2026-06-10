import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHORTCUT,
  normalizeShortcut,
  SHORTCUT_KEYBINDING_ID,
} from "../src/stash.js";

describe("stash constants", () => {
  it("defaults to alt+s", () => {
    expect(DEFAULT_SHORTCUT).toBe("alt+s");
  });

  it("uses pi-vim-stash keybinding id", () => {
    expect(SHORTCUT_KEYBINDING_ID).toBe("pi-vim-stash.shortcut");
  });
});

describe("normalizeShortcut", () => {
  it("returns the trimmed lowercase string for a valid string", () => {
    expect(normalizeShortcut(" Ctrl+S ")).toBe("ctrl+s");
    expect(normalizeShortcut("alt+s")).toBe("alt+s");
  });

  it("returns null for an empty string after trimming", () => {
    expect(normalizeShortcut("  ")).toBe(null);
    expect(normalizeShortcut("")).toBe(null);
  });

  it("returns the first valid entry from an array", () => {
    expect(normalizeShortcut(["", "ctrl+s", "alt+s"])).toBe("ctrl+s");
  });

  it("returns null when array has no valid entries", () => {
    expect(normalizeShortcut(["", "  "])).toBe(null);
  });

  it("returns null for non-string, non-array values", () => {
    expect(normalizeShortcut(42)).toBe(null);
    expect(normalizeShortcut(null)).toBe(null);
    expect(normalizeShortcut(undefined)).toBe(null);
    expect(normalizeShortcut({})).toBe(null);
  });

  it("returns null for an empty array", () => {
    expect(normalizeShortcut([])).toBe(null);
  });
});
