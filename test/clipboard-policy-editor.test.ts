import { describe, expect, it } from "vitest";

import { createEditorWithSpy, sendKeys } from "./harness.js";

function nextImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function nextClipboardDrain(): Promise<void> {
  await nextImmediate();
  await nextImmediate();
}

describe("clipboard mirror policy", () => {
  it("all clipboard mirror policy mirrors mutation and yank writes", async () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("all");

    sendKeys(editor, ["d", "w", "y", "w"]);
    await nextImmediate();

    expect(editor.getRegister()).toBe("bar");
    expect(clipboardWrites).toEqual(["foo ", "bar"]);
  });

  it("all clipboard mirror policy mirrors change writes", async () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("all");

    sendKeys(editor, ["c", "w"]);
    await nextImmediate();

    expect(editor.getRegister()).toBe("foo ");
    expect(clipboardWrites).toEqual(["foo "]);
  });

  it("yank clipboard mirror policy skips delete writes but updates the register", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("yank");

    sendKeys(editor, ["d", "w"]);

    expect(editor.getRegister()).toBe("foo ");
    expect(clipboardWrites).toEqual([]);
  });

  it("yank clipboard mirror policy skips change writes but updates the register", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("yank");

    sendKeys(editor, ["c", "w"]);

    expect(editor.getRegister()).toBe("foo ");
    expect(clipboardWrites).toEqual([]);
  });

  it("yank clipboard mirror policy skips mutation writes", async () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("yank");

    sendKeys(editor, ["d", "w", "y", "w", "c", "w"]);
    await nextImmediate();

    expect(editor.getRegister()).toBe("bar");
    expect(clipboardWrites).toEqual(["bar"]);
  });

  it("never clipboard mirror policy keeps mutation and yank writes internal", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("never");

    sendKeys(editor, ["y", "y"]);

    expect(editor.getRegister()).toBe("foo bar\n");
    expect(clipboardWrites).toEqual([]);

    sendKeys(editor, ["d", "w"]);

    expect(editor.getRegister()).toBe("foo ");
    expect(clipboardWrites).toEqual([]);
  });

  it("never clipboard mirror policy keeps change writes internal", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    editor.setClipboardMirrorPolicy("never");

    sendKeys(editor, ["c", "w"]);

    expect(editor.getRegister()).toBe("foo ");
    expect(clipboardWrites).toEqual([]);
  });

  for (const scenario of [
    {
      policy: "all" as const,
      write: ["d", "w"],
      put: ["P"],
      expectedText: "foo bar",
      expectedClipboardWrites: ["foo "],
    },
    {
      policy: "yank" as const,
      write: ["d", "w"],
      put: ["P"],
      expectedText: "foo bar",
      expectedClipboardWrites: [],
    },
    {
      policy: "yank" as const,
      write: ["y", "w"],
      put: ["P"],
      expectedText: "foo foo bar",
      expectedClipboardWrites: ["foo "],
    },
    {
      policy: "never" as const,
      write: ["d", "w"],
      put: ["P"],
      expectedText: "foo bar",
      expectedClipboardWrites: [],
    },
    {
      policy: "never" as const,
      write: ["y", "w"],
      put: ["P"],
      expectedText: "foo foo bar",
      expectedClipboardWrites: [],
    },
  ]) {
    it(`${scenario.policy} clipboard mirror policy chooses the expected put source after ${scenario.write.join("")}`, async () => {
      const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
      let systemClipboard = "SYS";
      editor.setClipboardMirrorPolicy(scenario.policy);
      editor.setClipboardFn((text) => {
        clipboardWrites.push(text);
        systemClipboard = text;
      });
      editor.setClipboardReadFn(() => systemClipboard);

      sendKeys(editor, scenario.write);
      await nextClipboardDrain();
      sendKeys(editor, scenario.put);

      expect(editor.getText()).toBe(scenario.expectedText);
      expect(clipboardWrites).toEqual(scenario.expectedClipboardWrites);
    });
  }

  for (const policy of ["all", "yank", "never"] as const) {
    it(`${policy} clipboard mirror policy keeps empty no-op writes from pinning put to the register`, () => {
      const { editor } = createEditorWithSpy("ab");
      editor.setClipboardMirrorPolicy(policy);
      editor.setClipboardReadFn(() => "SYS");

      // $ lands on 'b'; dl at the last char is a no-op (empty capture), so the
      // register stays empty and p reads the OS clipboard.
      sendKeys(editor, ["$", "d", "l", "p"]);

      expect(editor.getText()).toBe("abSYS");
      expect(editor.getRegister()).toBe("");
    });

    it(`${policy} clipboard mirror policy keeps p reading OS clipboard`, () => {
      const { editor } = createEditorWithSpy("ab");
      editor.setClipboardMirrorPolicy(policy);
      editor.setRegister("shadow");
      editor.setClipboardReadFn(() => "SYS");

      sendKeys(editor, ["p"]);

      expect(editor.getText()).toBe("aSYSb");
      expect(editor.getRegister()).toBe("shadow");
    });

    it(`${policy} clipboard mirror policy keeps P reading OS clipboard`, () => {
      const { editor } = createEditorWithSpy("ab");
      editor.setClipboardMirrorPolicy(policy);
      editor.setRegister("shadow");
      editor.setClipboardReadFn(() => "SYS");

      sendKeys(editor, ["P"]);

      expect(editor.getText()).toBe("SYSab");
      expect(editor.getRegister()).toBe("shadow");
    });
  }
});
