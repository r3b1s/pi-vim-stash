import { describe, expect, it } from "vitest";

import {
  readPiVimBooleanSetting,
  readPiVimClipboardMirrorSetting,
  readPiVimModeColors,
} from "../src/settings.js";

describe("piVim mode color settings reader", () => {
  it("returns undefined when mode colors are missing", () => {
    expect(readPiVimModeColors(undefined, undefined)).toBe(undefined);
    expect(readPiVimModeColors({ piVim: {} }, { piVim: {} })).toBe(undefined);
  });

  it("reads partial mode color settings", () => {
    expect(
      readPiVimModeColors(
        { piVim: { modeColors: { insert: " borderMuted " } } },
        {},
      ),
    ).toEqual({ insert: "borderMuted" });
  });

  it("reads all three mode color settings", () => {
    expect(
      readPiVimModeColors(
        {
          piVim: {
            modeColors: {
              insert: "muted",
              normal: "primary",
              ex: "warning",
            },
          },
        },
        {},
      ),
    ).toEqual({ insert: "muted", normal: "primary", ex: "warning" });
  });

  it("drops non-string mode color leaves", () => {
    expect(
      readPiVimModeColors(
        {
          piVim: { modeColors: { insert: "muted", normal: 42, ex: "warning" } },
        },
        {},
      ),
    ).toEqual({ insert: "muted", ex: "warning" });
  });

  it("drops malformed mode color tokens", () => {
    expect(
      readPiVimModeColors(
        {
          piVim: {
            modeColors: {
              insert: "red;evil",
              normal: "_bad",
              ex: "warn-ing_1",
            },
          },
        },
        {},
      ),
    ).toEqual({ ex: "warn-ing_1" });
  });

  it("lets project modeColors override global as a setting", () => {
    expect(
      readPiVimModeColors(
        {
          piVim: {
            modeColors: {
              insert: "globalInsert",
              normal: "globalNormal",
              ex: "globalEx",
            },
          },
        },
        { piVim: { modeColors: { ex: "projectEx" } } },
      ),
    ).toEqual({ ex: "projectEx" });
  });

  it("does not fall back to global modeColors when project leaves are invalid", () => {
    expect(
      readPiVimModeColors(
        {
          piVim: {
            modeColors: {
              insert: "globalInsert",
              normal: "globalNormal",
              ex: "globalEx",
            },
          },
        },
        {
          piVim: {
            modeColors: {
              insert: "projectInsert",
              normal: 42,
              ex: "red;evil",
            },
          },
        },
      ),
    ).toEqual({ insert: "projectInsert" });
  });

  it("treats malformed project modeColors as an override", () => {
    expect(
      readPiVimModeColors(
        { piVim: { modeColors: { insert: "globalInsert" } } },
        { piVim: { modeColors: null } },
      ),
    ).toBe(undefined);
  });
});

describe("piVim boolean settings reader", () => {
  it("returns undefined when boolean setting is missing", () => {
    expect(
      readPiVimBooleanSetting(undefined, undefined, "syncBorderColorWithMode"),
    ).toBe(undefined);
    expect(
      readPiVimBooleanSetting(
        { piVim: {} },
        { piVim: {} },
        "syncBorderColorWithMode",
      ),
    ).toBe(undefined);
  });

  it("reads true and false boolean settings", () => {
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: true } },
        {},
        "syncBorderColorWithMode",
      ),
    ).toBe(true);
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: false } },
        {},
        "syncBorderColorWithMode",
      ),
    ).toBe(false);
  });

  it("ignores invalid boolean settings", () => {
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: "true" } },
        {},
        "syncBorderColorWithMode",
      ),
    ).toBe(undefined);
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: 1 } },
        {},
        "syncBorderColorWithMode",
      ),
    ).toBe(undefined);
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: null } },
        {},
        "syncBorderColorWithMode",
      ),
    ).toBe(undefined);
  });

  it("lets project boolean settings override global", () => {
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: true } },
        { piVim: { syncBorderColorWithMode: false } },
        "syncBorderColorWithMode",
      ),
    ).toBe(false);
  });

  it("treats invalid project boolean settings as an override", () => {
    expect(
      readPiVimBooleanSetting(
        { piVim: { syncBorderColorWithMode: true } },
        { piVim: { syncBorderColorWithMode: "false" } },
        "syncBorderColorWithMode",
      ),
    ).toBe(undefined);
  });
});

describe("piVim clipboard mirror settings reader", () => {
  it("returns undefined when global and project settings are missing", () => {
    expect(readPiVimClipboardMirrorSetting(undefined, undefined)).toBe(
      undefined,
    );
    expect(readPiVimClipboardMirrorSetting(null, null)).toBe(undefined);
    expect(readPiVimClipboardMirrorSetting("bad", 42)).toBe(undefined);
  });

  it("reads global piVim clipboardMirror when project setting is missing", () => {
    expect(
      readPiVimClipboardMirrorSetting(
        { piVim: { clipboardMirror: "yank" } },
        {},
      ),
    ).toBe("yank");
  });

  it("lets project piVim clipboardMirror override global", () => {
    expect(
      readPiVimClipboardMirrorSetting(
        { piVim: { clipboardMirror: "never" } },
        { piVim: { clipboardMirror: "all" } },
      ),
    ).toBe("all");
  });

  it("treats invalid project clipboardMirror as an override instead of falling back to global", () => {
    expect(
      readPiVimClipboardMirrorSetting(
        { piVim: { clipboardMirror: "yank" } },
        { piVim: { clipboardMirror: null } },
      ),
    ).toBe(null);
  });

  it("treats malformed project piVim settings as an override instead of falling back to global", () => {
    expect(
      readPiVimClipboardMirrorSetting(
        { piVim: { clipboardMirror: "yank" } },
        { piVim: "bad" },
      ),
    ).toBe("bad");
  });
});
