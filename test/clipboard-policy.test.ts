import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIPBOARD_MIRROR_POLICY,
  resolveClipboardMirrorPolicy,
} from "../src/clipboard-policy.js";

describe("DEFAULT_CLIPBOARD_MIRROR_POLICY", () => {
  it("is 'all'", () => {
    expect(DEFAULT_CLIPBOARD_MIRROR_POLICY).toBe("all");
  });
});

describe("resolveClipboardMirrorPolicy", () => {
  it("returns default policy when value is undefined", () => {
    expect(resolveClipboardMirrorPolicy(undefined)).toEqual({
      policy: "all",
    });
  });

  it("resolves valid policy strings", () => {
    expect(resolveClipboardMirrorPolicy("all")).toEqual({ policy: "all" });
    expect(resolveClipboardMirrorPolicy("yank")).toEqual({
      policy: "yank",
    });
    expect(resolveClipboardMirrorPolicy("never")).toEqual({
      policy: "never",
    });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveClipboardMirrorPolicy(" ALL ")).toEqual({
      policy: "all",
    });
    expect(resolveClipboardMirrorPolicy("Yank")).toEqual({
      policy: "yank",
    });
  });

  it("returns default policy with warning for invalid strings", () => {
    const result = resolveClipboardMirrorPolicy("bad");
    expect(result.policy).toBe("all");
    expect(result.warning ?? "").toMatch(/Invalid piVim\.clipboardMirror/);
  });

  it("returns default policy with warning for non-string values", () => {
    const result = resolveClipboardMirrorPolicy(42);
    expect(result.policy).toBe("all");
    expect(result.warning ?? "").toMatch(/Invalid piVim\.clipboardMirror/);
  });

  it("returns default policy with warning for object values", () => {
    const result = resolveClipboardMirrorPolicy({ custom: true });
    expect(result.policy).toBe("all");
    expect(result.warning ?? "").toMatch(/Invalid piVim\.clipboardMirror/);
  });
});
