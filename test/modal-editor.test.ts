/**
 * Integration tests for ModalEditor key sequences.
 *
 * Smoke matrix: ~30+ scenarios covering the full command surface.
 * Table-driven style used wherever the pattern is uniform; explicit `it`
 * blocks where state inspection requires nuance.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import installPiVim, { ModalEditor } from "../src/index.js";
import type { WordMotionClass } from "../src/motions.js";
import { setPiVimSettingsReaderForTests } from "../src/settings.js";
import type {
  WordMotionDirection,
  WordMotionTarget,
} from "../src/word-boundary-cache.js";
import {
  createCursorShapeTui,
  createEditorWithSpy,
  createExtensionApiHarness,
  createMultiLineEditor,
  sendKeys,
  stubKeybindings,
  stubTheme,
  stubTui,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ModalEditorWordBoundaryCacheInternals = {
  tryFindTarget(
    line: string,
    col: number,
    direction: WordMotionDirection,
    target: WordMotionTarget,
    semanticClass?: WordMotionClass,
  ): number | null;
};

type ModalEditorTestInternals = {
  tryFindWordTargetLineLocal?: (
    direction: WordMotionDirection,
    target: WordMotionTarget,
    semanticClass?: WordMotionClass,
  ) => number | null;
  findWordTargetInText(
    text: string,
    abs: number,
    direction: "forward" | "backward",
    target: "start" | "end",
    count?: number,
    semanticClass?: WordMotionClass,
  ): number;
  wordBoundaryCache: ModalEditorWordBoundaryCacheInternals;
  state?: unknown;
  pushUndoSnapshot?: (() => void) | undefined;
};

type FindWordTargetInTextArgs = Parameters<
  ModalEditorTestInternals["findWordTargetInText"]
>;
type TryFindTargetArgs = Parameters<
  ModalEditorWordBoundaryCacheInternals["tryFindTarget"]
>;

type EditorFactory = (
  tui: ConstructorParameters<typeof ModalEditor>[0],
  theme: ConstructorParameters<typeof ModalEditor>[1],
  keybindings: ConstructorParameters<typeof ModalEditor>[2],
) => ModalEditor;
type Theme = ConstructorParameters<typeof ModalEditor>[1];

type NotificationCall = { message: string; type: string };
type ThemeFgCall = { token: string; text: string };

function getRawEditor(editor: ModalEditor): ModalEditorTestInternals {
  return editor as unknown as ModalEditorTestInternals;
}

const INSERT_CURSOR_SHAPE = "\x1b[5 q";
const BLOCK_CURSOR_SHAPE = "\x1b[1 q";
const RESET_CURSOR_SHAPE = "\x1b[0 q";
const SOFTWARE_CURSOR_SPACE = "\x1b[7m \x1b[0m";

const DECSCUSR_PATTERN = /\x1b\[[015] q/;

function focusEditor(editor: ModalEditor): void {
  editor.focused = true;
}

type WrapperFacingEditor = ModalEditor & {
  actionHandlers: Map<string, unknown>;
  onSubmit: (text: string) => unknown;
  onChange: (text: string) => unknown;
  onEscape: () => unknown;
  onCtrlD: () => unknown;
  onPasteImage: (path: string) => unknown;
  onExtensionShortcut: (shortcut: string) => unknown;
  focused: boolean;
  disableSubmit: boolean;
  borderColor: (text: string) => string;
};

const WRAPPER_FACING_METHODS = [
  "handleInput",
  "render",
  "invalidate",
  "getText",
  "setText",
  "insertTextAtCursor",
  "getExpandedText",
  "addToHistory",
  "setAutocompleteProvider",
  "setPaddingX",
  "setAutocompleteMaxVisible",
  "getLines",
  "getCursor",
  "getMode",
  "onAction",
] as const satisfies readonly (keyof WrapperFacingEditor)[];

const WRAPPER_FACING_FIELDS = [
  "onSubmit",
  "onChange",
  "onEscape",
  "onCtrlD",
  "onPasteImage",
  "onExtensionShortcut",
  "actionHandlers",
  "focused",
  "disableSubmit",
  "borderColor",
] as const satisfies readonly (keyof WrapperFacingEditor)[];

type DecoratedCall =
  | { method: "insertTextAtCursor"; text: string }
  | { method: "handleInput"; data: string }
  | { method: "setText"; text: string };

function assertWrapperFacingSurface(
  editor: ModalEditor,
): asserts editor is WrapperFacingEditor {
  const candidate = editor as WrapperFacingEditor;

  for (const method of WRAPPER_FACING_METHODS) {
    expect(typeof candidate[method]).toBe("function");
  }

  for (const field of WRAPPER_FACING_FIELDS) {
    expect(field in candidate).toBeTruthy();
  }

  expect(candidate.actionHandlers instanceof Map).toBeTruthy();
  expect(typeof candidate.focused).toBe("boolean");
  expect(typeof candidate.disableSubmit).toBe("boolean");
  expect(typeof candidate.borderColor).toBe("function");
}

function decorateLikeImageAttachments(editor: ModalEditor): DecoratedCall[] {
  assertWrapperFacingSurface(editor);
  const calls: DecoratedCall[] = [];
  const originalInsertTextAtCursor = editor.insertTextAtCursor.bind(editor);
  const originalHandleInput = editor.handleInput.bind(editor);
  const originalSetText = editor.setText.bind(editor);

  editor.insertTextAtCursor = (text: string) => {
    calls.push({ method: "insertTextAtCursor", text });
    return originalInsertTextAtCursor(text);
  };
  editor.handleInput = (data: string) => {
    calls.push({ method: "handleInput", data });
    return originalHandleInput(data);
  };
  editor.setText = (text: string) => {
    calls.push({ method: "setText", text });
    return originalSetText(text);
  };

  return calls;
}

function findCursorMarkerLine(lines: string[]): string {
  const line = lines.find((line) => line.includes(CURSOR_MARKER));
  expect(line).toBeTruthy();
  return line!;
}

function removeCursorMarker(line: string): string {
  return line.replace(CURSOR_MARKER, "");
}

function assertNoCursorShapeSequences(lines: string[]): void {
  for (const line of lines) {
    expect(line).not.toMatch(DECSCUSR_PATTERN);
  }
}

function setInternalCursor(
  editor: ModalEditor,
  cursorCol: number,
  cursorLine: number = 0,
): void {
  const internal = editor as unknown as {
    state?: { cursorLine?: number; cursorCol?: number };
    preferredVisualCol?: number | null;
    lastAction?: string | null;
    tui?: { requestRender?: () => void };
  };

  if (!internal.state) {
    throw new Error("ModalEditor test internal state unavailable");
  }

  internal.state.cursorLine = cursorLine;
  internal.state.cursorCol = cursorCol;
  internal.preferredVisualCol = null;
  internal.lastAction = null;
  internal.tui?.requestRender?.();
}

type InstalledExtension = {
  editorFactory: EditorFactory;
  readonly notificationCalls: number;
  readonly notifications: NotificationCall[];
  readonly shutdownCalls: number;
  emitShutdown(): Promise<void>;
  readonly sessionShutdownHandlerCount: number;
  readonly sessionEndHandlerCount: number;
};

function createRecordingTheme(
  rejectedTokens: readonly string[] = [],
): Theme & { fgCalls: ThemeFgCall[] } {
  const fgCalls: ThemeFgCall[] = [];
  const rejected = new Set(rejectedTokens);
  return {
    borderColor: (s: string) => s,
    fg: (token: string, text: string) => {
      fgCalls.push({ token, text });
      if (rejected.has(token)) {
        throw new Error(`unknown theme token: ${token}`);
      }
      return `<${token}>${text}</${token}>`;
    },
    bold: (s: string) => s,
    fgCalls,
  } as unknown as Theme & { fgCalls: ThemeFgCall[] };
}

async function installExtensionWithEditorFactory(
  theme: Theme = stubTheme,
): Promise<InstalledExtension> {
  const pi = createExtensionApiHarness();
  let editorFactory: EditorFactory | null = null;
  let notificationCalls = 0;
  const notifications: NotificationCall[] = [];
  let shutdownCalls = 0;
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    ui: {
      theme,
      setEditorComponent(factory: EditorFactory): void {
        editorFactory = factory;
      },
      notify(message: string, type: string): void {
        notificationCalls++;
        notifications.push({ message, type });
      },
    },
    shutdown(): void {
      shutdownCalls++;
    },
  };

  installPiVim(pi);
  await pi.emit("session_start", undefined, ctx);

  if (!editorFactory) {
    throw new Error("expected session_start to install an editor factory");
  }

  return {
    editorFactory,
    get notificationCalls() {
      return notificationCalls;
    },
    get notifications() {
      return notifications;
    },
    get shutdownCalls() {
      return shutdownCalls;
    },
    async emitShutdown(): Promise<void> {
      await pi.emit("session_shutdown", undefined, ctx);
    },
    get sessionShutdownHandlerCount() {
      return pi.handlersFor("session_shutdown").length;
    },
    get sessionEndHandlerCount() {
      return pi.handlersFor("session_end").length;
    },
  };
}

function createSpawnErrno(message: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  error.syscall = "spawn clipboard-helper";
  return error;
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = () => resolvePromise();
  });

  if (resolve === undefined) {
    throw new Error("deferred promise was not initialized");
  }

  return { promise, resolve };
}

function nextImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

type HelperRunResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

const CLIPBOARD_HELPER_TEST_TIMEOUT_MS = 5_000;

async function getClipboardHelperSourceWithMock(
  mockModuleSource: string,
): Promise<string> {
  const indexSource = await readFile(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const match = /_clipboardHelperSource = `([\s\S]*?)`;/.exec(indexSource);

  expect(match).toBeTruthy();
  expect(match![1]).toBeTruthy();

  const mockModuleUrl = `data:text/javascript,${encodeURIComponent(mockModuleSource)}`;
  const helperImportLine = [
    "import { copyToClipboard } from ",
    "$",
    "{JSON.stringify(getModuleUrl())};",
  ].join("");
  const replacementImportLine = `import { copyToClipboard } from ${JSON.stringify(mockModuleUrl)};`;
  const helperSource = match![1];

  expect(helperSource.includes(helperImportLine)).toBe(true);

  const mockedSource = helperSource.replace(
    helperImportLine,
    replacementImportLine,
  );

  expect(mockedSource).not.toBe(helperSource);
  expect(mockedSource.includes(helperImportLine)).toBe(false);
  expect(mockedSource.includes(replacementImportLine)).toBe(true);

  return mockedSource;
}

async function getClipboardReadHelperSourceWithMock(
  mockClipboardExpression: string,
): Promise<string> {
  const indexSource = await readFile(
    new URL("../src/index.ts", import.meta.url),
    "utf8",
  );
  const match = /_clipboardReadHelperSource = `([\s\S]*?)`;/.exec(indexSource);

  expect(match).toBeTruthy();
  expect(match![1]).toBeTruthy();

  const requireLine = [
    "const require = createRequire(",
    "$",
    "{JSON.stringify(getModuleUrl())});",
  ].join("");
  const clipboardLine = 'const clipboard = require("@mariozechner/clipboard");';
  const replacement = `const clipboard = ${mockClipboardExpression};`;
  const helperSource = match![1];
  const mockedSource = helperSource.replace(
    `${requireLine}\n${clipboardLine}`,
    replacement,
  );

  expect(mockedSource).not.toBe(helperSource);
  expect(mockedSource.includes(clipboardLine)).toBe(false);
  expect(mockedSource.includes(replacement)).toBe(true);

  return mockedSource;
}

function runClipboardHelperSource(
  source: string,
  input: string,
): Promise<HelperRunResult> {
  return new Promise<HelperRunResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    function finish(error: unknown, result?: HelperRunResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      if (error) {
        reject(error);
        return;
      }
      if (result === undefined) {
        reject(new Error("clipboard helper result missing"));
        return;
      }

      resolve(result);
    }

    const timeoutId = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Best effort: the timeout already fails the helper-source test.
      }
      finish(
        new Error(
          `clipboard helper timed out after ${CLIPBOARD_HELPER_TEST_TIMEOUT_MS}ms`,
        ),
      );
    }, CLIPBOARD_HELPER_TEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code, signal) => {
      finish(null, {
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    child.stdin.end(input);
  });
}

/** Run keys on a fresh single-line editor and check text + optional register. */
function chk(
  initial: string,
  keys: string[],
  expectedText: string,
  expectedRegister?: string,
): void {
  const { editor } = createEditorWithSpy(initial);
  sendKeys(editor, keys);
  expect(editor.getText()).toBe(expectedText);
  if (expectedRegister !== undefined) {
    expect(editor.getRegister()).toBe(expectedRegister);
  }
}

/** Run keys on a fresh editor and check mode. */
function chkMode(
  initial: string,
  keys: string[],
  expectedMode: "normal" | "insert",
): void {
  const { editor } = createEditorWithSpy(initial);
  sendKeys(editor, keys);
  expect(editor.getMode()).toBe(expectedMode);
}

function assertRedoRoundTrip(options: {
  initial: string;
  keys: string[];
  expectedText: string;
  expectedCursor: { line: number; col: number };
  expectedRegister: string;
  multiLine?: boolean;
  before?: (editor: ReturnType<typeof createEditorWithSpy>["editor"]) => void;
}): void {
  const {
    initial,
    keys,
    expectedText,
    expectedCursor,
    expectedRegister,
    multiLine = false,
    before,
  } = options;
  const { editor } = multiLine
    ? createMultiLineEditor(initial)
    : createEditorWithSpy(initial);

  before?.(editor);
  sendKeys(editor, keys);

  expect(editor.getText()).toBe(expectedText);
  expect(editor.getCursor()).toEqual(expectedCursor);
  expect(editor.getRegister()).toBe(expectedRegister);

  sendKeys(editor, ["u", "\x12"]);

  expect(editor.getText()).toBe(expectedText);
  expect(editor.getCursor()).toEqual(expectedCursor);
  expect(editor.getRegister()).toBe(expectedRegister);
}

function makeGeneratedLineFixtures(count: number): string[] {
  let seed = 0x51f15eed;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };

  const words = ["alpha", "beta_2", "GAMMA", "z9", "m_n"];
  const punct = ["-", "--", "::", ".", ",", "!?", "#"];
  const spaces = [" ", "  ", "   ", "\t"];
  const fixtures = ["", "   ", "---", "a", "a   b", "foo--bar"];
  const pick = (values: readonly string[]): string =>
    values[next() % values.length] ?? "";

  for (let i = 0; i < count; i++) {
    const parts: string[] = [];
    const partCount = 1 + (next() % 6);

    for (let part = 0; part < partCount; part++) {
      const bucket = next() % 5;
      if (bucket <= 1) {
        parts.push(pick(words));
      } else if (bucket === 2) {
        parts.push(pick(punct));
      } else {
        parts.push(pick(spaces));
      }
    }

    fixtures.push(parts.join(""));
  }

  return fixtures;
}

function runScenario(
  initial: string,
  keys: string[],
  mode: "fast" | "canonical",
): {
  text: string;
  register: string;
  editorMode: "normal" | "insert";
  cursorLine: number;
  cursorCol: number;
} {
  const { editor } = initial.includes("\n")
    ? createMultiLineEditor(initial)
    : createEditorWithSpy(initial);

  if (mode === "canonical") {
    getRawEditor(editor).tryFindWordTargetLineLocal = () => null;
  }

  sendKeys(editor, keys);

  const cursor = editor.getCursor();

  return {
    text: editor.getText(),
    register: editor.getRegister(),
    editorMode: editor.getMode(),
    cursorLine: cursor.line,
    cursorCol: cursor.col,
  };
}

function createEditorAtBufferEnd(text: string): ModalEditor {
  const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);

  for (const char of text) {
    editor.handleInput(char);
  }

  editor.handleInput("\x1b");

  return editor;
}

function assertInsertBorderAfterModeChangingCommand(
  fixtureText: string,
  commandKeys: string[],
): void {
  const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings, {
    borderColorizers: {
      insert: (s: string) => `<insert>${s}</insert>`,
      normal: (s: string) => `<normal>${s}</normal>`,
      ex: (s: string) => `<ex>${s}</ex>`,
    },
  });

  for (const char of fixtureText) {
    editor.handleInput(char);
  }
  editor.handleInput("\x1b");

  sendKeys(editor, commandKeys);

  expect(editor.getMode()).toBe("insert");
  expect(editor.borderColor("x")).toBe("<insert>x</insert>");
}

// ---------------------------------------------------------------------------
// Wrapper-facing editor surface
// ---------------------------------------------------------------------------

describe("wrapper-facing editor surface", () => {
  it("exposes the CustomEditor-style surface later decorators need", () => {
    const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);

    assertWrapperFacingSurface(editor);
  });

  it("keeps modal behavior when a later decorator patches core methods in place", () => {
    const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings);
    const calls = decorateLikeImageAttachments(editor);

    editor.insertTextAtCursor("abc");
    expect(editor.getText()).toBe("abc");

    editor.setText("hello");
    expect(editor.getText()).toBe("hello");

    editor.handleInput("!");
    expect(editor.getText()).toBe("hello!");
    expect(editor.getMode()).toBe("insert");

    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");

    editor.handleInput("0");
    editor.handleInput("x");
    expect(editor.getText()).toBe("ello!");
    expect(editor.getMode()).toBe("normal");

    expect(calls).toEqual([
      { method: "insertTextAtCursor", text: "abc" },
      { method: "setText", text: "hello" },
      { method: "handleInput", data: "!" },
      { method: "handleInput", data: "\x1b" },
      { method: "handleInput", data: "0" },
      { method: "handleInput", data: "x" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Mode transitions
// ---------------------------------------------------------------------------

describe("mode transitions", () => {
  it("escape enters normal mode", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["i"]);
    expect(editor.getMode()).toBe("insert");
    sendKeys(editor, ["\x1b"]);
    expect(editor.getMode()).toBe("normal");
  });

  it("kitty ctrl+[ enters normal mode like escape", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["i"]);
    expect(editor.getMode()).toBe("insert");
    sendKeys(editor, ["\x1b[91;5u"]);
    expect(editor.getMode()).toBe("normal");
  });

  it("i enters insert mode from normal", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["i"]);
    expect(editor.getMode()).toBe("insert");
  });

  it("escape in normal mode stays in normal (passes raw esc upward)", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["\x1b"]);
    expect(editor.getMode()).toBe("normal");
  });

  it("kitty ctrl+[ in normal mode forwards escape upward", () => {
    const { editor } = createEditorWithSpy("hello");

    const customEditorProto = Object.getPrototypeOf(
      Object.getPrototypeOf(editor),
    );
    const originalHandleInput = customEditorProto.handleInput;
    let forwardedEscapeCount = 0;

    customEditorProto.handleInput = function (
      this: unknown,
      data: string,
    ): unknown {
      if (data === "\x1b") forwardedEscapeCount++;
      return originalHandleInput.call(this, data);
    };

    try {
      sendKeys(editor, ["\x1b[91;5u"]);
      expect(editor.getMode()).toBe("normal");
      expect(forwardedEscapeCount).toBe(1);
    } finally {
      customEditorProto.handleInput = originalHandleInput;
    }
  });

  it("a at EOL on non-last line appends on same line", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$", "a", "X"]);
    expect(editor.getText()).toBe("fooX\nbar");
    expect(editor.getMode()).toBe("insert");
  });

  it("normal mode ignores printable unicode input", () => {
    const { editor } = createEditorWithSpy("abc");
    sendKeys(editor, ["😀"]);
    expect(editor.getText()).toBe("abc");
    expect(editor.getMode()).toBe("normal");
  });

  it("normal mode ignores pasted printable chunks", () => {
    const { editor } = createEditorWithSpy("abc");
    sendKeys(editor, ["xyz"]);
    expect(editor.getText()).toBe("abc");
    expect(editor.getMode()).toBe("normal");
  });

  it("normal mode does not treat prototype keys as mappings", () => {
    const { editor } = createEditorWithSpy("abc");

    expect(() => sendKeys(editor, ["toString"])).not.toThrow();
    expect(editor.getText()).toBe("abc");
    expect(editor.getMode()).toBe("normal");
  });

  it("normal mode ignores bracketed paste payload", () => {
    const { editor } = createEditorWithSpy("abc");
    sendKeys(editor, ["\x1b[200~PASTE\x1b[201~"]);
    expect(editor.getText()).toBe("abc");
    expect(editor.getMode()).toBe("normal");
  });

  it("insert mode keeps bracketed paste payload text", () => {
    const { editor } = createEditorWithSpy("abc");
    sendKeys(editor, ["i", "\x1b[200~PASTE\x1b[201~"]);
    expect(editor.getText()).toBe("PASTEabc");
    expect(editor.getMode()).toBe("insert");
  });

  it("escape from insert clears unterminated bracketed paste state", () => {
    const { editor } = createEditorWithSpy("abc");

    sendKeys(editor, ["i", "\x1b[200~", "\x1b", "l", "x"]);

    expect(editor.getMode()).toBe("normal");
    expect(editor.getText()).toBe("ac");
    expect(editor.getRegister()).toBe("b");
  });

  it("I enters insert at first non-whitespace char", () => {
    const { editor } = createMultiLineEditor("   hello");
    // move to end of line
    sendKeys(editor, ["$"]);
    // I should go to first non-ws (col 3)
    sendKeys(editor, ["I"]);
    expect(editor.getMode()).toBe("insert");
    expect(editor.getCursor().col).toBe(3);
  });

  it("I on line with no leading whitespace goes to col 0", () => {
    const { editor } = createMultiLineEditor("hello");
    sendKeys(editor, ["$"]);
    sendKeys(editor, ["I"]);
    expect(editor.getMode()).toBe("insert");
    expect(editor.getCursor().col).toBe(0);
  });
});

describe("ex mini-mode", () => {
  it("renders the pending EX command and consumes prefixed counts", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, ["2", ":"]);

    expect(session.editor.render(80).at(-1)?.endsWith(" EX :_ ")).toBeTruthy();

    sendKeys(session.editor, ["\x1b", "x"]);

    expect(session.quitCalls).toBe(0);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("ello");
    expect(session.editor.getRegister()).toBe("h");
  });

  it("keeps the EX label visible on narrow renders", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", ...Array.from("averyveryverylongcommand")]);

    const footer = session.editor.render(20).at(-1) ?? "";

    expect(footer.includes(" EX ")).toBeTruthy();
    expect(footer.endsWith("_ ")).toBeTruthy();
  });

  it("renders EX labels with the EX-specific colorizer", () => {
    const calls: string[] = [];
    const colorizers = {
      insert: (s: string) => {
        calls.push(`insert:${s}`);
        return `\x1b[32m${s}\x1b[39m`;
      },
      normal: (s: string) => {
        calls.push(`normal:${s}`);
        return `\x1b[34m${s}\x1b[39m`;
      },
      ex: (s: string) => {
        calls.push(`ex:${s}`);
        return `\x1b[35m${s}\x1b[39m`;
      },
    };
    const editor = new ModalEditor(stubTui, stubTheme, stubKeybindings, {
      labelColorizers: colorizers,
    });

    editor.handleInput("\x1b");
    sendKeys(editor, [":"]);

    const footer = editor.render(80).at(-1) ?? "";

    expect(calls).toEqual(["ex: EX :_ "]);
    expect(footer.includes(" EX :_ ")).toBeTruthy();
    expect(footer.endsWith("\x1b[35m EX :_ \x1b[39m")).toBeTruthy();
  });

  it(":q refuses to quit when prompt has non-whitespace text", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "q", "\r"]);

    expect(session.quitCalls).toBe(0);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("hello");
    expect(session.editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(session.notifications).toEqual([
      "Prompt is not empty; use :q! to quit anyway",
    ]);
  });

  it(":qa refuses to quit when prompt has non-whitespace text", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "q", "a", "\r"]);

    expect(session.quitCalls).toBe(0);
    expect(session.editor.getText()).toBe("hello");
    expect(session.notifications).toEqual([
      "Prompt is not empty; use :qa! to quit anyway",
    ]);
  });

  it(":q requests quit when prompt is empty", () => {
    const session = createEditorWithSpy("");

    sendKeys(session.editor, [":", "q", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getText()).toBe("");
    expect(session.notifications).toEqual([]);
  });

  it(":qa requests quit when prompt is whitespace-only", () => {
    const session = createEditorWithSpy("   ");

    sendKeys(session.editor, [":", "q", "a", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getText()).toBe("   ");
    expect(session.notifications).toEqual([]);
  });

  it(":qa! requests quit when prompt has non-whitespace text", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "q", "a", "!", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getText()).toBe("hello");
    expect(session.notifications).toEqual([]);
  });

  it("escape cancels ex mini-mode", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "q", "\x1b", "x"]);

    expect(session.quitCalls).toBe(0);
    expect(session.editor.getText()).toBe("ello");
    expect(session.editor.getRegister()).toBe("h");
  });

  it("backspace edits the pending ex command", () => {
    const session = createEditorWithSpy("");

    sendKeys(session.editor, [":", "q", "a", "\x7f", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.notifications).toEqual([]);
  });

  it("ctrl+h edits the pending ex command", () => {
    const session = createEditorWithSpy("");

    sendKeys(session.editor, [":", "q", "a", "\x08", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.notifications).toEqual([]);
  });

  it("backspace removes one full grapheme from the pending ex command", () => {
    const session = createEditorWithSpy("");

    sendKeys(session.editor, [":", "e\u0301", "\x7f", "q", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.notifications).toEqual([]);
    expect(session.editor.getText()).toBe("");
  });

  it(":q! requests quit when prompt has non-whitespace text", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "q", "!", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getText()).toBe("hello");
    expect(session.notifications).toEqual([]);
  });

  it("bracketed paste payload is accepted in ex mini-mode", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "\x1b[200~q!\x1b[201~", "\r"]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("hello");
    expect(session.notifications).toEqual([]);
  });

  it("split bracketed paste payload is accepted in ex mini-mode", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [
      ":",
      "\x1b[200~",
      "q",
      "a",
      "!",
      "\x1b",
      "[201~",
      "\r",
    ]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("hello");
    expect(session.notifications).toEqual([]);
  });

  it("newline in bracketed paste submits the pending ex command", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "\x1b[200~q!\n\x1b[201~"]);

    expect(session.quitCalls).toBe(1);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("hello");
    expect(session.notifications).toEqual([]);
  });

  it("newline submit in split bracketed paste discards the trailing paste marker", () => {
    const session = createEditorWithSpy("hello");
    const customEditorProto = Object.getPrototypeOf(
      Object.getPrototypeOf(session.editor),
    );
    const originalHandleInput = customEditorProto.handleInput;
    let forwardedEscapeCount = 0;

    customEditorProto.handleInput = function (
      this: unknown,
      data: string,
    ): unknown {
      if (data === "\x1b") forwardedEscapeCount++;
      return originalHandleInput.call(this, data);
    };

    try {
      sendKeys(session.editor, [":", "\x1b[200~q!\n", "\x1b", "[201~", "x"]);

      expect(session.quitCalls).toBe(1);
      expect(forwardedEscapeCount).toBe(0);
      expect(session.editor.getMode()).toBe("normal");
      expect(session.editor.getText()).toBe("ello");
      expect(session.editor.getRegister()).toBe("h");
      expect(session.notifications).toEqual([]);
    } finally {
      customEditorProto.handleInput = originalHandleInput;
    }
  });

  it("empty submit is a silent no-op", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "\r"]);

    expect(session.quitCalls).toBe(0);
    expect(session.notifications).toEqual([]);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("hello");
  });

  it("backspace on bare colon exits ex mode", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, [":", "\x7f", "x"]);

    expect(session.quitCalls).toBe(0);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("ello");
    expect(session.editor.getRegister()).toBe("h");
  });

  it("non-printable input cancels ex mode and is reprocessed", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, ["x", "u", ":", "q", "\x12"]);

    expect(session.quitCalls).toBe(0);
    expect(session.notifications).toEqual([]);
    expect(session.editor.getMode()).toBe("normal");
    expect(session.editor.getText()).toBe("ello");
    expect(session.editor.getRegister()).toBe("h");
  });

  it("unsupported ex commands do not quit", () => {
    const session = createEditorWithSpy("hello");

    sendKeys(session.editor, ["l", "l", ":", "w", "q", "\r"]);

    expect(session.quitCalls).toBe(0);
    expect(session.notifications).toEqual(["Unsupported ex command: :wq"]);
    expect(session.editor.getText()).toBe("hello");
    expect(session.editor.getCursor()).toEqual({ line: 0, col: 2 });
  });
});

describe("clipboard mirror policy settings", () => {
  it("applies clipboardMirror=never from settings", async () => {
    const restore = setPiVimSettingsReaderForTests(() => ({
      clipboardMirror: "never",
    }));

    try {
      const extension = await installExtensionWithEditorFactory();
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      expect(editor.getClipboardMirrorPolicy()).toBe("never");
      expect(extension.notificationCalls).toBe(0);
    } finally {
      restore();
    }
  });

  it("falls back to all and warns for invalid clipboardMirror", async () => {
    const restore = setPiVimSettingsReaderForTests(() => ({
      clipboardMirror: "delete",
    }));

    try {
      const extension = await installExtensionWithEditorFactory();
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      expect(editor.getClipboardMirrorPolicy()).toBe("all");
      expect(extension.notificationCalls).toBe(1);
      expect(extension.notifications.length).toBe(1);

      const notification = extension.notifications[0];
      expect(notification).toBeTruthy();
      expect(notification.type).toBe("warning");
      expect(notification.message).toMatch(/delete/);
      expect(notification.message).toMatch(/all, yank, never/);
    } finally {
      restore();
    }
  });
});

describe("mode color settings", () => {
  const reverseInsertLabel = "\x1b[7m INSERT \x1b[27m";

  it("mode label uses default insert, normal, and EX mode color tokens", async () => {
    const theme = createRecordingTheme();
    const restore = setPiVimSettingsReaderForTests(() => ({}));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      editor.render(80);
      sendKeys(editor, ["\x1b"]);
      editor.render(80);
      sendKeys(editor, [":"]);
      editor.render(80);

      expect(theme.fgCalls.map((call) => call.token)).toEqual([
        "borderMuted",
        "borderAccent",
        "warning",
      ]);
    } finally {
      restore();
    }
  });

  it("mode label uses a custom insert mode color token", async () => {
    const theme = createRecordingTheme();
    const restore = setPiVimSettingsReaderForTests(() => ({
      modeColors: { insert: "primary" },
    }));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      editor.render(80);

      expect(theme.fgCalls).toEqual([
        { token: "primary", text: reverseInsertLabel },
      ]);
    } finally {
      restore();
    }
  });

  it("mode label partial mode color overrides preserve default tokens", async () => {
    const theme = createRecordingTheme();
    const restore = setPiVimSettingsReaderForTests(() => ({
      modeColors: { insert: "primary" },
    }));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      editor.render(80);
      sendKeys(editor, ["\x1b"]);
      editor.render(80);
      sendKeys(editor, [":"]);
      editor.render(80);

      expect(theme.fgCalls.map((call) => call.token)).toEqual([
        "primary",
        "borderAccent",
        "warning",
      ]);
    } finally {
      restore();
    }
  });

  it("mode label falls back when the EX mode color token is unknown", async () => {
    const theme = createRecordingTheme(["unknownToken"]);
    const restore = setPiVimSettingsReaderForTests(() => ({
      modeColors: { ex: "unknownToken" },
    }));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      sendKeys(editor, ["\x1b", ":"]);

      expect(() => editor.render(80)).not.toThrow();
      expect(theme.fgCalls.map((call) => call.token)).toEqual([
        "unknownToken",
        "warning",
      ]);
    } finally {
      restore();
    }
  });

  it("mode label passes reverse-video text to theme.fg", async () => {
    const theme = createRecordingTheme();
    const restore = setPiVimSettingsReaderForTests(() => ({}));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );

      editor.render(80);

      expect(theme.fgCalls).toEqual([
        { token: "borderMuted", text: reverseInsertLabel },
      ]);
    } finally {
      restore();
    }
  });

  for (const [name, settings] of [
    ["absent", {}],
    ["false", { syncBorderColorWithMode: false }],
  ] as const) {
    it(`syncBorderColorWithMode ${name} keeps the original border color reference`, async () => {
      const theme = createRecordingTheme();
      const restore = setPiVimSettingsReaderForTests(() => settings);

      try {
        const extension = await installExtensionWithEditorFactory(theme);
        const editor = extension.editorFactory(
          stubTui,
          stubTheme,
          stubKeybindings,
        );
        const originalBorderColor = editor.borderColor;

        sendKeys(editor, ["\x1b", ":", "\x1b", "i"]);

        expect(editor.borderColor).toBe(originalBorderColor);
      } finally {
        restore();
      }
    });
  }

  it("syncBorderColorWithMode true syncs border color across core transitions", async () => {
    const theme = createRecordingTheme();
    const restore = setPiVimSettingsReaderForTests(() => ({
      modeColors: {
        insert: "insertToken",
        normal: "normalToken",
        ex: "exToken",
      },
      syncBorderColorWithMode: true,
    }));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );
      const originalBorderColor = editor.borderColor;

      expect(editor.borderColor("border")).toBe(
        "<insertToken>border</insertToken>",
      );

      sendKeys(editor, ["\x1b"]);
      expect(editor.borderColor("border")).toBe(
        "<normalToken>border</normalToken>",
      );

      sendKeys(editor, [":"]);
      expect(editor.borderColor("border")).toBe("<exToken>border</exToken>");

      sendKeys(editor, ["\x1b"]);
      expect(editor.borderColor("border")).toBe(
        "<normalToken>border</normalToken>",
      );

      sendKeys(editor, ["i"]);
      expect(editor.borderColor("border")).toBe(
        "<insertToken>border</insertToken>",
      );
      expect(editor.borderColor).toBe(originalBorderColor);
    } finally {
      restore();
    }
  });

  it("syncBorderColorWithMode true survives Pi host borderColor assignment", async () => {
    const theme = createRecordingTheme();
    const restore = setPiVimSettingsReaderForTests(() => ({
      modeColors: {
        insert: "insertToken",
        normal: "normalToken",
        ex: "exToken",
      },
      syncBorderColorWithMode: true,
    }));

    try {
      const extension = await installExtensionWithEditorFactory(theme);
      const editor = extension.editorFactory(
        stubTui,
        stubTheme,
        stubKeybindings,
      );
      const defaultEditorBorderColor = (text: string) =>
        `<hostBorder>${text}</hostBorder>`;

      // Pi's InteractiveMode.setCustomEditorComponent copies the default
      // editor's borderColor onto the extension editor after the factory
      // returns. The mode-aware border hook must survive that assignment.
      editor.borderColor = defaultEditorBorderColor;
      expect(editor.borderColor("border")).toBe(
        "<insertToken>border</insertToken>",
      );

      sendKeys(editor, ["\x1b"]);
      expect(editor.borderColor("border")).toBe(
        "<normalToken>border</normalToken>",
      );

      sendKeys(editor, [":"]);
      expect(editor.borderColor("border")).toBe("<exToken>border</exToken>");
    } finally {
      restore();
    }
  });

  for (const [name, commandKeys] of [
    ["i", ["i"]],
    ["a", ["a"]],
    ["A", ["A"]],
    ["I", ["I"]],
    ["o", ["o"]],
    ["O", ["O"]],
    ["C", ["C"]],
    ["S", ["S"]],
    ["s", ["s"]],
    ["cc", ["c", "c"]],
    ["cw", ["c", "w"]],
    ["ct space", ["c", "t", " "]],
  ] as const) {
    it(`border updates for mode-changing commands: ${name}`, () => {
      assertInsertBorderAfterModeChangingCommand("alpha beta", [
        ...commandKeys,
      ]);
    });
  }
});

describe("cursor shape lifecycle", () => {
  it("registers cleanup on session_shutdown and not session_end", async () => {
    const extension = await installExtensionWithEditorFactory();

    expect(extension.sessionShutdownHandlerCount).toBe(1);
    expect(extension.sessionEndHandlerCount).toBe(0);
  });

  it("enables hardware cursor and restores the captured setting on shutdown", async () => {
    const extension = await installExtensionWithEditorFactory();
    const tui = createCursorShapeTui({ initialShowHardwareCursor: false });
    const operations: string[] = [];
    const originalWrite = tui.terminal.write;
    const originalSetShowHardwareCursor = tui.setShowHardwareCursor;

    expect(originalWrite).toBeTruthy();
    expect(originalSetShowHardwareCursor).toBeTruthy();

    tui.terminal.write = (data: string) => {
      operations.push(`write:${data}`);
      originalWrite(data);
    };
    tui.setShowHardwareCursor = (show: boolean) => {
      operations.push(`set:${show}`);
      originalSetShowHardwareCursor(show);
    };

    const editor = extension.editorFactory(tui, stubTheme, stubKeybindings);

    expect(editor instanceof ModalEditor).toBe(true);
    expect(tui.getShowHardwareCursorCalls).toBe(1);
    expect(tui.hardwareCursorValues).toEqual([true]);
    expect(tui.terminalWrites).toEqual([]);

    await extension.emitShutdown();

    expect(tui.terminalWrites).toEqual([RESET_CURSOR_SHAPE]);
    expect(tui.hardwareCursorValues).toEqual([true, false]);
    expect(operations).toEqual([
      "set:true",
      `write:${RESET_CURSOR_SHAPE}`,
      "set:false",
    ]);
  });

  it("resets shape without guessing a previous setting when no getter exists", async () => {
    const extension = await installExtensionWithEditorFactory();
    const tui = createCursorShapeTui({ getShowHardwareCursor: false });
    const operations: string[] = [];
    const originalWrite = tui.terminal.write;
    const originalSetShowHardwareCursor = tui.setShowHardwareCursor;

    expect(originalWrite).toBeTruthy();
    expect(originalSetShowHardwareCursor).toBeTruthy();

    tui.terminal.write = (data: string) => {
      operations.push(`write:${data}`);
      originalWrite(data);
    };
    tui.setShowHardwareCursor = (show: boolean) => {
      operations.push(`set:${show}`);
      originalSetShowHardwareCursor(show);
    };

    extension.editorFactory(tui, stubTheme, stubKeybindings);

    expect(tui.getShowHardwareCursorCalls).toBe(0);
    expect(tui.hardwareCursorValues).toEqual([true]);

    await extension.emitShutdown();

    expect(tui.terminalWrites).toEqual([RESET_CURSOR_SHAPE]);
    expect(tui.hardwareCursorValues).toEqual([true]);
    expect(operations).toEqual(["set:true", `write:${RESET_CURSOR_SHAPE}`]);
  });

  it("skips startup enablement and cleanup cursor writes on unsupported runtimes", async () => {
    const extension = await installExtensionWithEditorFactory();
    const tui = createCursorShapeTui({ setShowHardwareCursor: false });

    extension.editorFactory(tui, stubTheme, stubKeybindings);

    expect(tui.getShowHardwareCursorCalls).toBe(0);
    expect(tui.hardwareCursorValues).toEqual([]);

    await extension.emitShutdown();

    expect(tui.terminalWrites).toEqual([]);
    expect(tui.hardwareCursorValues).toEqual([]);
  });
});

describe("cursor shape rendering", () => {
  it("writes insert cursor shape and strips the EOL software cursor", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: true });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    focusEditor(editor);

    const lines = editor.render(20);
    const markerLine = findCursorMarkerLine(lines);

    expect(tui.terminalWrites).toEqual([INSERT_CURSOR_SHAPE]);
    expect(tui.terminalWrites.includes(RESET_CURSOR_SHAPE)).toBe(false);
    expect(markerLine.includes(CURSOR_MARKER)).toBe(true);
    expect(markerLine.includes(SOFTWARE_CURSOR_SPACE)).toBe(false);
    expect(visibleWidth(removeCursorMarker(markerLine))).toBe(20);
    assertNoCursorShapeSequences(lines);
  });

  it("preserves the character under the insert cursor", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: true });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    for (const char of "abc") {
      editor.handleInput(char);
    }
    focusEditor(editor);
    setInternalCursor(editor, 1);

    const lines = editor.render(20);
    const markerLine = findCursorMarkerLine(lines);
    const plainLine = removeCursorMarker(markerLine);

    expect(tui.terminalWrites).toEqual([INSERT_CURSOR_SHAPE]);
    expect(markerLine.includes("\x1b[7mb\x1b[0m")).toBe(false);
    expect(plainLine.startsWith("abc")).toBe(true);
    expect(visibleWidth(plainLine)).toBe(20);
    assertNoCursorShapeSequences(lines);
  });

  it("writes normal block cursor shape and strips the software cursor", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: true });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    sendKeys(editor, ["a", "b", "\x1b"]);
    focusEditor(editor);

    const lines = editor.render(20);
    const markerLine = findCursorMarkerLine(lines);

    expect(tui.terminalWrites).toEqual([BLOCK_CURSOR_SHAPE]);
    expect(markerLine.includes(SOFTWARE_CURSOR_SPACE)).toBe(false);
    assertNoCursorShapeSequences(lines);
  });

  it("writes EX block cursor shape and preserves EX label rendering", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: true });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    sendKeys(editor, ["\x1b", ":"]);
    focusEditor(editor);

    const lines = editor.render(20);
    const markerLine = findCursorMarkerLine(lines);
    const footer = lines.at(-1) ?? "";

    expect(tui.terminalWrites).toEqual([BLOCK_CURSOR_SHAPE]);
    expect(footer.includes(" EX :_ ")).toBeTruthy();
    expect(markerLine.includes(SOFTWARE_CURSOR_SPACE)).toBe(false);
    assertNoCursorShapeSequences(lines);
  });

  it("caches repeated renders and writes only changed cursor shapes", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: true });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    focusEditor(editor);

    editor.render(20);
    editor.render(20);
    editor.handleInput("\x1b");
    editor.render(20);
    editor.render(20);
    editor.handleInput("i");
    editor.render(20);

    expect(tui.terminalWrites).toEqual([
      INSERT_CURSOR_SHAPE,
      BLOCK_CURSOR_SHAPE,
      INSERT_CURSOR_SHAPE,
    ]);
  });

  it("falls back to the software cursor when hardware cursor APIs are unsupported", () => {
    const tui = createCursorShapeTui({ setShowHardwareCursor: false });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    focusEditor(editor);

    const lines = editor.render(20);
    const markerLine = findCursorMarkerLine(lines);

    expect(tui.terminalWrites).toEqual([]);
    expect(markerLine.includes(SOFTWARE_CURSOR_SPACE)).toBe(true);
    assertNoCursorShapeSequences(lines);
  });

  it("preserves the software cursor while supported hardware cursor display is disabled", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: false });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    focusEditor(editor);

    const disabledLines = editor.render(20);
    const disabledMarkerLine = findCursorMarkerLine(disabledLines);

    expect(tui.terminalWrites).toEqual([]);
    expect(tui.getShowHardwareCursorCalls).toBe(1);
    expect(disabledMarkerLine.includes(SOFTWARE_CURSOR_SPACE)).toBe(true);
    assertNoCursorShapeSequences(disabledLines);

    tui.setShowHardwareCursor?.(true);
    const enabledLines = editor.render(20);
    const enabledMarkerLine = findCursorMarkerLine(enabledLines);

    expect(tui.hardwareCursorValues).toEqual([true]);
    expect(tui.terminalWrites).toEqual([INSERT_CURSOR_SHAPE]);
    expect(tui.getShowHardwareCursorCalls).toBe(2);
    expect(enabledMarkerLine.includes(SOFTWARE_CURSOR_SPACE)).toBe(false);
    assertNoCursorShapeSequences(enabledLines);
  });

  it("keeps the software cursor when focused render has no cursor marker", () => {
    const tui = createCursorShapeTui({ initialShowHardwareCursor: true });
    const editor = new ModalEditor(tui, stubTheme, stubKeybindings);
    const internal = editor as unknown as { autocompleteState?: string | null };
    internal.autocompleteState = "regular";
    focusEditor(editor);

    const lines = editor.render(20);

    expect(lines.some((line) => line.includes(CURSOR_MARKER))).toBe(false);
    expect(lines.some((line) => line.includes(SOFTWARE_CURSOR_SPACE))).toBe(
      true,
    );
    expect(tui.terminalWrites).toEqual([]);
    assertNoCursorShapeSequences(lines);
  });
});

// ---------------------------------------------------------------------------
// Delete (d) operator — 6 motions
// ---------------------------------------------------------------------------

describe("delete operator — dw / de / db / d$ / d0 / dd", () => {
  it("dw deletes forward word (exclusive), updates register", () => {
    chk("hello world", ["d", "w"], "world", "hello ");
  });

  it("dw clipboard receives deleted text", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo bar");
    sendKeys(editor, ["d", "w"]);
    expect(clipboardWrites).toEqual(["foo "]);
  });

  it("dw swallows async clipboard failures", async () => {
    const { editor } = createEditorWithSpy("foo bar");
    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      rejections.push(reason);
    };

    editor.setClipboardFn(async () => {
      throw new Error("clipboard boom");
    });

    process.on("unhandledRejection", onUnhandledRejection);
    try {
      sendKeys(editor, ["d", "w"]);
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(editor.getText()).toBe("bar");
    expect(editor.getRegister()).toBe("foo ");
    expect(rejections).toEqual([]);
  });

  it("clipboard helper treats Pi copyToClipboard throws as best-effort", async () => {
    const helperSource = await getClipboardHelperSourceWithMock(
      [
        "export function copyToClipboard(text) {",
        '  process.stdout.write("copy:" + text);',
        '  throw new Error("clipboard backend failed");',
        "}",
      ].join("\n"),
    );

    const result = await runClipboardHelperSource(helperSource, "payload");

    expect(result.code).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.stdout).toBe("copy:payload");
  });

  it("clipboard read helper treats no text as an empty successful read", async () => {
    const helperSource = await getClipboardReadHelperSourceWithMock(
      [
        "{",
        "  async hasText() { return false; },",
        '  async getText() { throw new Error("No string found"); },',
        "}",
      ].join("\n"),
    );

    const result = await runClipboardHelperSource(helperSource, "");

    expect(result.code).toBe(0);
    expect(result.signal).toBe(null);
    expect(result.stdout).toBe("");
  });

  it("active clipboard write receives no abort event when superseded", async () => {
    const { editor } = createEditorWithSpy("foo bar baz");
    const activeWrite = deferred();
    const events: string[] = [];

    editor.setClipboardFn(async (text, signal) => {
      events.push(`start:${text}`);
      signal?.addEventListener(
        "abort",
        () => {
          events.push(`abort:${text}`);
        },
        { once: true },
      );

      if (text === "foo ") {
        await activeWrite.promise;
      }

      events.push(`end:${text}`);
    });

    sendKeys(editor, ["d", "w", "d", "w"]);

    try {
      await nextImmediate();

      expect(events).toEqual(["start:foo "]);
    } finally {
      activeWrite.resolve();
      await nextImmediate();
    }
  });

  it("three rapid clipboard writes keep first active and final pending text", async () => {
    const { editor } = createEditorWithSpy("foo bar baz qux");
    const firstWrite = deferred();
    const events: string[] = [];

    editor.setClipboardFn(async (text, signal) => {
      events.push(`start:${text}`);
      signal?.addEventListener(
        "abort",
        () => {
          events.push(`abort:${text}`);
        },
        { once: true },
      );

      if (text === "foo ") {
        await firstWrite.promise;
        if (signal?.aborted) {
          throw signal.reason ?? new Error("clipboard aborted");
        }
      }

      events.push(`end:${text}`);
    });

    sendKeys(editor, ["d", "w", "d", "w", "d", "w"]);
    firstWrite.resolve();
    await nextImmediate();

    expect(editor.getText()).toBe("qux");
    expect(editor.getRegister()).toBe("baz ");
    expect(events).toEqual([
      "start:foo ",
      "end:foo ",
      "start:baz ",
      "end:baz ",
    ]);
  });

  it("clipboard timeout abort still drains the latest pending text", async () => {
    const { editor } = createEditorWithSpy("foo bar baz qux");
    const finalWrite = deferred();
    const events: string[] = [];

    editor.setClipboardWriteTimeoutMs(5);
    editor.setClipboardFn(
      (text, signal) =>
        new Promise<void>((resolve, reject) => {
          events.push(`start:${text}`);
          signal?.addEventListener(
            "abort",
            () => {
              const reason =
                signal.reason instanceof Error
                  ? signal.reason.message
                  : String(signal.reason);
              events.push(`abort:${text}:${reason}`);
              reject(signal.reason ?? new Error("clipboard aborted"));
            },
            { once: true },
          );

          if (text === "foo ") {
            return;
          }

          events.push(`end:${text}`);
          if (text === "baz ") {
            finalWrite.resolve();
          }
          resolve();
        }),
    );

    sendKeys(editor, ["d", "w", "d", "w", "d", "w"]);
    await withTimeout(
      finalWrite.promise,
      100,
      "timed out waiting for clipboard drain to write latest pending text",
    );

    expect(editor.getText()).toBe("qux");
    expect(editor.getRegister()).toBe("baz ");
    expect(events).toEqual([
      "start:foo ",
      "abort:foo :clipboard write timed out",
      "start:baz ",
      "end:baz ",
    ]);
  });

  it("clipboard timeouts do not trip the spawn failure circuit breaker", async () => {
    const { editor } = createEditorWithSpy("one two three four five");
    const attempts: string[] = [];
    const expectedRegisters = ["one ", "two ", "three ", "four "];
    const aborts = new Map(expectedRegisters.map((text) => [text, deferred()]));

    editor.setClipboardWriteTimeoutMs(0);
    editor.setClipboardFn(
      (text, signal) =>
        new Promise<void>((_resolve, reject) => {
          attempts.push(text);
          const onAbort = () => {
            aborts.get(text)?.resolve();
            reject(createSpawnErrno("late spawn after timeout"));
          };

          if (signal?.aborted) {
            onAbort();
            return;
          }

          signal?.addEventListener("abort", onAbort, { once: true });
        }),
    );

    for (const expectedRegister of expectedRegisters) {
      sendKeys(editor, ["d", "w"]);
      const abort = aborts.get(expectedRegister);
      expect(abort).toBeTruthy();
      await withTimeout(
        abort!.promise,
        100,
        `timed out waiting for clipboard timeout abort for ${expectedRegister}`,
      );
      expect(editor.getRegister()).toBe(expectedRegister);
    }

    expect(editor.getText()).toBe("five");
    expect(attempts).toEqual(expectedRegisters);
  });

  it("repeated spawn-classified clipboard failures stop mirroring while register writes continue", async () => {
    const { editor } = createEditorWithSpy("one two three four five");
    const attempts: string[] = [];

    try {
      editor.setClipboardFn(async (text) => {
        attempts.push(text);
        throw createSpawnErrno("spawn failed");
      });

      for (const expectedRegister of ["one ", "two ", "three "]) {
        sendKeys(editor, ["d", "w"]);
        await nextImmediate();
        expect(editor.getRegister()).toBe(expectedRegister);
      }

      expect(attempts).toEqual(["one ", "two ", "three "]);

      sendKeys(editor, ["d", "w"]);
      await nextImmediate();

      expect(editor.getText()).toBe("five");
      expect(editor.getRegister()).toBe("four ");
      expect(attempts).toEqual(["one ", "two ", "three "]);
    } finally {
      editor.setClipboardFn(() => {});
    }
  });

  it("spawn-classified clipboard failures stop mirroring across editor instances", async () => {
    const first = createEditorWithSpy("one two three four five");
    const second = createEditorWithSpy("alpha beta");
    const attempts: string[] = [];
    const failSpawn = async (text: string) => {
      attempts.push(text);
      throw createSpawnErrno("spawn failed");
    };

    try {
      first.editor.setClipboardFn(failSpawn);
      second.editor.setClipboardFn(failSpawn);

      for (const expectedRegister of ["one ", "two ", "three "]) {
        sendKeys(first.editor, ["d", "w"]);
        await nextImmediate();
        expect(first.editor.getRegister()).toBe(expectedRegister);
      }

      expect(attempts).toEqual(["one ", "two ", "three "]);

      sendKeys(second.editor, ["d", "w"]);
      await nextImmediate();

      expect(second.editor.getText()).toBe("beta");
      expect(second.editor.getRegister()).toBe("alpha ");
      expect(attempts).toEqual(["one ", "two ", "three "]);
    } finally {
      first.editor.setClipboardFn(() => {});
    }
  });

  it("repeated generic clipboard failures do not trip the spawn failure circuit breaker", async () => {
    const { editor } = createEditorWithSpy("one two three four five");
    const attempts: string[] = [];

    editor.setClipboardFn(async (text) => {
      attempts.push(text);
      throw new Error("clipboard backend failed");
    });

    for (const expectedRegister of ["one ", "two ", "three ", "four "]) {
      sendKeys(editor, ["d", "w"]);
      await nextImmediate();
      expect(editor.getRegister()).toBe(expectedRegister);
    }

    expect(editor.getText()).toBe("five");
    expect(attempts).toEqual(["one ", "two ", "three ", "four "]);
  });

  it("de deletes to end of word (inclusive), updates register", () => {
    // "hello world" col 0: e→col 4 inclusive → delete "hello", leave " world"
    chk("hello world", ["d", "e"], " world", "hello");
  });

  it("de inclusive equal-column: single-char word", () => {
    // "a" col 0: e→col 0 inclusive → delete "a", leave ""
    chk("a", ["d", "e"], "", "a");
  });

  it("de inclusive equal-column: last char of multi-char word", () => {
    // "abc" col 2 (press l l): e→col 2 inclusive → delete "c", leave "ab"
    chk("abc", ["l", "l", "d", "e"], "ab", "c");
  });

  it("db deletes backward word (exclusive)", () => {
    // navigate w to col 4 ('b' of "bar"), then db → delete "foo "
    chk("foo bar", ["w", "d", "b"], "bar", "foo ");
  });

  it("d$ deletes to end of line (exclusive of EOL)", () => {
    chk("hello world", ["d", "$"], "", "hello world");
  });

  it("d0 deletes back to start of line (exclusive of col 0)", () => {
    // navigate w to col 4, then d0 → delete "foo " (cols 0–3)
    chk("foo bar", ["w", "d", "0"], "bar", "foo ");
  });

  it("dd deletes linewise and writes newline-terminated register", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["d", "d"]);
    expect(editor.getRegister()).toBe("hello\n");
    expect(editor.getText()).toBe("");
  });
});

describe("delete operator — WORD motions (dW / dE / dB)", () => {
  it("dW deletes to next WORD start", () => {
    chk("foo-bar   baz", ["d", "W"], "baz", "foo-bar   ");
  });

  it("dE deletes to end of current WORD (inclusive)", () => {
    chk("foo-bar   baz", ["d", "E"], "   baz", "foo-bar");
  });

  it("dB deletes backward by WORD", () => {
    chk("foo-bar baz", ["W", "d", "B"], "baz", "foo-bar ");
  });
});

// ---------------------------------------------------------------------------
// Linewise operators, counts, and whole-buffer flows
// ---------------------------------------------------------------------------

describe("linewise operators and counts", () => {
  it("d2j deletes current line plus two below", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");

    sendKeys(editor, ["d", "2", "j"]);

    expect(editor.getText()).toBe("d");
    expect(editor.getRegister()).toBe("a\nb\nc\n");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("y2j yanks current line plus two below without mutation", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");
    const before = editor.getText();

    sendKeys(editor, ["y", "2", "j"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("a\nb\nc\n");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("3dd deletes three lines", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");

    sendKeys(editor, ["3", "d", "d"]);

    expect(editor.getText()).toBe("d");
    expect(editor.getRegister()).toBe("a\nb\nc\n");
  });

  it("2yy yanks two lines", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");
    const before = editor.getText();

    sendKeys(editor, ["j", "2", "y", "y"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("b\nc\n");
  });

  it("d999j clamps deletion at EOF", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");

    sendKeys(editor, ["d", "9", "9", "9", "j"]);

    expect(editor.getText()).toBe("");
    expect(editor.getRegister()).toBe("a\nb\nc\n");
  });

  it("y999k clamps yank at BOF", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");
    const before = editor.getText();

    sendKeys(editor, ["G", "y", "9", "9", "9", "k"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("a\nb\nc\n");
  });

  it("ggdG deletes the whole buffer", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");

    sendKeys(editor, ["g", "g", "d", "G"]);

    expect(editor.getText()).toBe("");
    expect(editor.getRegister()).toBe("a\nb\nc\n");
  });

  it("ggyG yanks the whole buffer without mutation", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");
    const before = editor.getText();

    sendKeys(editor, ["g", "g", "y", "G"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("a\nb\nc\n");
  });

  it("dG from middle line deletes to EOF linewise", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");

    sendKeys(editor, ["j", "d", "G"]);

    expect(editor.getText()).toBe("a");
    expect(editor.getRegister()).toBe("b\nc\nd\n");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("invalid continuation after counted delete cancels cleanly", () => {
    const { editor } = createMultiLineEditor("foo bar\nbaz");

    sendKeys(editor, ["d", "2", "z", "w", "x"]);

    expect(editor.getText()).toBe("foo ar\nbaz");
    expect(editor.getRegister()).toBe("b");
  });

  it("counted delete motion d2w deletes two words", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["d", "2", "w"]);

    expect(editor.getText()).toBe("baz");
    expect(editor.getRegister()).toBe("foo bar ");
  });

  it("counted delete motion d2W deletes two WORDs", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz qux");

    sendKeys(editor, ["d", "2", "W"]);

    expect(editor.getText()).toBe("qux");
    expect(editor.getRegister()).toBe("foo-bar   baz ");
  });

  it("counted prefix 2dW deletes two WORDs", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz qux");

    sendKeys(editor, ["2", "d", "W"]);

    expect(editor.getText()).toBe("qux");
    expect(editor.getRegister()).toBe("foo-bar   baz ");
  });

  it("counted change motion c2E works for WORD semantics", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz qux");

    sendKeys(editor, ["c", "2", "E"]);

    expect(editor.getText()).toBe(" qux");
    expect(editor.getRegister()).toBe("foo-bar   baz");
    expect(editor.getMode()).toBe("insert");
  });

  it("counted change motion c2B works for WORD semantics", () => {
    const { editor } = createEditorWithSpy("one two three");

    sendKeys(editor, ["W", "W", "c", "2", "B"]);

    expect(editor.getText()).toBe("three");
    expect(editor.getRegister()).toBe("one two ");
    expect(editor.getMode()).toBe("insert");
  });

  it("counted prefix 2cB changes backward across two WORDs", () => {
    const { editor } = createEditorWithSpy("one two three");

    sendKeys(editor, ["W", "W", "2", "c", "B"]);

    expect(editor.getText()).toBe("three");
    expect(editor.getRegister()).toBe("one two ");
    expect(editor.getMode()).toBe("insert");
  });

  it("counted unsupported yank motion y2w cancels instead of yanking", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["y", "2", "w"]);

    expect(editor.getText()).toBe("foo bar");
    expect(editor.getRegister()).toBe("");
  });

  it("counted unsupported yank motion y2W cancels instead of yanking", () => {
    const { editor } = createEditorWithSpy("foo-bar baz");

    sendKeys(editor, ["y", "2", "W"]);

    expect(editor.getText()).toBe("foo-bar baz");
    expect(editor.getRegister()).toBe("");
  });

  it("counted unsupported yank motion y2E cancels and does not stay sticky", () => {
    const { editor } = createEditorWithSpy("foo-bar baz");

    sendKeys(editor, ["y", "2", "E", "x"]);

    expect(editor.getText()).toBe("oo-bar baz");
    expect(editor.getRegister()).toBe("f");
  });

  it("counted yank text objects cancel without mutation or register writes", () => {
    const scenarios = [
      { name: "y2aw", keys: ["y", "2", "a", "w"] },
      { name: "2yaw", keys: ["2", "y", "a", "w"] },
      { name: "y2aW", keys: ["y", "2", "a", "W"] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy("foo bar");
      const beforeCursor = editor.getCursor();
      editor.setRegister("seed");

      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe("foo bar");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
    }
  });

  it("normal keys work after counted yank text-object cancellation", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["y", "2", "a", "w", "x"]);

    expect(editor.getText()).toBe("oo bar");
    expect(editor.getRegister()).toBe("f");
  });

  it("2d0 does not swallow 0 as a second count", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["2", "d", "0", "x"]);

    expect(editor.getText()).toBe("oo bar");
    expect(editor.getRegister()).toBe("f");
  });
});

describe("Universal Counts State & Bounds", () => {
  it("2d3j multiplies prefix and operator counts", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd\ne\nf\ng\nh");

    sendKeys(editor, ["2", "d", "3", "j"]);

    expect(editor.getText()).toBe("g\nh");
  });

  it("99999x is bounded and deletes only available text", () => {
    const { editor } = createEditorWithSpy("abc");

    sendKeys(editor, ["9", "9", "9", "9", "9", "x"]);

    expect(editor.getText()).toBe("");
  });

  it("2d3<Esc>x clears pending count/operator state", () => {
    const { editor } = createEditorWithSpy("abc");

    sendKeys(editor, ["2", "d", "3", "\x1b", "x"]);

    expect(editor.getText()).toBe("bc");
  });

  it("bracketed paste in normal mode clears state and keeps x working", () => {
    const { editor } = createEditorWithSpy("abc");

    sendKeys(editor, ["2", "d", "\x1b[200~paste\x1b[201~", "x"]);

    expect(editor.getText()).toBe("bc");
  });
});

describe("buffer motions — gg / G", () => {
  it("gg from the last line reaches line 0", () => {
    const editor = createEditorAtBufferEnd("alpha\nbeta\ngamma");

    sendKeys(editor, ["g", "g"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("G from the first line reaches the last line", () => {
    const { editor } = createMultiLineEditor("alpha\nbeta\ngamma");

    sendKeys(editor, ["G"]);

    expect(editor.getCursor()).toEqual({ line: 2, col: 0 });
  });

  it("G moves to last line at column 0", () => {
    const { editor } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["G", "x"]);

    expect(editor.getText()).toBe("foo\nar");
    expect(editor.getRegister()).toBe("b");
  });

  it("gg moves to first line at column 0", () => {
    const { editor } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["G", "g", "g", "x"]);

    expect(editor.getText()).toBe("oo\nbar");
    expect(editor.getRegister()).toBe("f");
  });

  it("gg reaches line 0 across wrapped logical lines", () => {
    const wrappedLine = "x".repeat(200);
    const editor = createEditorAtBufferEnd(`top\n${wrappedLine}\nbottom`);

    sendKeys(editor, ["g", "g"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("{count}gg moves to target line (1-indexed)", () => {
    const { editor } = createMultiLineEditor("aa\nbb\ncc\ndd");

    sendKeys(editor, ["G", "2", "g", "g", "x"]);

    expect(editor.getText()).toBe("aa\nb\ncc\ndd");
    expect(editor.getRegister()).toBe("b");
  });

  it("3gg moves to line 2 (0-indexed)", () => {
    const editor = createEditorAtBufferEnd("aa\nbb\ncc\ndd");

    sendKeys(editor, ["3", "g", "g"]);

    expect(editor.getCursor()).toEqual({ line: 2, col: 0 });
  });

  it("{count}G moves to target line (1-indexed)", () => {
    const { editor } = createMultiLineEditor("aa\nbb\ncc\ndd");

    sendKeys(editor, ["3", "G", "x"]);

    expect(editor.getText()).toBe("aa\nbb\nc\ndd");
    expect(editor.getRegister()).toBe("c");
  });
});

describe("first non-whitespace motion — ^", () => {
  it("^ moves to the first non-whitespace character", () => {
    const { editor } = createEditorWithSpy("    foo");

    sendKeys(editor, ["$", "^", "x"]);

    expect(editor.getText()).toBe("    oo");
    expect(editor.getRegister()).toBe("f");
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });

  it("prefixed ^ clears count state before later commands", () => {
    const { editor } = createEditorWithSpy("    foo bar");

    sendKeys(editor, ["3", "^", "x"]);

    expect(editor.getText()).toBe("    oo bar");
    expect(editor.getRegister()).toBe("f");
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });

  it("d^ deletes back to the first non-whitespace character", () => {
    chk("    foo bar", ["w", "w", "d", "^"], "    bar", "foo ");
  });

  it("c^ changes back to the first non-whitespace character", () => {
    const { editor } = createEditorWithSpy("    foo bar");

    sendKeys(editor, ["w", "w", "c", "^"]);

    expect(editor.getText()).toBe("    bar");
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getMode()).toBe("insert");
  });

  it("y^ yanks back to the first non-whitespace character", () => {
    const { editor } = createEditorWithSpy("    foo bar");
    const before = editor.getText();

    sendKeys(editor, ["w", "w", "y", "^"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getCursor()).toEqual({ line: 0, col: 8 });
  });
});

describe("paragraph motions — { / }", () => {
  const paragraphFixture =
    "alpha one\nalpha two\n\n   \nbeta one\nbeta two\n\ngamma one\n\n   ";

  it("} moves to next paragraph start at column 0", () => {
    const { editor } = createMultiLineEditor(paragraphFixture);

    sendKeys(editor, ["}"]);

    expect(editor.getCursor()).toEqual({ line: 4, col: 0 });
  });

  it("{ moves to previous paragraph start at column 0", () => {
    const { editor } = createMultiLineEditor(paragraphFixture);

    sendKeys(editor, ["}", "{"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("paragraph motions from blank-line runs jump to surrounding paragraph starts", () => {
    const { editor } = createMultiLineEditor(paragraphFixture);

    sendKeys(editor, ["j", "j", "}"]);
    expect(editor.getCursor()).toEqual({ line: 4, col: 0 });

    sendKeys(editor, ["j", "j", "{"]);
    expect(editor.getCursor()).toEqual({ line: 4, col: 0 });
  });

  it("supports counted paragraph motions 2} and 2{", () => {
    const { editor } = createMultiLineEditor(paragraphFixture);

    sendKeys(editor, ["2", "}"]);
    expect(editor.getCursor()).toEqual({ line: 7, col: 0 });

    sendKeys(editor, ["2", "{"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("paragraph motions clamp at BOF/EOF", () => {
    const { editor } = createMultiLineEditor(paragraphFixture);

    sendKeys(editor, ["{"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });

    sendKeys(editor, ["G", "}"]);
    expect(editor.getCursor()).toEqual({ line: 9, col: 0 });
  });

  it("paragraph motions keep register/clipboard unchanged", () => {
    const { editor, clipboardWrites } = createMultiLineEditor(paragraphFixture);
    const before = editor.getText();
    editor.setRegister("untouched");

    sendKeys(editor, ["}", "{", "2", "}", "2", "{"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("untouched");
    expect(clipboardWrites).toEqual([]);
  });

  it("paragraph integration keeps representative w/b/e behavior", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["w"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });

    sendKeys(editor, ["e"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 6 });

    sendKeys(editor, ["b"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });
});

describe("matching pair motion", () => {
  it("% on opening delimiter jumps to closing partner", () => {
    const { editor } = createEditorWithSpy("foo(bar)");

    sendKeys(editor, ["w", "%"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 7 });
  });

  it("% on closing delimiter jumps to opening partner", () => {
    const { editor } = createEditorWithSpy("foo(bar)");
    setInternalCursor(editor, 7);

    sendKeys(editor, ["%"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("% before a delimiter scans forward and jumps to the partner", () => {
    const { editor } = createEditorWithSpy("foo (bar)");

    sendKeys(editor, ["%"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 8 });
  });

  it("% with no source delimiter on the current line no-ops", () => {
    const { editor } = createMultiLineEditor("foo bar\n(baz)");

    sendKeys(editor, ["%"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("% with an unmatched source delimiter no-ops", () => {
    const { editor } = createEditorWithSpy("foo(bar");
    setInternalCursor(editor, 3);

    sendKeys(editor, ["%"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("% at visible EOL after a closing delimiter jumps to opening partner", () => {
    const { editor } = createEditorWithSpy("foo(bar)");
    setInternalCursor(editor, 8);

    sendKeys(editor, ["%"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("{count}% consumes count without affecting the next key", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["3", "%", "x"]);

    expect(editor.getText()).toBe("bcdef");
    expect(editor.getRegister()).toBe("a");
  });

  it("no-op % preserves buffer text and unnamed register", () => {
    const { editor } = createEditorWithSpy("foo bar");
    editor.setRegister("seed");

    sendKeys(editor, ["%"]);

    expect(editor.getText()).toBe("foo bar");
    expect(editor.getRegister()).toBe("seed");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("matching pair operator motion d% deletes forward inclusive range", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo(bar)baz");
    setInternalCursor(editor, 3);

    sendKeys(editor, ["d", "%"]);

    expect(editor.getText()).toBe("foobaz");
    expect(editor.getRegister()).toBe("(bar)");
    expect(clipboardWrites).toEqual(["(bar)"]);
  });

  it("matching pair operator motion d% deletes backward inclusive range", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo(bar)baz");
    setInternalCursor(editor, 7);

    sendKeys(editor, ["d", "%"]);

    expect(editor.getText()).toBe("foobaz");
    expect(editor.getRegister()).toBe("(bar)");
    expect(clipboardWrites).toEqual(["(bar)"]);
  });

  it("matching pair operator motion d% scan-forward anchors at original cursor", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("xx foo(bar) zz");
    setInternalCursor(editor, 3);

    sendKeys(editor, ["d", "%"]);

    expect(editor.getText()).toBe("xx  zz");
    expect(editor.getRegister()).toBe("foo(bar)");
    expect(clipboardWrites).toEqual(["foo(bar)"]);
  });

  it("matching pair operator motion y% yanks forward without mutation", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo(bar)baz");
    setInternalCursor(editor, 3);

    sendKeys(editor, ["y", "%"]);

    expect(editor.getText()).toBe("foo(bar)baz");
    expect(editor.getRegister()).toBe("(bar)");
    expect(clipboardWrites).toEqual(["(bar)"]);
  });

  it("matching pair operator motion y% yanks backward without mutation", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo(bar)baz");
    setInternalCursor(editor, 7);

    sendKeys(editor, ["y", "%"]);

    expect(editor.getText()).toBe("foo(bar)baz");
    expect(editor.getRegister()).toBe("(bar)");
    expect(clipboardWrites).toEqual(["(bar)"]);
  });

  it("matching pair operator motion c% deletes range and enters insert mode", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("foo(bar)baz");
    setInternalCursor(editor, 3);

    sendKeys(editor, ["c", "%"]);

    expect(editor.getText()).toBe("foobaz");
    expect(editor.getRegister()).toBe("(bar)");
    expect(editor.getMode()).toBe("insert");
    expect(clipboardWrites).toEqual(["(bar)"]);
  });

  it("matching pair operator motion follows clipboard mirror yank policy", () => {
    const deletion = createEditorWithSpy("foo(bar)baz");
    deletion.editor.setClipboardMirrorPolicy("yank");
    setInternalCursor(deletion.editor, 3);

    sendKeys(deletion.editor, ["d", "%"]);

    expect(deletion.editor.getRegister()).toBe("(bar)");
    expect(deletion.clipboardWrites).toEqual([]);

    const yank = createEditorWithSpy("foo(bar)baz");
    yank.editor.setClipboardMirrorPolicy("yank");
    setInternalCursor(yank.editor, 3);

    sendKeys(yank.editor, ["y", "%"]);

    expect(yank.editor.getRegister()).toBe("(bar)");
    expect(yank.clipboardWrites).toEqual(["(bar)"]);

    const change = createEditorWithSpy("foo(bar)baz");
    change.editor.setClipboardMirrorPolicy("yank");
    setInternalCursor(change.editor, 3);

    sendKeys(change.editor, ["c", "%"]);

    expect(change.editor.getRegister()).toBe("(bar)");
    expect(change.clipboardWrites).toEqual([]);
  });

  it("matching pair operator motion no-target cancellation preserves text and register", () => {
    for (const operator of ["d", "y", "c"] as const) {
      const { editor, clipboardWrites } = createEditorWithSpy("foo(bar");
      editor.setRegister("seed");
      setInternalCursor(editor, 3);

      sendKeys(editor, [operator, "%"]);

      expect(editor.getText()).toBe("foo(bar");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getMode()).toBe("normal");
      expect(clipboardWrites).toEqual([]);

      sendKeys(editor, ["x"]);

      expect(editor.getText()).toBe("foobar");
      expect(editor.getRegister()).toBe("(");
      expect(clipboardWrites).toEqual(["("]);
    }
  });

  it("matching pair operator motion counted forms cancel and clear stale state", () => {
    const cases = [
      ["d", "2", "%"],
      ["2", "d", "%"],
      ["y", "2", "%"],
      ["2", "y", "%"],
      ["c", "2", "%"],
      ["2", "c", "%"],
    ];

    for (const keys of cases) {
      const { editor, clipboardWrites } = createEditorWithSpy("foo(bar)");
      editor.setRegister("seed");

      sendKeys(editor, keys);

      expect(editor.getText()).toBe("foo(bar)");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getMode()).toBe("normal");
      expect(clipboardWrites).toEqual([]);

      sendKeys(editor, ["x"]);

      expect(editor.getText()).toBe("oo(bar)");
      expect(editor.getRegister()).toBe("f");
      expect(clipboardWrites).toEqual(["f"]);
    }
  });

  it("matching pair operator motion d% at visible EOL avoids the following newline", () => {
    const { editor, clipboardWrites } = createMultiLineEditor("foo(bar)\nnext");
    setInternalCursor(editor, 8);

    sendKeys(editor, ["d", "%"]);

    expect(editor.getText()).toBe("foo\nnext");
    expect(editor.getRegister()).toBe("(bar)");
    expect(clipboardWrites).toEqual(["(bar)"]);
  });
});

describe("J — join lines", () => {
  it("J joins current line with next, inserts separator space", () => {
    const { editor } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["J"]);

    expect(editor.getText()).toBe("foo bar");
  });

  it("J on last line is a no-op", () => {
    const { editor } = createEditorWithSpy("only line");

    sendKeys(editor, ["J"]);

    expect(editor.getText()).toBe("only line");
  });

  it("J preserves left trailing whitespace, no double space", () => {
    const { editor } = createMultiLineEditor("foo  \nbar");

    sendKeys(editor, ["J"]);

    expect(editor.getText()).toBe("foo  bar");
  });

  it("J trims right leading whitespace", () => {
    const { editor } = createMultiLineEditor("foo\n  bar");

    sendKeys(editor, ["J"]);

    expect(editor.getText()).toBe("foo bar");
  });

  it("J with empty right line: no trailing space", () => {
    const { editor } = createMultiLineEditor("foo\n");

    sendKeys(editor, ["J"]);

    expect(editor.getText()).toBe("foo");
  });

  it("J cursor lands at join point (space position)", () => {
    const { editor } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["J"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("J cursor at join point when left has trailing space (no separator inserted)", () => {
    const { editor } = createMultiLineEditor("foo \nbar");

    sendKeys(editor, ["J"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });

  it("J does not write unnamed register", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    editor.setRegister("untouched");

    sendKeys(editor, ["J"]);

    expect(editor.getRegister()).toBe("untouched");
  });

  it("J does not write clipboard", () => {
    const { editor, clipboardWrites } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["J"]);

    expect(clipboardWrites).toEqual([]);
  });

  it("J keeps the cursor at the join point after a non-ascii grapheme", () => {
    const { editor } = createMultiLineEditor("中\nx");

    sendKeys(editor, ["J"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });
});

describe("gJ — raw join lines", () => {
  it("gJ joins without whitespace normalization", () => {
    const { editor } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["g", "J"]);

    expect(editor.getText()).toBe("foobar");
  });

  it("gJ preserves right leading whitespace", () => {
    const { editor } = createMultiLineEditor("foo\n  bar");

    sendKeys(editor, ["g", "J"]);

    expect(editor.getText()).toBe("foo  bar");
  });

  it("gJ on last line is a no-op", () => {
    const { editor } = createEditorWithSpy("only line");

    sendKeys(editor, ["g", "J"]);

    expect(editor.getText()).toBe("only line");
  });

  it("gJ cursor lands at former newline boundary", () => {
    const { editor } = createMultiLineEditor("foo\nbar");

    sendKeys(editor, ["g", "J"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("gJ does not write unnamed register", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    editor.setRegister("untouched");

    sendKeys(editor, ["g", "J"]);

    expect(editor.getRegister()).toBe("untouched");
  });
});

describe("counted J/gJ", () => {
  it("3J joins three lines (2 steps)", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");

    sendKeys(editor, ["3", "J"]);

    expect(editor.getText()).toBe("a b c\nd");
  });

  it("3gJ joins three lines without normalization", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");

    sendKeys(editor, ["3", "g", "J"]);

    expect(editor.getText()).toBe("abc\nd");
  });

  it("count exceeding EOF clamps to available lines", () => {
    const { editor } = createMultiLineEditor("a\nb");

    sendKeys(editor, ["9", "J"]);

    expect(editor.getText()).toBe("a b");
  });

  it("1J is a no-op (0 steps per spec formula)", () => {
    const { editor } = createMultiLineEditor("a\nb");

    sendKeys(editor, ["1", "J"]);

    expect(editor.getText()).toBe("a\nb");
  });

  it("3J cursor at LAST join point", () => {
    const { editor } = createMultiLineEditor("aa\nbb\ncc");

    sendKeys(editor, ["3", "J"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("{count}gJ works: 2gJ joins two lines", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");

    sendKeys(editor, ["2", "g", "J"]);

    expect(editor.getText()).toBe("ab\nc");
  });
});

describe("gJ parse safety", () => {
  it("g{count}J is a no-op (fail-closed)", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");

    sendKeys(editor, ["g", "3", "J"]);

    expect(editor.getText()).toBe("a\nb\nc");
  });

  it("g{count}J does not write register", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");
    editor.setRegister("untouched");

    sendKeys(editor, ["g", "3", "J"]);

    expect(editor.getRegister()).toBe("untouched");
  });
});

// ---------------------------------------------------------------------------
// Change (c) operator — 6 motions, always enters insert mode
// ---------------------------------------------------------------------------

describe("change operator — cw / ce / cb / c$ / c0 / cc", () => {
  it("cw: text mutated, register written, insert mode", () => {
    const { editor } = createEditorWithSpy("hello world");
    sendKeys(editor, ["c", "w"]);
    expect(editor.getRegister()).toBe("hello ");
    expect(editor.getText()).toBe("world");
    expect(editor.getMode()).toBe("insert");
  });

  it("ce: inclusive delete, insert mode", () => {
    const { editor } = createEditorWithSpy("hello world");
    sendKeys(editor, ["c", "e"]);
    expect(editor.getRegister()).toBe("hello");
    expect(editor.getText()).toBe(" world");
    expect(editor.getMode()).toBe("insert");
  });

  it("cb from mid-word: backward delete, insert mode", () => {
    const { editor } = createEditorWithSpy("foo bar");
    sendKeys(editor, ["w", "c", "b"]); // navigate to "bar", cb
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getText()).toBe("bar");
    expect(editor.getMode()).toBe("insert");
  });

  it("c$: deletes to EOL, insert mode", () => {
    chkMode("hello world", ["c", "$"], "insert");
    chk("hello world", ["c", "$"], "", "hello world");
  });

  it("c0 from mid-line: deletes back to start, insert mode", () => {
    const { editor } = createEditorWithSpy("foo bar");
    sendKeys(editor, ["w", "c", "0"]);
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getText()).toBe("bar");
    expect(editor.getMode()).toBe("insert");
  });

  it("cc: clears line, insert mode", () => {
    const { editor } = createEditorWithSpy("hello world");
    sendKeys(editor, ["c", "c"]);
    expect(editor.getRegister()).toBe("hello world");
    expect(editor.getText()).toBe("");
    expect(editor.getMode()).toBe("insert");
  });
});

describe("change operator — WORD motions (cW / cE / cB)", () => {
  it("cW on non-whitespace matches cE (Vim parity)", () => {
    const { editor } = createEditorWithSpy("foo   bar");

    sendKeys(editor, ["c", "W"]);

    expect(editor.getText()).toBe("   bar");
    expect(editor.getRegister()).toBe("foo");
    expect(editor.getMode()).toBe("insert");
  });

  it("cW from whitespace deletes only whitespace run", () => {
    const { editor } = createEditorWithSpy("foo   bar");

    sendKeys(editor, ["l", "l", "l", "c", "W"]);

    expect(editor.getText()).toBe("foobar");
    expect(editor.getRegister()).toBe("   ");
    expect(editor.getMode()).toBe("insert");
  });

  it("cE deletes to end of WORD inclusively", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz");

    sendKeys(editor, ["c", "E"]);

    expect(editor.getText()).toBe("   baz");
    expect(editor.getRegister()).toBe("foo-bar");
    expect(editor.getMode()).toBe("insert");
  });

  it("cB deletes backward by WORD", () => {
    const { editor } = createEditorWithSpy("foo-bar baz");

    sendKeys(editor, ["W", "c", "B"]);

    expect(editor.getText()).toBe("baz");
    expect(editor.getRegister()).toBe("foo-bar ");
    expect(editor.getMode()).toBe("insert");
  });
});

// ---------------------------------------------------------------------------
// Word text objects — iw / aw with d/c/y
// ---------------------------------------------------------------------------

describe("word text objects — iw / aw", () => {
  it("ciw deletes inner word and enters insert mode", () => {
    const { editor } = createEditorWithSpy("foo bar");
    sendKeys(editor, ["c", "i", "w"]);
    expect(editor.getRegister()).toBe("foo");
    expect(editor.getText()).toBe(" bar");
    expect(editor.getMode()).toBe("insert");
  });

  it("caw deletes word plus trailing space and enters insert mode", () => {
    const { editor } = createEditorWithSpy("foo bar");
    sendKeys(editor, ["c", "a", "w"]);
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getText()).toBe("bar");
    expect(editor.getMode()).toBe("insert");
  });

  it("diw deletes inner word", () => {
    chk("foo bar", ["d", "i", "w"], " bar", "foo");
  });

  it("d2iw deletes two inner words", () => {
    chk("foo bar baz", ["d", "2", "i", "w"], " baz", "foo bar");
  });

  it("daw deletes word + trailing spaces", () => {
    chk("foo bar", ["d", "a", "w"], "bar", "foo ");
  });

  it("daw from the final word includes leading whitespace", () => {
    const { editor } = createEditorWithSpy("foo bar");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["d", "a", "w"]);

    expect(editor.getText()).toBe("foo");
    expect(editor.getRegister()).toBe(" bar");
  });

  it("diw from whitespace chooses the next word", () => {
    const { editor } = createEditorWithSpy("foo   bar");

    setInternalCursor(editor, 3);
    sendKeys(editor, ["d", "i", "w"]);

    expect(editor.getText()).toBe("foo   ");
    expect(editor.getRegister()).toBe("bar");
  });

  it("yiw yanks inner word without mutation", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();
    sendKeys(editor, ["y", "i", "w"]);
    expect(editor.getRegister()).toBe("foo");
    expect(editor.getText()).toBe(before);
  });

  it("yaw yanks word + trailing spaces without mutation", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();
    sendKeys(editor, ["y", "a", "w"]);
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getText()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// WORD text objects — iW / aW with d/c/y
// ---------------------------------------------------------------------------

describe("WORD text objects — iW / aW", () => {
  it("ciW changes a punctuation-containing WORD and enters insert mode", () => {
    const { editor } = createEditorWithSpy("foo path/to-file bar");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["c", "i", "W"]);

    expect(editor.getRegister()).toBe("path/to-file");
    expect(editor.getText()).toBe("foo  bar");
    expect(editor.getMode()).toBe("insert");
  });

  it("diW deletes a flag WORD without surrounding whitespace", () => {
    const { editor } = createEditorWithSpy("foo --flag=value bar");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["d", "i", "W"]);

    expect(editor.getRegister()).toBe("--flag=value");
    expect(editor.getText()).toBe("foo  bar");
  });

  it("yiW yanks a WORD without mutation", () => {
    const { editor } = createEditorWithSpy("foo path/to-file bar");
    const before = editor.getText();

    setInternalCursor(editor, 4);
    sendKeys(editor, ["y", "i", "W"]);

    expect(editor.getRegister()).toBe("path/to-file");
    expect(editor.getText()).toBe(before);
  });

  it("daW includes trailing whitespace when present", () => {
    const { editor } = createEditorWithSpy("foo path/to-file bar");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["d", "a", "W"]);

    expect(editor.getRegister()).toBe("path/to-file ");
    expect(editor.getText()).toBe("foo bar");
  });

  it("daW includes leading whitespace when no trailing whitespace exists", () => {
    const { editor } = createEditorWithSpy("foo path/to-file");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["d", "a", "W"]);

    expect(editor.getRegister()).toBe(" path/to-file");
    expect(editor.getText()).toBe("foo");
  });

  it("d2iW and d2aW count WORDs using word-object whitespace policy", () => {
    const { editor: inner } = createEditorWithSpy(
      "foo path/to-file --flag=value bar",
    );
    const { editor: around } = createEditorWithSpy(
      "foo path/to-file --flag=value bar",
    );

    setInternalCursor(inner, 4);
    sendKeys(inner, ["d", "2", "i", "W"]);

    expect(inner.getRegister()).toBe("path/to-file --flag=value");
    expect(inner.getText()).toBe("foo  bar");

    setInternalCursor(around, 4);
    sendKeys(around, ["d", "2", "a", "W"]);

    expect(around.getRegister()).toBe("path/to-file --flag=value ");
    expect(around.getText()).toBe("foo bar");
  });

  it("chooses next WORD from whitespace or previous WORD when there is no next WORD", () => {
    const { editor: next } = createEditorWithSpy("foo   path/to-file");
    const { editor: previous } = createEditorWithSpy("foo/path   ");

    setInternalCursor(next, 3);
    sendKeys(next, ["d", "i", "W"]);

    expect(next.getRegister()).toBe("path/to-file");
    expect(next.getText()).toBe("foo   ");

    setInternalCursor(previous, 8);
    sendKeys(previous, ["d", "i", "W"]);

    expect(previous.getRegister()).toBe("foo/path");
    expect(previous.getText()).toBe("   ");
  });

  it("does not cross logical lines", () => {
    const { editor } = createMultiLineEditor("foo/path\nbar/baz");

    sendKeys(editor, ["d", "2", "i", "W"]);

    expect(editor.getRegister()).toBe("foo/path");
    expect(editor.getText()).toBe("\nbar/baz");
  });
});

// ---------------------------------------------------------------------------
// Quote text objects — i\" / a\" / i' / a' / i` / a` with d/c/y
// ---------------------------------------------------------------------------

describe("quote text objects", () => {
  it("supports double-quote text objects on the current quoted string", () => {
    const scenarios = [
      {
        name: 'ci"',
        keys: ["c", "i", '"'],
        expectedText: 'say "" now',
        expectedRegister: "hello",
        expectedMode: "insert",
        expectedCursor: { line: 0, col: 5 },
      },
      {
        name: 'di"',
        keys: ["d", "i", '"'],
        expectedText: 'say "" now',
        expectedRegister: "hello",
        expectedMode: "normal",
        expectedCursor: { line: 0, col: 5 },
      },
      {
        name: 'yi"',
        keys: ["y", "i", '"'],
        expectedText: 'say "hello" now',
        expectedRegister: "hello",
        expectedMode: "normal",
        expectedCursor: { line: 0, col: 6 },
      },
      {
        name: 'ca"',
        keys: ["c", "a", '"'],
        expectedText: "say  now",
        expectedRegister: '"hello"',
        expectedMode: "insert",
        expectedCursor: { line: 0, col: 4 },
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy('say "hello" now');
      setInternalCursor(editor, 6);

      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.expectedText);
      expect(editor.getRegister()).toBe(scenario.expectedRegister);
      expect(editor.getMode()).toBe(scenario.expectedMode);
      expect(editor.getCursor()).toEqual(scenario.expectedCursor);
    }
  });

  it("supports single quotes and backticks", () => {
    const scenarios = [
      {
        name: "single quotes",
        initial: "say 'hello' now",
        keys: ["d", "i", "'"],
        expectedText: "say '' now",
      },
      {
        name: "backticks",
        initial: "say `hello` now",
        keys: ["y", "i", "`"],
        expectedText: "say `hello` now",
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);
      setInternalCursor(editor, 6);

      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.expectedText);
      expect(editor.getRegister()).toBe("hello");
    }
  });

  it("ignores escaped quote delimiters", () => {
    const initial = String.raw`say \"not\" "yes" now`;
    const { editor } = createEditorWithSpy(initial);

    setInternalCursor(editor, 14);
    sendKeys(editor, ["d", "i", '"']);

    expect(editor.getText()).toBe(String.raw`say \"not\" "" now`);
    expect(editor.getRegister()).toBe("yes");
  });

  it("does not pair quotes across logical lines", () => {
    const initial = 'say "hello\nworld" now';
    const { editor } = createMultiLineEditor(initial);
    const beforeCursor = { line: 0, col: 5 };
    editor.setRegister("seed");

    setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
    sendKeys(editor, ["d", "i", '"']);

    expect(editor.getText()).toBe(initial);
    expect(editor.getRegister()).toBe("seed");
    expect(editor.getCursor()).toEqual(beforeCursor);
  });

  it("empty inner quotes no-op for delete and yank", () => {
    const scenarios = [
      { name: "delete", keys: ["d", "i", '"'] },
      { name: "yank", keys: ["y", "i", '"'] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy('say "" now');
      const beforeCursor = { line: 0, col: 4 };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe('say "" now');
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });

  it("empty inner quote change enters insert at the inner start", () => {
    const { editor } = createEditorWithSpy('say "" now');
    editor.setRegister("seed");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["c", "i", '"']);

    expect(editor.getText()).toBe('say "" now');
    expect(editor.getRegister()).toBe("seed");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("counted quote text objects cancel without mutation or register writes", () => {
    const { editor } = createEditorWithSpy('say "hello" now');
    const beforeCursor = { line: 0, col: 6 };
    editor.setRegister("seed");

    setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
    sendKeys(editor, ["d", "2", "i", '"']);

    expect(editor.getText()).toBe('say "hello" now');
    expect(editor.getRegister()).toBe("seed");
    expect(editor.getCursor()).toEqual(beforeCursor);
    expect(editor.getMode()).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// Bracket text objects — i( / a( / i[ / a[ / i{ / a{ aliases
// ---------------------------------------------------------------------------

describe("bracket text objects", () => {
  it("supports representative change, delete, and yank bracket text objects", () => {
    const scenarios = [
      {
        name: "ci(",
        initial: "call(foo) now",
        cursorCol: 6,
        keys: ["c", "i", "("],
        expectedText: "call() now",
        expectedRegister: "foo",
        expectedMode: "insert",
        expectedCursor: { line: 0, col: 5 },
      },
      {
        name: "da(",
        initial: "call(foo) now",
        cursorCol: 6,
        keys: ["d", "a", "("],
        expectedText: "call now",
        expectedRegister: "(foo)",
        expectedMode: "normal",
        expectedCursor: { line: 0, col: 4 },
      },
      {
        name: "yi[",
        initial: "arr[foo] now",
        cursorCol: 5,
        keys: ["y", "i", "["],
        expectedText: "arr[foo] now",
        expectedRegister: "foo",
        expectedMode: "normal",
        expectedCursor: { line: 0, col: 5 },
      },
      {
        name: "ya{",
        initial: "obj {foo} now",
        cursorCol: 7,
        keys: ["y", "a", "{"],
        expectedText: "obj {foo} now",
        expectedRegister: "{foo}",
        expectedMode: "normal",
        expectedCursor: { line: 0, col: 7 },
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);

      setInternalCursor(editor, scenario.cursorCol);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.expectedText);
      expect(editor.getRegister()).toBe(scenario.expectedRegister);
      expect(editor.getMode()).toBe(scenario.expectedMode);
      expect(editor.getCursor()).toEqual(scenario.expectedCursor);
    }
  });

  it("supports closing delimiter aliases and b/B aliases", () => {
    const scenarios = [
      {
        name: ") alias",
        initial: "call(foo)",
        cursorCol: 6,
        keys: ["d", "i", ")"],
        expectedText: "call()",
      },
      {
        name: "b alias",
        initial: "call(foo)",
        cursorCol: 6,
        keys: ["d", "i", "b"],
        expectedText: "call()",
      },
      {
        name: "] alias",
        initial: "arr[foo]",
        cursorCol: 5,
        keys: ["d", "i", "]"],
        expectedText: "arr[]",
      },
      {
        name: "} alias",
        initial: "obj{foo}",
        cursorCol: 5,
        keys: ["d", "i", "}"],
        expectedText: "obj{}",
      },
      {
        name: "B alias",
        initial: "obj{foo}",
        cursorCol: 5,
        keys: ["d", "i", "B"],
        expectedText: "obj{}",
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);

      setInternalCursor(editor, scenario.cursorCol);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.expectedText);
      expect(editor.getRegister()).toBe("foo");
    }
  });

  it("uses the smallest nested parenthesis pair", () => {
    const { editor } = createEditorWithSpy("a(b(c)d)e");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["d", "i", "("]);

    expect(editor.getText()).toBe("a(b()d)e");
    expect(editor.getRegister()).toBe("c");
  });

  it("yanks cross-line brace ranges", () => {
    const initial = "fn {\n  x\n}\nend";
    const { editor } = createMultiLineEditor(initial);

    setInternalCursor(editor, 2, 1);
    sendKeys(editor, ["y", "a", "{"]);

    expect(editor.getText()).toBe(initial);
    expect(editor.getRegister()).toBe("{\n  x\n}");
    expect(editor.getCursor()).toEqual({ line: 1, col: 2 });
  });

  it("counts the cursor on either delimiter as inside", () => {
    const scenarios = [
      { name: "opening delimiter", cursorCol: 4 },
      { name: "closing delimiter", cursorCol: 8 },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy("call(foo)");

      setInternalCursor(editor, scenario.cursorCol);
      sendKeys(editor, ["d", "i", "("]);

      expect(editor.getText()).toBe("call()");
      expect(editor.getRegister()).toBe("foo");
    }
  });

  it("empty inner brackets no-op for delete and yank", () => {
    const scenarios = [
      { name: "delete", keys: ["d", "i", "("] },
      { name: "yank", keys: ["y", "i", "("] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy("call() now");
      const beforeCursor = { line: 0, col: 4 };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe("call() now");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });

  it("empty inner bracket change enters insert at the inner start", () => {
    const { editor } = createEditorWithSpy("call() now");
    editor.setRegister("seed");

    setInternalCursor(editor, 4);
    sendKeys(editor, ["c", "i", "("]);

    expect(editor.getText()).toBe("call() now");
    expect(editor.getRegister()).toBe("seed");
    expect(editor.getMode()).toBe("insert");
    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("counted bracket text objects cancel without mutation or register writes", () => {
    const scenarios = [
      {
        name: "2ci(",
        initial: "call(foo)",
        cursorCol: 6,
        keys: ["2", "c", "i", "("],
      },
      {
        name: "y2a{",
        initial: "obj{foo}",
        cursorCol: 5,
        keys: ["y", "2", "a", "{"],
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);
      const beforeCursor = { line: 0, col: scenario.cursorCol };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.initial);
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });
});

describe("delimited text objects at end of line", () => {
  it("resolves bracket objects from $ on a non-final line", () => {
    const { editor } = createMultiLineEditor("call(foo)\nbar");

    sendKeys(editor, ["$", "d", "i", "("]);

    expect(editor.getText()).toBe("call()\nbar");
    expect(editor.getRegister()).toBe("foo");
    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("resolves quote objects from $ on a non-final line", () => {
    const { editor } = createMultiLineEditor('say "hi"\nnext');

    sendKeys(editor, ["$", "d", "i", '"']);

    expect(editor.getText()).toBe('say ""\nnext');
    expect(editor.getRegister()).toBe("hi");
    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("resolves delimiter objects from $ on the final non-empty line", () => {
    const scenarios = [
      {
        name: "bracket",
        initial: "before\ncall(foo)",
        cursorLine: 1,
        keys: ["$", "d", "i", "("],
        expectedText: "before\ncall()",
        expectedRegister: "foo",
        expectedCursor: { line: 1, col: 5 },
      },
      {
        name: "quote",
        initial: 'before\nsay "hi"',
        cursorLine: 1,
        keys: ["$", "d", "i", '"'],
        expectedText: 'before\nsay ""',
        expectedRegister: "hi",
        expectedCursor: { line: 1, col: 5 },
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createMultiLineEditor(scenario.initial);

      setInternalCursor(editor, 0, scenario.cursorLine);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.expectedText);
      expect(editor.getRegister()).toBe(scenario.expectedRegister);
      expect(editor.getCursor()).toEqual(scenario.expectedCursor);
    }
  });

  it("cancels delimiter objects from a final empty trailing-newline line", () => {
    const scenarios = [
      { name: "bracket", keys: ["d", "i", "("] },
      { name: "quote", keys: ["c", "i", '"'] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createMultiLineEditor("call(foo)\n");
      const beforeCursor = { line: 1, col: 0 };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe("call(foo)\n");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });

  it("cancels delimiter objects in an empty buffer", () => {
    const scenarios = [
      { name: "delete quote", keys: ["d", "i", '"'] },
      { name: "change bracket", keys: ["c", "i", "("] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy("");
      const beforeCursor = { line: 0, col: 0 };
      editor.setRegister("seed");

      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe("");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });
});

describe("text object cancellation hardening", () => {
  it("unsupported object keys after di, ci, and yi cancel before the next normal key", () => {
    const scenarios = [
      { name: "diq", keys: ["d", "i", "q"] },
      { name: "ciq", keys: ["c", "i", "q"] },
      { name: "yiq", keys: ["y", "i", "q"] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy("foo bar");
      const beforeCursor = editor.getCursor();
      editor.setRegister("seed");

      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe("foo bar");
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");

      sendKeys(editor, ["x"]);

      expect(editor.getText()).toBe("oo bar");
      expect(editor.getRegister()).toBe("f");
    }
  });

  it("unmatched delimiters cancel without mutation or register writes", () => {
    const scenarios = [
      {
        name: 'di"',
        initial: 'say "hello',
        cursorCol: 5,
        keys: ["d", "i", '"'],
      },
      {
        name: "ci(",
        initial: "call(foo",
        cursorCol: 6,
        keys: ["c", "i", "("],
      },
      {
        name: "yi{",
        initial: "obj {foo",
        cursorCol: 6,
        keys: ["y", "i", "{"],
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);
      const beforeCursor = { line: 0, col: scenario.cursorCol };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.initial);
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });

  it("unmatched delimiter cancellation is not sticky", () => {
    const initial = 'say "hello';
    const { editor } = createEditorWithSpy(initial);
    const beforeCursor = { line: 0, col: 5 };
    editor.setRegister("seed");

    setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
    sendKeys(editor, ["d", "i", '"']);

    expect(editor.getText()).toBe(initial);
    expect(editor.getRegister()).toBe("seed");
    expect(editor.getCursor()).toEqual(beforeCursor);

    sendKeys(editor, ["x"]);

    expect(editor.getText()).toBe('say "ello');
    expect(editor.getRegister()).toBe("h");
  });

  it("counted delimited examples cancel without mutation or register writes", () => {
    const scenarios = [
      {
        name: 'd2i"',
        initial: 'say "hello" now',
        cursorCol: 6,
        keys: ["d", "2", "i", '"'],
      },
      {
        name: "2ci(",
        initial: "call(foo)",
        cursorCol: 6,
        keys: ["2", "c", "i", "("],
      },
      {
        name: "y2a{",
        initial: "obj {foo}",
        cursorCol: 6,
        keys: ["y", "2", "a", "{"],
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);
      const beforeCursor = { line: 0, col: scenario.cursorCol };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.initial);
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });

  it("counted yank word and WORD text objects remain unsupported", () => {
    const scenarios = [
      {
        name: "y2iw",
        initial: "foo bar",
        cursorCol: 0,
        keys: ["y", "2", "i", "w"],
      },
      {
        name: "2yiW",
        initial: "foo path/to-file bar",
        cursorCol: 4,
        keys: ["2", "y", "i", "W"],
      },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);
      const beforeCursor = { line: 0, col: scenario.cursorCol };
      editor.setRegister("seed");

      setInternalCursor(editor, beforeCursor.col, beforeCursor.line);
      sendKeys(editor, scenario.keys);

      expect(editor.getText()).toBe(scenario.initial);
      expect(editor.getRegister()).toBe("seed");
      expect(editor.getCursor()).toEqual(beforeCursor);
      expect(editor.getMode()).toBe("normal");
    }
  });
});

// ---------------------------------------------------------------------------
// Single-key edit commands — x / s / S / D / C
// ---------------------------------------------------------------------------

describe("single-key edits — x / s / S / D / C", () => {
  it("x: deletes char under cursor, normal mode", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["x"]);
    expect(editor.getRegister()).toBe("h");
    expect(editor.getText()).toBe("ello");
    expect(editor.getMode()).toBe("normal");
  });

  it("x: register written correctly", () => {
    const { editor, clipboardWrites } = createEditorWithSpy("hello");
    sendKeys(editor, ["x"]);
    expect(clipboardWrites).toEqual(["h"]);
  });

  it("s: deletes char under cursor, enters insert mode", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["s"]);
    expect(editor.getRegister()).toBe("h");
    expect(editor.getText()).toBe("ello");
    expect(editor.getMode()).toBe("insert");
  });

  it("S: clears line content, enters insert mode", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["S"]);
    expect(editor.getRegister()).toBe("hello");
    expect(editor.getText()).toBe("");
    expect(editor.getMode()).toBe("insert");
  });

  it("D: deletes from cursor to end of line", () => {
    chk("hello world", ["D"], "", "hello world");
  });

  it("D from mid-line: deletes only tail", () => {
    // navigate to col 5 (' '), D should delete " world"
    const { editor } = createEditorWithSpy("hello world");
    sendKeys(editor, ["w", "D"]); // w moves to "world" (col 6), D deletes from there
    expect(editor.getRegister()).toBe("world");
    expect(editor.getText()).toBe("hello ");
  });

  it("C: deletes to EOL, enters insert mode", () => {
    const { editor } = createEditorWithSpy("hello world");
    sendKeys(editor, ["C"]);
    expect(editor.getRegister()).toBe("hello world");
    expect(editor.getText()).toBe("");
    expect(editor.getMode()).toBe("insert");
  });
});

describe("Universal Counts: Edits and Put", () => {
  it("3x deletes three chars under cursor", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["3", "x"]);

    expect(editor.getText()).toBe("def");
    expect(editor.getRegister()).toBe("abc");
  });

  it("2x near EOL deletes only available chars", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["l", "l", "l", "l", "2", "x"]);

    expect(editor.getText()).toBe("abcd");
    expect(editor.getRegister()).toBe("ef");
  });

  it("3p pastes register text three times after cursor", () => {
    const { editor } = createEditorWithSpy("X");
    editor.setRegister("ab");

    sendKeys(editor, ["3", "p"]);

    expect(editor.getText()).toBe("Xababab");
  });

  it("3P pastes register text three times before cursor", () => {
    const { editor } = createEditorWithSpy("X");
    editor.setRegister("ab");

    sendKeys(editor, ["3", "P"]);

    expect(editor.getText()).toBe("abababX");
  });

  it("2s deletes two chars and enters insert mode", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["2", "s"]);

    expect(editor.getText()).toBe("cdef");
    expect(editor.getRegister()).toBe("ab");
    expect(editor.getMode()).toBe("insert");
  });

  it("2S clears line once and enters insert mode", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["2", "S"]);

    expect(editor.getText()).toBe("");
    expect(editor.getRegister()).toBe("abcdef");
    expect(editor.getMode()).toBe("insert");
  });

  it("2D deletes to EOL once", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["2", "D"]);

    expect(editor.getText()).toBe("");
    expect(editor.getRegister()).toBe("abcdef");
  });

  it("2C deletes to EOL and enters insert mode", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["2", "C"]);

    expect(editor.getText()).toBe("");
    expect(editor.getRegister()).toBe("abcdef");
    expect(editor.getMode()).toBe("insert");
  });
});

describe("Universal Counts: Char Motions", () => {
  it("3fx moves to the third forward match", () => {
    const { editor } = createEditorWithSpy("axbxcxd");

    sendKeys(editor, ["3", "f", "x"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });

  it("3Fx moves to the third backward match", () => {
    const { editor } = createEditorWithSpy("dxcxbxa");

    sendKeys(editor, ["$", "3", "F", "x"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });

  it("3tx moves to one before the third forward match", () => {
    const { editor } = createEditorWithSpy("axbxcxd");

    sendKeys(editor, ["3", "t", "x"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });

  it("d2tx deletes through the char before the second forward match", () => {
    const { editor } = createEditorWithSpy("axbxcxd");

    sendKeys(editor, ["d", "2", "t", "x"]);

    expect(editor.getText()).toBe("xcxd");
    expect(editor.getRegister()).toBe("axb");
  });

  it("3TX moves backward one before the third backward match", () => {
    const { editor } = createEditorWithSpy("dxcxbxa");

    sendKeys(editor, ["$", "3", "T", "x"]);

    // 3rd x from right is at col 1, T stops one after = col 2
    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("2; repeats the last char-find motion twice", () => {
    const { editor } = createEditorWithSpy("axbxcxd");

    sendKeys(editor, ["f", "x", "2", ";"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 5 });
  });
});

describe("Universal Counts: Word Motions", () => {
  it("3w moves to the start of qux (3 word-forward steps)", () => {
    const { editor } = createEditorWithSpy("foo bar baz qux");

    sendKeys(editor, ["3", "w"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 12 });
  });

  it("2b from baz moves to the start of foo", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["w", "w", "2", "b"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("2e from start lands at end of bar", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["2", "e"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 6 });
  });

  it("WORD standalone motions W/B/E use whitespace-delimited semantics", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz");

    sendKeys(editor, ["W"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 10 });

    sendKeys(editor, ["B"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });

    sendKeys(editor, ["E"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 6 });
  });

  it("2W moves by WORD tokens (counted standalone)", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz qux");

    sendKeys(editor, ["2", "W"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 14 });
  });

  it("3B from EOL walks backward across WORD tokens", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz qux");

    sendKeys(editor, ["$", "3", "B"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("2E lands on end of second WORD token", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz qux");

    sendKeys(editor, ["2", "E"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 12 });
  });

  it("lowercase w keeps word-class behavior next to punctuation", () => {
    const { editor: lowercase } = createEditorWithSpy("foo-bar baz");
    const { editor: uppercase } = createEditorWithSpy("foo-bar baz");

    sendKeys(lowercase, ["w"]);
    sendKeys(uppercase, ["W"]);

    expect(lowercase.getCursor()).toEqual({ line: 0, col: 3 });
    expect(uppercase.getCursor()).toEqual({ line: 0, col: 8 });
  });

  it("d2w deletes foo bar and leaves baz", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["d", "2", "w"]);

    expect(editor.getText()).toBe("baz");
  });

  it("d2aw deletes two words from bar and leaves foo", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["w", "d", "2", "a", "w"]);

    expect(editor.getText()).toBe("foo");
  });

  it("maintains differential parity with count > 1 (3w matches three sequential w)", () => {
    const { editor: e1 } = createEditorWithSpy("foo bar baz qux");
    const { editor: e2 } = createEditorWithSpy("foo bar baz qux");

    sendKeys(e1, ["3", "w"]);
    sendKeys(e2, ["w", "w", "w"]);

    expect(e1.getCursor()).toEqual(e2.getCursor());
  });

  it("w skips correctly after a non-ascii grapheme", () => {
    const { editor } = createEditorWithSpy("中 x");

    sendKeys(editor, ["l", "w"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("w skips correctly after an emoji grapheme", () => {
    const { editor } = createEditorWithSpy("😀 x");

    sendKeys(editor, ["l", "w"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });
});

describe("Universal Counts: Change and Nav", () => {
  it("c2w deletes two words and enters insert mode", () => {
    const { editor } = createEditorWithSpy("foo bar baz");

    sendKeys(editor, ["c", "2", "w"]);

    expect(editor.getText()).toBe("baz");
    expect(editor.getMode()).toBe("insert");
  });

  it("3j moves cursor down three lines", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd\ne");

    sendKeys(editor, ["3", "j"]);

    expect(editor.getCursor()).toEqual({ line: 3, col: 0 });
  });

  it("3l moves cursor right by three columns", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["3", "l"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("3h moves cursor left by three columns", () => {
    const { editor } = createEditorWithSpy("abcdef");

    sendKeys(editor, ["$", "h", "3", "h"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });

  it("3k moves cursor up three lines", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd\ne");

    sendKeys(editor, ["G", "3", "k"]);

    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });
  });

  it("j moves by logical lines across wrapped content", () => {
    const wrappedLine = "x".repeat(200);
    const { editor } = createMultiLineEditor(`top\n${wrappedLine}\nbottom`);

    sendKeys(editor, ["j", "j"]);

    expect(editor.getCursor()).toEqual({ line: 2, col: 0 });
  });
});

// ---------------------------------------------------------------------------
// EOL / newline edge cases  (Task 7)
// ---------------------------------------------------------------------------

describe("EOL and newline semantics", () => {
  it("D at last char cuts to end of line without joining", () => {
    const { editor, clipboardWrites } = createMultiLineEditor("line1\nline2");
    // $ lands on the last char (col 4 for "line1"); D cuts from there to EOL
    sendKeys(editor, ["$", "D"]);
    expect(editor.getRegister()).toBe("1");
    expect(clipboardWrites).toEqual(["1"]);
    // only the last char is removed; the newline stays
    expect(editor.getText()).toBe("line\nline2");
  });

  it("d$ at last char matches D behavior", () => {
    const { editor, clipboardWrites } = createMultiLineEditor("line1\nline2");
    sendKeys(editor, ["$", "d", "$"]);

    expect(editor.getRegister()).toBe("1");
    expect(clipboardWrites).toEqual(["1"]);
    expect(editor.getText()).toBe("line\nline2");
  });

  it("D at last char on final line cuts the trailing char", () => {
    const { editor } = createEditorWithSpy("hello");
    // $ lands on 'o' (col 4); D cuts from there to EOL
    sendKeys(editor, ["$", "D"]);
    expect(editor.getRegister()).toBe("o");
    expect(editor.getText()).toBe("hell");
  });

  it("x at last char deletes only that char, does not join next line", () => {
    const { editor } = createMultiLineEditor("line1\nline2");
    sendKeys(editor, ["$", "x"]); // $ lands on '1' (col 4); x deletes it
    expect(editor.getText()).toBe("line\nline2"); // only '1' gone, newline intact
    expect(editor.getRegister()).toBe("1");
  });

  it("x on last char of line deletes only that char, does not join lines", () => {
    const { editor } = createMultiLineEditor("line1\nline2");
    // "e" motion: end of word in "line1" → col 4 ('1')
    sendKeys(editor, ["e", "x"]);
    expect(editor.getRegister()).toBe("1");
    expect(editor.getText()).toBe("line\nline2"); // only '1' gone, newline intact
  });
});

// ---------------------------------------------------------------------------
// Word motion path selection (line-local fast path vs canonical fallback)
// ---------------------------------------------------------------------------

describe("word motion path selection", () => {
  it("line-local w avoids canonical absolute scanner", () => {
    const { editor } = createEditorWithSpy("alpha beta");

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    sendKeys(editor, ["w"]);
    expect(calls).toBe(0);
  });

  it("line-local e avoids canonical absolute scanner", () => {
    const { editor } = createEditorWithSpy("alpha beta");

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    sendKeys(editor, ["e"]);
    expect(calls).toBe(0);
  });

  it("line-local b avoids canonical absolute scanner", () => {
    const { editor } = createEditorWithSpy("alpha beta");
    sendKeys(editor, ["w"]);

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    sendKeys(editor, ["b"]);
    expect(calls).toBe(0);
  });

  it("line-local W/E/B thread WORD semantic class through cache lookup", () => {
    const scenarios: Array<{ motion: string; setup?: string[] }> = [
      { motion: "W" },
      { motion: "E" },
      { motion: "B", setup: ["W"] },
    ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy("foo-bar baz");
      const raw = getRawEditor(editor);
      const original = raw.wordBoundaryCache.tryFindTarget.bind(
        raw.wordBoundaryCache,
      );
      let seenSemanticClass: string | null = null;

      raw.wordBoundaryCache.tryFindTarget = (...args: TryFindTargetArgs) => {
        seenSemanticClass = String(args[4] ?? "");
        return original(...args);
      };

      if (scenario.setup) {
        sendKeys(editor, scenario.setup);
      }
      sendKeys(editor, [scenario.motion]);
      expect(seenSemanticClass).toBe("WORD");
    }
  });

  it("cache uncertainty falls back to canonical absolute scanner", () => {
    const { editor } = createEditorWithSpy("alpha beta");

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    raw.wordBoundaryCache.tryFindTarget = () => null;

    sendKeys(editor, ["w"]);
    expect(calls > 0).toBeTruthy();
  });

  it("w at EOL falls back to canonical absolute scanner", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$"]);

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    sendKeys(editor, ["w"]);
    expect(calls > 0).toBeTruthy();
  });

  it("e at EOL falls back to canonical absolute scanner", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$"]);

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    sendKeys(editor, ["e"]);
    expect(calls > 0).toBeTruthy();
  });

  it("b from BOL falls back to canonical absolute scanner", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["j", "0"]);

    const raw = getRawEditor(editor);
    const original = raw.findWordTargetInText.bind(raw);
    let calls = 0;

    raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
      calls++;
      return original(...args);
    };

    sendKeys(editor, ["b"]);
    expect(calls > 0).toBeTruthy();
  });

  it("W/E at EOL and B at BOL fall back to canonical absolute scanner", () => {
    const scenarios: Array<{
      name: string;
      initial: string;
      setup: string[];
      motion: string;
    }> = [
      { name: "W@EOL", initial: "foo\nbar", setup: ["$"], motion: "W" },
      { name: "E@EOL", initial: "foo\nbar", setup: ["$"], motion: "E" },
      { name: "B@BOL", initial: "foo\nbar", setup: ["j", "0"], motion: "B" },
    ];

    for (const scenario of scenarios) {
      const { editor } = createMultiLineEditor(scenario.initial);
      const raw = getRawEditor(editor);
      const original = raw.findWordTargetInText.bind(raw);
      let calls = 0;

      raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
        calls++;
        return original(...args);
      };

      sendKeys(editor, [...scenario.setup, scenario.motion]);
      expect(calls > 0).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Operator word-motion path selection
// ---------------------------------------------------------------------------

describe("operator word-motion path selection", () => {
  it("line-local d/c/y + w/e/b avoid canonical absolute scanner", () => {
    const scenarios: Array<{ name: string; initial: string; keys: string[] }> =
      [
        { name: "dw", initial: "alpha beta", keys: ["d", "w"] },
        { name: "de", initial: "alpha beta", keys: ["d", "e"] },
        { name: "db", initial: "alpha beta", keys: ["w", "d", "b"] },
        { name: "cw", initial: "alpha beta", keys: ["c", "w"] },
        { name: "ce", initial: "alpha beta", keys: ["c", "e"] },
        { name: "cb", initial: "alpha beta", keys: ["w", "c", "b"] },
        { name: "yw", initial: "alpha beta", keys: ["y", "w"] },
        { name: "ye", initial: "alpha beta", keys: ["y", "e"] },
        { name: "yb", initial: "alpha beta", keys: ["w", "y", "b"] },
        { name: "dW", initial: "alpha-beta gamma", keys: ["d", "W"] },
        { name: "dE", initial: "alpha-beta gamma", keys: ["d", "E"] },
        { name: "dB", initial: "alpha-beta gamma", keys: ["W", "d", "B"] },
        { name: "cW", initial: "alpha-beta gamma", keys: ["c", "W"] },
        { name: "cE", initial: "alpha-beta gamma", keys: ["c", "E"] },
        { name: "cB", initial: "alpha-beta gamma", keys: ["W", "c", "B"] },
        { name: "yW", initial: "alpha-beta gamma", keys: ["y", "W"] },
        { name: "yE", initial: "alpha-beta gamma", keys: ["y", "E"] },
        { name: "yB", initial: "alpha-beta gamma", keys: ["W", "y", "B"] },
      ];

    for (const scenario of scenarios) {
      const { editor } = createEditorWithSpy(scenario.initial);
      const raw = getRawEditor(editor);
      const original = raw.findWordTargetInText.bind(raw);
      let calls = 0;

      raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
        calls++;
        return original(...args);
      };

      sendKeys(editor, scenario.keys);
      expect(calls).toBe(0);
    }
  });

  it("cross-line operator word motions fall back to canonical scanner", () => {
    const scenarios: Array<{ name: string; initial: string; keys: string[] }> =
      [
        { name: "dw@EOL", initial: "foo\nbar", keys: ["$", "d", "w"] },
        { name: "cw@EOL", initial: "foo\nbar", keys: ["$", "c", "w"] },
        { name: "yw@EOL", initial: "foo\nbar", keys: ["$", "y", "w"] },
        { name: "db@BOL", initial: "foo\nbar", keys: ["j", "0", "d", "b"] },
        { name: "cb@BOL", initial: "foo\nbar", keys: ["j", "0", "c", "b"] },
        { name: "yb@BOL", initial: "foo\nbar", keys: ["j", "0", "y", "b"] },
        { name: "dW@EOL", initial: "foo\nbar", keys: ["$", "d", "W"] },
        { name: "yW@EOL", initial: "foo\nbar", keys: ["$", "y", "W"] },
        { name: "dB@BOL", initial: "foo\nbar", keys: ["j", "0", "d", "B"] },
        { name: "cB@BOL", initial: "foo\nbar", keys: ["j", "0", "c", "B"] },
        { name: "yB@BOL", initial: "foo\nbar", keys: ["j", "0", "y", "B"] },
      ];

    for (const scenario of scenarios) {
      const { editor } = createMultiLineEditor(scenario.initial);
      const raw = getRawEditor(editor);
      const original = raw.findWordTargetInText.bind(raw);
      let calls = 0;

      raw.findWordTargetInText = (...args: FindWordTargetInTextArgs) => {
        calls++;
        return original(...args);
      };

      sendKeys(editor, scenario.keys);
      expect(calls > 0).toBeTruthy();
    }
  });
});

describe("word-motion fast path differential", () => {
  const assertFastEqualsCanonical = (
    initial: string,
    keys: string[],
    _label: string,
  ): void => {
    const fast = runScenario(initial, keys, "fast");
    const canonical = runScenario(initial, keys, "canonical");
    expect(fast).toEqual(canonical);
  };

  it("matches canonical behavior on generated line fixtures", () => {
    const fixtures = makeGeneratedLineFixtures(80);
    const scenarios: Array<{ name: string; keys: string[] }> = [
      { name: "w+x", keys: ["w", "x"] },
      { name: "e+x", keys: ["e", "x"] },
      { name: "w,b,x", keys: ["w", "b", "x"] },
      { name: "dw", keys: ["d", "w"] },
      { name: "de", keys: ["d", "e"] },
      { name: "w,db", keys: ["w", "d", "b"] },
      { name: "cw", keys: ["c", "w"] },
      { name: "ce", keys: ["c", "e"] },
      { name: "w,cb", keys: ["w", "c", "b"] },
      { name: "yw", keys: ["y", "w"] },
      { name: "ye", keys: ["y", "e"] },
      { name: "w,yb", keys: ["w", "y", "b"] },
      { name: "W+x", keys: ["W", "x"] },
      { name: "E+x", keys: ["E", "x"] },
      { name: "W,B,x", keys: ["W", "B", "x"] },
      { name: "2W+x", keys: ["2", "W", "x"] },
      { name: "2E+x", keys: ["2", "E", "x"] },
      { name: "dW", keys: ["d", "W"] },
      { name: "dE", keys: ["d", "E"] },
      { name: "W,dB", keys: ["W", "d", "B"] },
      { name: "d2W", keys: ["d", "2", "W"] },
      { name: "2dW", keys: ["2", "d", "W"] },
      { name: "cW", keys: ["c", "W"] },
      { name: "cE", keys: ["c", "E"] },
      { name: "W,cB", keys: ["W", "c", "B"] },
      { name: "c2E", keys: ["c", "2", "E"] },
      { name: "yW", keys: ["y", "W"] },
      { name: "yE", keys: ["y", "E"] },
      { name: "W,yB", keys: ["W", "y", "B"] },
      { name: "y2W(cancel)", keys: ["y", "2", "W", "x"] },
    ];

    for (const line of fixtures) {
      for (const scenario of scenarios) {
        assertFastEqualsCanonical(
          line,
          scenario.keys,
          `line=${JSON.stringify(line)} scenario=${scenario.name}`,
        );
      }
    }
  });

  it("matches canonical behavior on cross-line uppercase WORD scenarios", () => {
    const scenarios: Array<{ name: string; initial: string; keys: string[] }> =
      [
        { name: "W@EOL", initial: "foo\nbar", keys: ["$", "W", "x"] },
        { name: "2W@EOL", initial: "foo\nbar baz", keys: ["$", "2", "W", "x"] },
        { name: "E@EOL", initial: "foo\nbar", keys: ["$", "E", "x"] },
        { name: "2E@EOL", initial: "foo\nbar baz", keys: ["$", "2", "E", "x"] },
        { name: "B@BOL", initial: "foo\nbar", keys: ["j", "0", "B", "x"] },
        {
          name: "2B@BOL",
          initial: "foo bar\nbaz",
          keys: ["j", "0", "2", "B", "x"],
        },
        { name: "dW@EOL", initial: "foo\nbar", keys: ["$", "d", "W"] },
        {
          name: "cW@EOL",
          initial: "foo\nbar",
          keys: ["$", "c", "W", "X", "\x1b"],
        },
        { name: "yW@EOL", initial: "foo\nbar", keys: ["$", "y", "W", "p"] },
        { name: "dE@EOL", initial: "foo\nbar", keys: ["$", "d", "E"] },
        {
          name: "cE@EOL",
          initial: "foo\nbar",
          keys: ["$", "c", "E", "X", "\x1b"],
        },
        { name: "yE@EOL", initial: "foo\nbar", keys: ["$", "y", "E", "p"] },
        { name: "dB@BOL", initial: "foo\nbar", keys: ["j", "0", "d", "B"] },
        {
          name: "cB@BOL",
          initial: "foo\nbar",
          keys: ["j", "0", "c", "B", "X", "\x1b"],
        },
        {
          name: "yB@BOL",
          initial: "foo\nbar",
          keys: ["j", "0", "y", "B", "p"],
        },
      ];

    for (const scenario of scenarios) {
      assertFastEqualsCanonical(scenario.initial, scenario.keys, scenario.name);
    }
  });
});

describe("word-motion guard boundary regressions", () => {
  const assertFastEqualsCanonical = (
    initial: string,
    keys: string[],
    _label: string,
  ): void => {
    const fast = runScenario(initial, keys, "fast");
    const canonical = runScenario(initial, keys, "canonical");
    expect(fast).toEqual(canonical);
  };

  it("matches canonical behavior at EOL/BOL + punctuation/whitespace/empty boundaries", () => {
    const cases: Array<{ label: string; initial: string; keys: string[] }> = [
      {
        label: "EOL cross-line dw",
        initial: "foo\nbar",
        keys: ["$", "d", "w"],
      },
      {
        label: "BOL cross-line yb",
        initial: "foo\nbar",
        keys: ["j", "0", "y", "b"],
      },
      {
        label: "EOL cross-line dW",
        initial: "foo\nbar",
        keys: ["$", "d", "W"],
      },
      {
        label: "EOL cross-line yE",
        initial: "foo\nbar",
        keys: ["$", "y", "E", "p"],
      },
      {
        label: "BOL cross-line cB",
        initial: "foo\nbar",
        keys: ["j", "0", "c", "B", "X", "\x1b"],
      },
      {
        label: "punctuation run (word)",
        initial: "foo---bar",
        keys: ["w", "x"],
      },
      {
        label: "punctuation run (WORD)",
        initial: "foo---bar",
        keys: ["W", "x"],
      },
      {
        label: "whitespace run (word)",
        initial: "foo     bar",
        keys: ["w", "x"],
      },
      {
        label: "whitespace run (WORD)",
        initial: "foo     bar",
        keys: ["W", "x"],
      },
      { label: "empty line (word)", initial: "", keys: ["w", "d", "w"] },
      { label: "empty line (WORD)", initial: "", keys: ["W", "d", "W"] },
      {
        label: "blank-middle-line W",
        initial: "foo\n\nbar",
        keys: ["$", "W", "x"],
      },
      {
        label: "blank-middle-line B",
        initial: "foo\n\nbar",
        keys: ["j", "j", "0", "B", "x"],
      },
      {
        label: "WORD punctuation + whitespace boundary",
        initial: "foo--bar   baz",
        keys: ["W", "E", "x"],
      },
    ];

    for (const testCase of cases) {
      assertFastEqualsCanonical(
        testCase.initial,
        testCase.keys,
        testCase.label,
      );
    }
  });

  it("keeps insert-mode behavior unaffected", () => {
    assertFastEqualsCanonical(
      "hello",
      ["i", "X", "Y", "\x1b", "x"],
      "insert mode",
    );
  });

  it("keeps non-word command behavior unaffected", () => {
    assertFastEqualsCanonical(
      "foo",
      ["x", "P", "f", "o", "x"],
      "non-word commands",
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-line word motions (w / e / b and operator forms)
// ---------------------------------------------------------------------------

describe("cross-line word motions", () => {
  it("w crosses EOL to next line word start", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$", "w", "x"]);
    // After w from EOL of line 1, cursor lands on 'b' of next line.
    expect(editor.getText()).toBe("foo\nar");
    expect(editor.getRegister()).toBe("b");
  });

  it("b at BOL jumps to previous line word start", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["j", "0", "b", "x"]);
    expect(editor.getText()).toBe("oo\nbar");
    expect(editor.getRegister()).toBe("f");
  });

  it("e crosses EOL to end of next line word", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$", "e", "x"]);
    expect(editor.getText()).toBe("foo\nba");
    expect(editor.getRegister()).toBe("r");
  });

  it("dw can delete across newline", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["d", "w"]);
    expect(editor.getText()).toBe("bar");
    expect(editor.getRegister()).toBe("foo\n");
  });

  it("yw can yank across newline without mutation", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    const before = editor.getText();
    sendKeys(editor, ["y", "w"]);
    expect(editor.getRegister()).toBe("foo\n");
    expect(editor.getText()).toBe(before);
  });

  it("W crosses EOL to next line WORD start", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$", "W", "x"]);
    expect(editor.getText()).toBe("foo\nar");
    expect(editor.getRegister()).toBe("b");
  });

  it("B at BOL jumps to previous line WORD start", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["j", "0", "B", "x"]);
    expect(editor.getText()).toBe("oo\nbar");
    expect(editor.getRegister()).toBe("f");
  });

  it("E crosses EOL to end of next line WORD", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    sendKeys(editor, ["$", "E", "x"]);
    expect(editor.getText()).toBe("foo\nba");
    expect(editor.getRegister()).toBe("r");
  });

  it("dW crosses newline while cW keeps cE parity", () => {
    const { editor: deleteEditor } = createMultiLineEditor("foo\nbar");
    sendKeys(deleteEditor, ["d", "W"]);
    expect(deleteEditor.getText()).toBe("bar");
    expect(deleteEditor.getRegister()).toBe("foo\n");

    const { editor: changeEditor } = createMultiLineEditor("foo\nbar");
    sendKeys(changeEditor, ["c", "W"]);
    expect(changeEditor.getText()).toBe("\nbar");
    expect(changeEditor.getRegister()).toBe("foo");
    expect(changeEditor.getMode()).toBe("insert");
  });

  it("yW can yank across newline without mutation", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    const before = editor.getText();
    sendKeys(editor, ["y", "W"]);
    expect(editor.getRegister()).toBe("foo\n");
    expect(editor.getText()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Yank (y) — no mutation, writes register
// ---------------------------------------------------------------------------

describe("yank operator — yy / yw / ye / yb / y$ / y0", () => {
  it("yy: yanks line + newline, does not mutate text", () => {
    const { editor } = createEditorWithSpy("hello world");
    const before = editor.getText();
    sendKeys(editor, ["y", "y"]);
    expect(editor.getRegister()).toBe("hello world\n");
    expect(editor.getText()).toBe(before);
  });

  it("yw: yanks forward word, no mutation", () => {
    const { editor } = createEditorWithSpy("hello world");
    const before = editor.getText();
    sendKeys(editor, ["y", "w"]);
    expect(editor.getRegister()).toBe("hello ");
    expect(editor.getText()).toBe(before);
  });

  it("ye: yanks to end of word (inclusive), no mutation", () => {
    const { editor } = createEditorWithSpy("hello world");
    const before = editor.getText();
    sendKeys(editor, ["y", "e"]);
    expect(editor.getRegister()).toBe("hello");
    expect(editor.getText()).toBe(before);
  });

  it("yb from mid-word: yanks backward, no mutation", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();
    sendKeys(editor, ["w", "y", "b"]); // navigate to 'b', yank back to 'f'
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getText()).toBe(before);
  });

  it("y$: yanks to EOL, no mutation", () => {
    const { editor } = createEditorWithSpy("hello world");
    const before = editor.getText();
    sendKeys(editor, ["y", "$"]);
    expect(editor.getRegister()).toBe("hello world");
    expect(editor.getText()).toBe(before);
  });

  it("y0 from mid-word: yanks to start, no mutation", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();
    sendKeys(editor, ["w", "y", "0"]); // navigate to col 4, yank to start
    expect(editor.getRegister()).toBe("foo ");
    expect(editor.getText()).toBe(before);
  });

  it("yW yanks to next WORD start without mutation", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz");
    const before = editor.getText();

    sendKeys(editor, ["y", "W"]);

    expect(editor.getRegister()).toBe("foo-bar   ");
    expect(editor.getText()).toBe(before);
  });

  it("yE yanks to end of WORD inclusively", () => {
    const { editor } = createEditorWithSpy("foo-bar   baz");
    const before = editor.getText();

    sendKeys(editor, ["y", "E"]);

    expect(editor.getRegister()).toBe("foo-bar");
    expect(editor.getText()).toBe(before);
  });

  it("yB yanks backward by WORD", () => {
    const { editor } = createEditorWithSpy("foo-bar baz");
    const before = editor.getText();

    sendKeys(editor, ["W", "y", "B"]);

    expect(editor.getRegister()).toBe("foo-bar ");
    expect(editor.getText()).toBe(before);
  });

  it("yank invariant: text unchanged across all yank motions", () => {
    const { editor } = createEditorWithSpy("hello world");
    const before = editor.getText();
    for (const motion of ["y", "w", "y", "e", "y", "$", "y", "b", "y", "0"]) {
      sendKeys(editor, [motion]);
    }
    expect(editor.getText()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Put (p / P) — character-wise
// ---------------------------------------------------------------------------

describe("put — character-wise", () => {
  it("P uses the internal register while a local clipboard mirror is pending", async () => {
    const { editor } = createEditorWithSpy("foo bar");
    const activeWrite = deferred();
    const writes: string[] = [];

    editor.setClipboardFn(async (text) => {
      writes.push(text);
      await activeWrite.promise;
    });
    editor.setClipboardReadFn(() => "OLD");

    try {
      sendKeys(editor, ["d", "w", "P"]);

      expect(editor.getText()).toBe("foo bar");
      expect(editor.getRegister()).toBe("foo ");
      expect(writes).toEqual(["foo "]);
    } finally {
      activeWrite.resolve();
      await nextImmediate();
    }
  });

  it("P reads the OS clipboard again after a local mirror settles", async () => {
    const { editor } = createEditorWithSpy("foo bar");
    const writes: string[] = [];

    editor.setClipboardFn((text) => {
      writes.push(text);
    });
    editor.setClipboardReadFn(() => "OLD");

    sendKeys(editor, ["d", "w"]);
    await nextImmediate();

    editor.setClipboardReadFn(() => "SYS");
    sendKeys(editor, ["P"]);

    expect(editor.getText()).toBe("SYSbar");
    expect(editor.getRegister()).toBe("foo ");
    expect(writes).toEqual(["foo "]);
  });

  it("p reads OS clipboard text instead of stale internal register", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "SYS");

    sendKeys(editor, ["p"]);

    expect(editor.getText()).toBe("aSYSb");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
  });

  it("P reads OS clipboard text instead of stale internal register", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "SYS");

    sendKeys(editor, ["P"]);

    expect(editor.getText()).toBe("SYSab");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("p falls back to internal register when OS clipboard read returns null", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => null);

    sendKeys(editor, ["p"]);

    expect(editor.getText()).toBe("ashadowb");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
  });

  it("p falls back to internal register when OS clipboard read throws", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => {
      throw new Error("clipboard read failed");
    });

    sendKeys(editor, ["p"]);

    expect(editor.getText()).toBe("ashadowb");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
  });

  it("p treats empty OS clipboard as successful empty paste", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "");

    sendKeys(editor, ["p"]);

    expect(editor.getText()).toBe("ab");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("counted empty OS clipboard paste consumes the count", () => {
    const { editor } = createEditorWithSpy("abcd");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "");

    sendKeys(editor, ["3", "p", "l"]);

    expect(editor.getText()).toBe("abcd");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });

  it("3p repeats OS clipboard text instead of stale internal register", () => {
    const { editor } = createEditorWithSpy("X");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "ab");

    sendKeys(editor, ["3", "p"]);

    expect(editor.getText()).toBe("Xababab");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
  });

  it("3P repeats OS clipboard text instead of stale internal register", () => {
    const { editor } = createEditorWithSpy("X");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "ab");

    sendKeys(editor, ["3", "P"]);

    expect(editor.getText()).toBe("abababX");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
  });

  it("p inserts register content after cursor", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("X");
    sendKeys(editor, ["p"]);
    expect(editor.getText()).toBe("aXb");
  });

  it("P inserts register content before cursor", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("X");
    sendKeys(editor, ["P"]);
    expect(editor.getText()).toBe("Xab");
  });

  it("p/P are no-ops when register is empty", () => {
    const { editor } = createEditorWithSpy("ab");
    editor.setRegister("");
    const before = editor.getText();
    sendKeys(editor, ["p"]);
    expect(editor.getText()).toBe(before);
    sendKeys(editor, ["P"]);
    expect(editor.getText()).toBe(before);
  });

  it("yw then p: yanked text inserted after cursor", () => {
    // "hello" col 0: yw grabs "hello" (whole word to EOL)
    // p: ESC_RIGHT (col→1) then insert "hello" → "hhelloello"
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["y", "w"]);
    expect(editor.getRegister()).toBe("hello");
    sendKeys(editor, ["p"]);
    expect(editor.getText()).toBe("hhelloello");
  });

  it("p at EOL on non-last line inserts before newline", () => {
    const { editor } = createMultiLineEditor("foo\nbar");
    editor.setRegister("X");
    sendKeys(editor, ["$", "p"]);
    expect(editor.getText()).toBe("fooX\nbar");
  });
});

// ---------------------------------------------------------------------------
// Put (p / P) — line-wise
// ---------------------------------------------------------------------------

describe("put — line-wise", () => {
  it("p treats OS clipboard text ending in newline as linewise", () => {
    const { editor } = createMultiLineEditor("a\nb");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "X\n");

    sendKeys(editor, ["p"]);

    expect(editor.getText()).toBe("a\nX\nb");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
  });

  it("P treats OS clipboard text ending in newline as linewise", () => {
    const { editor } = createMultiLineEditor("a\nb");
    editor.setRegister("shadow");
    editor.setClipboardReadFn(() => "X\n");

    sendKeys(editor, ["P"]);

    expect(editor.getText()).toBe("X\na\nb");
    expect(editor.getRegister()).toBe("shadow");
    expect(editor.getMode()).toBe("normal");
  });

  it("p with line-wise register inserts new line below", () => {
    const { editor } = createEditorWithSpy("bar");
    editor.setRegister("foo\n");
    sendKeys(editor, ["p"]);
    const lines = editor.getText().split("\n");
    expect(lines[0]).toBe("bar");
    expect(lines[1]).toBe("foo");
  });

  it("P with line-wise register inserts new line above", () => {
    const { editor } = createEditorWithSpy("bar");
    editor.setRegister("foo\n");
    sendKeys(editor, ["P"]);
    const lines = editor.getText().split("\n");
    expect(lines[0]).toBe("foo");
    expect(lines[1]).toBe("bar");
  });

  it("Y yanks current line (like yy)", () => {
    const { editor } = createMultiLineEditor("aaa\nbbb\nccc");
    sendKeys(editor, ["j", "Y", "p"]);
    const lines = editor.getText().split("\n");
    expect(lines).toEqual(["aaa", "bbb", "bbb", "ccc"]);
  });

  it("3Y yanks 3 lines", () => {
    const { editor } = createMultiLineEditor("aaa\nbbb\nccc\nddd");
    sendKeys(editor, ["3", "Y", "G", "p"]);
    const lines = editor.getText().split("\n");
    expect(lines).toEqual(["aaa", "bbb", "ccc", "ddd", "aaa", "bbb", "ccc"]);
  });

  it("yy then p: duplicates line below", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["y", "y"]);
    expect(editor.getRegister()).toBe("hello\n");
    sendKeys(editor, ["p"]);
    const lines = editor.getText().split("\n");
    expect(lines[0]).toBe("hello");
    expect(lines[1]).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// Undo / redo — u / ctrl+r  (Task 6)
// ---------------------------------------------------------------------------

describe("undo / redo — u / ctrl+r", () => {
  it("u in normal mode does not insert the letter 'u'", () => {
    // u must not be treated as a printable char — it must forward ctrl+_ to super
    const { editor } = createEditorWithSpy("hello");
    const before = editor.getText();
    sendKeys(editor, ["u"]);
    expect(
      !editor.getText().includes("uhello") &&
        editor.getText().length <= before.length,
    ).toBeTruthy();
  });

  it("u after dw: text does not grow (undo forwarded to underlying editor)", () => {
    // Keep this as a narrow safety regression. Round-trip restore coverage
    // lives in the redo-focused tests below.
    const { editor } = createEditorWithSpy("hello world");
    sendKeys(editor, ["d", "w"]);
    const afterDelete = editor.getText();
    expect(afterDelete).toBe("world");
    sendKeys(editor, ["u"]); // sends \x1f to underlying editor
    // text length must not grow beyond the pre-delete length
    expect(editor.getText().length <= "hello world".length).toBeTruthy();
  });

  it("ctrl+r in normal mode with no redo history is a safe no-op", () => {
    const { editor } = createEditorWithSpy("hello world");
    const beforeText = editor.getText();
    const beforeCursor = editor.getCursor();

    expect(() => sendKeys(editor, ["\x12"])).not.toThrow();
    expect(editor.getText()).toBe(beforeText);
    expect(editor.getCursor()).toEqual(beforeCursor);
  });

  it("ctrl+r after x then u restores deleted text", () => {
    const { editor } = createEditorWithSpy("hello");

    sendKeys(editor, ["x"]);
    expect(editor.getText()).toBe("ello");

    sendKeys(editor, ["u"]);
    expect(editor.getText()).toBe("hello");

    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("ello");
  });

  it("ctrl+r restores the captured post-change cursor", () => {
    const { editor } = createEditorWithSpy("X");
    editor.setRegister("ab");

    sendKeys(editor, ["p"]);
    const afterPutCursor = editor.getCursor();
    expect(editor.getText()).toBe("Xab");
    expect(afterPutCursor).toEqual({ line: 0, col: 3 });

    sendKeys(editor, ["u"]);
    expect(editor.getText()).toBe("X");
    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });

    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("Xab");
    expect(editor.getCursor()).toEqual(afterPutCursor);
  });

  it("ctrl+r in normal mode is not inserted as a literal control character", () => {
    const { editor } = createEditorWithSpy("hello");

    sendKeys(editor, ["x", "u", "\x12"]);

    expect(editor.getText()).toBe("ello");
    expect(!editor.getText().includes("\x12")).toBeTruthy();
  });

  it("repeated ctrl+r walks forward through stacked redo history", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "x", "x"]);
    expect(editor.getText()).toBe("d");

    sendKeys(editor, ["u", "u", "u"]);
    expect(editor.getText()).toBe("abcd");

    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("bcd");

    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("cd");

    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("d");
  });

  it("2ctrl+r redoes two stacked undo steps", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "x", "x"]);
    sendKeys(editor, ["u", "u", "u"]);
    expect(editor.getText()).toBe("abcd");

    sendKeys(editor, ["2", "\x12"]);

    expect(editor.getText()).toBe("cd");
  });

  it("3ctrl+r redoes three stacked undo steps", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "x", "x"]);
    sendKeys(editor, ["u", "u", "u"]);
    expect(editor.getText()).toBe("abcd");

    sendKeys(editor, ["3", "\x12"]);

    expect(editor.getText()).toBe("d");
  });

  it("3ctrl+r clamps when fewer redo steps exist", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "x"]);
    sendKeys(editor, ["u", "u"]);
    expect(editor.getText()).toBe("abcd");

    sendKeys(editor, ["3", "\x12"]);

    expect(editor.getText()).toBe("cd");
  });

  it("counted ctrl+r does not leak count into the next command", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "x", "x"]);
    sendKeys(editor, ["u", "u", "u"]);
    expect(editor.getText()).toBe("abcd");

    sendKeys(editor, ["2", "\x12", "x"]);

    expect(editor.getText()).toBe("d");
    expect(editor.getRegister()).toBe("c");
  });

  it("redo parity: x restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "hello",
      keys: ["x"],
      expectedText: "ello",
      expectedCursor: { line: 0, col: 0 },
      expectedRegister: "h",
    });
  });

  it("redo parity: dw restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "hello world",
      keys: ["d", "w"],
      expectedText: "world",
      expectedCursor: { line: 0, col: 0 },
      expectedRegister: "hello ",
    });
  });

  it("redo parity: dd restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "foo\nbar",
      keys: ["d", "d"],
      expectedText: "bar",
      expectedCursor: { line: 0, col: 0 },
      expectedRegister: "foo\n",
      multiLine: true,
    });
  });

  it("redo parity: p restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "ab",
      keys: ["p"],
      expectedText: "aXb",
      expectedCursor: { line: 0, col: 2 },
      expectedRegister: "X",
      before: (editor) => editor.setRegister("X"),
    });
  });

  it("redo parity: P restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "ab",
      keys: ["P"],
      expectedText: "Xab",
      expectedCursor: { line: 0, col: 1 },
      expectedRegister: "X",
      before: (editor) => editor.setRegister("X"),
    });
  });

  it("redo parity: cw restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "hello world",
      keys: ["c", "w", "Z", "\x1b"],
      expectedText: "Zworld",
      expectedCursor: { line: 0, col: 1 },
      expectedRegister: "hello ",
    });
  });

  it("redo parity: J restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "foo\nbar",
      keys: ["J"],
      expectedText: "foo bar",
      expectedCursor: { line: 0, col: 3 },
      expectedRegister: "",
      multiLine: true,
    });
  });

  it("redo parity: gJ restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "foo\nbar",
      keys: ["g", "J"],
      expectedText: "foobar",
      expectedCursor: { line: 0, col: 3 },
      expectedRegister: "",
      multiLine: true,
    });
  });

  it("redo parity: 3J restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "aa\nbb\ncc",
      keys: ["3", "J"],
      expectedText: "aa bb cc",
      expectedCursor: { line: 0, col: 5 },
      expectedRegister: "",
      multiLine: true,
    });
  });

  it("redo parity: 3gJ restores text, cursor, and register", () => {
    assertRedoRoundTrip({
      initial: "aa\nbb\ncc",
      keys: ["3", "g", "J"],
      expectedText: "aabbcc",
      expectedCursor: { line: 0, col: 4 },
      expectedRegister: "",
      multiLine: true,
    });
  });

  it("redo parity: J preserves preexisting unnamed register", () => {
    assertRedoRoundTrip({
      initial: "foo\nbar",
      keys: ["J"],
      expectedText: "foo bar",
      expectedCursor: { line: 0, col: 3 },
      expectedRegister: "keep",
      multiLine: true,
      before: (editor) => editor.setRegister("keep"),
    });
  });

  describe("central invalidation hook", () => {
    function seedStaleRedo(options: { initial: string; multiLine?: boolean }): {
      editor: ReturnType<typeof createEditorWithSpy>["editor"];
      staleRedoText: string;
    } {
      const { initial, multiLine = false } = options;
      const { editor } = multiLine
        ? createMultiLineEditor(initial)
        : createEditorWithSpy(initial);

      sendKeys(editor, ["x"]);
      const staleRedoText = editor.getText();
      sendKeys(editor, ["u"]);
      expect(editor.getText()).toBe(initial);

      return { editor, staleRedoText };
    }

    it("mutation classes clear redo history", () => {
      const scenarios: Array<{
        name: string;
        initial: string;
        keys: string[];
        expectedText: string;
        multiLine?: boolean;
      }> = [
        {
          name: "insert-mode text entry",
          initial: "abcd",
          keys: ["i", "Z", "\x1b"],
          expectedText: "Zabcd",
        },
        {
          name: "delegated normal-mode mutation (D)",
          initial: "abcd",
          keys: ["D"],
          expectedText: "",
        },
        {
          name: "delegated normal-mode mutation (dw)",
          initial: "alpha beta",
          keys: ["d", "w"],
          expectedText: "beta",
        },
        {
          name: "synthetic edit (J)",
          initial: "a\nb",
          keys: ["J"],
          expectedText: "a b",
          multiLine: true,
        },
        {
          name: "synthetic edit (gJ)",
          initial: "a\nb",
          keys: ["g", "J"],
          expectedText: "ab",
          multiLine: true,
        },
      ];

      for (const scenario of scenarios) {
        const { editor } = seedStaleRedo({
          initial: scenario.initial,
          multiLine: scenario.multiLine,
        });

        sendKeys(editor, scenario.keys);
        expect(editor.getText()).toBe(scenario.expectedText);

        sendKeys(editor, ["\x12"]);
        expect(editor.getText()).toBe(scenario.expectedText);
      }
    });

    it("guarded undo/redo classes preserve redo history", () => {
      const scenarios: Array<{
        name: string;
        run: (editor: ReturnType<typeof createEditorWithSpy>["editor"]) => void;
      }> = [
        {
          name: "undo transition",
          run: (editor) => {
            sendKeys(editor, ["x", "x"]);
            sendKeys(editor, ["u"]);
            expect(editor.getText()).toBe("bcd");

            sendKeys(editor, ["u"]);
            expect(editor.getText()).toBe("abcd");

            sendKeys(editor, ["\x12", "\x12"]);
            expect(editor.getText()).toBe("cd");
          },
        },
        {
          name: "redo transition",
          run: (editor) => {
            sendKeys(editor, ["x", "x", "x"]);
            sendKeys(editor, ["u", "u", "u"]);
            expect(editor.getText()).toBe("abcd");

            sendKeys(editor, ["2", "\x12"]);
            expect(editor.getText()).toBe("cd");

            sendKeys(editor, ["u"]);
            expect(editor.getText()).toBe("bcd");
          },
        },
      ];

      for (const scenario of scenarios) {
        const { editor } = createEditorWithSpy("abcd");
        scenario.run(editor);
      }
    });

    it("non-mutating classes preserve redo history", () => {
      const scenarios: Array<{
        name: string;
        run: (
          editor: ReturnType<typeof createEditorWithSpy>["editor"],
          staleRedoText: string,
        ) => void;
      }> = [
        {
          name: "navigation",
          run: (editor, staleRedoText) => {
            sendKeys(editor, ["l", "h", "\x12"]);
            expect(editor.getText()).toBe(staleRedoText);
          },
        },
        {
          name: "yank",
          run: (editor, staleRedoText) => {
            sendKeys(editor, ["y", "y", "\x12"]);
            expect(editor.getText()).toBe(staleRedoText);
          },
        },
        {
          name: "failed motion",
          run: (editor, staleRedoText) => {
            sendKeys(editor, ["f", "z", "\x12"]);
            expect(editor.getText()).toBe(staleRedoText);
          },
        },
        {
          name: "mode toggle",
          run: (editor, staleRedoText) => {
            sendKeys(editor, ["i", "\x1b", "\x12"]);
            expect(editor.getText()).toBe(staleRedoText);
          },
        },
        {
          name: "no-op redo",
          run: (editor, staleRedoText) => {
            sendKeys(editor, ["\x12"]);
            expect(editor.getText()).toBe(staleRedoText);

            sendKeys(editor, ["\x12"]);
            expect(editor.getText()).toBe(staleRedoText);

            sendKeys(editor, ["u", "\x12"]);
            expect(editor.getText()).toBe(staleRedoText);
          },
        },
      ];

      for (const scenario of scenarios) {
        const { editor, staleRedoText } = seedStaleRedo({ initial: "abcd" });
        scenario.run(editor, staleRedoText);
      }
    });

    it("empty redo-stack fast path is harmless", () => {
      const { editor } = createEditorWithSpy("abcd");

      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("abcd");

      sendKeys(editor, ["i", "Z", "\x1b"]);
      expect(editor.getText()).toBe("Zabcd");

      sendKeys(editor, ["u", "\x12"]);
      expect(editor.getText()).toBe("Zabcd");
    });

    it("no-op synthetic edit (J on last line) preserves redo", () => {
      const { editor } = createEditorWithSpy("hello");
      sendKeys(editor, ["x"]);
      sendKeys(editor, ["u"]);
      expect(editor.getText()).toBe("hello");
      sendKeys(editor, ["J"]);
      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("ello");
    });
  });

  it("bracketed paste in normal mode still clears pending state before redo", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "u"]);
    expect(editor.getText()).toBe("abcd");

    editor.setRegister("keep");
    sendKeys(editor, ["d", "\x1b[200~paste\x1b[201~", "\x12"]);

    expect(editor.getText()).toBe("bcd");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(editor.getRegister()).toBe("keep");
  });

  it("ctrl+k still cancels pending delete and clears stale redo history", () => {
    const { editor } = createEditorWithSpy("abcd");

    sendKeys(editor, ["x", "u"]);
    expect(editor.getText()).toBe("abcd");
    expect(editor.getRegister()).toBe("a");

    sendKeys(editor, ["d", "\x0b"]);

    expect(editor.getText()).toBe("");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(editor.getRegister()).toBe("a");

    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(editor.getRegister()).toBe("a");
  });

  it("redo does not stomp a newer unnamed register value", () => {
    const { editor } = createEditorWithSpy("hello world");

    sendKeys(editor, ["x", "u"]);
    sendKeys(editor, ["y", "w"]);
    expect(editor.getRegister()).toBe("hello ");

    sendKeys(editor, ["\x12"]);

    expect(editor.getText()).toBe("ello world");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(editor.getRegister()).toBe("hello ");
  });

  it("u in insert mode inserts literal 'u' (not intercepted)", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["i"]); // → insert mode
    expect(editor.getMode()).toBe("insert");
    sendKeys(editor, ["u"]);
    expect(editor.getText().includes("u")).toBeTruthy();
  });

  it("undo does not self-invalidate redo stack", () => {
    const { editor } = createEditorWithSpy("abcd");
    sendKeys(editor, ["x", "x"]); // 'a' then 'b' deleted
    expect(editor.getText()).toBe("cd");
    sendKeys(editor, ["u"]); // undo 'b' delete → "bcd"
    // redo stack has 1 entry; second undo must not clear it
    sendKeys(editor, ["u"]); // undo 'a' delete → "abcd"
    expect(editor.getText()).toBe("abcd");
    // both redo entries must survive
    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("bcd");
    sendKeys(editor, ["\x12"]);
    expect(editor.getText()).toBe("cd");
  });

  describe("stepwise counted redo — intermediate undo granularity", () => {
    it("2<C-r> then u lands on state after first redo", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "x", "x"]); // "d"
      sendKeys(editor, ["u", "u", "u"]); // "abcd"
      sendKeys(editor, ["2", "\x12"]); // redo 2 steps → "cd"
      expect(editor.getText()).toBe("cd");
      sendKeys(editor, ["u"]); // undo one redo → "bcd"
      expect(editor.getText()).toBe("bcd");
    });

    it("after 2<C-r> then u, another u returns to pre-redo state", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "x", "x"]);
      sendKeys(editor, ["u", "u", "u"]);
      sendKeys(editor, ["2", "\x12"]);
      sendKeys(editor, ["u"]); // → "bcd"
      sendKeys(editor, ["u"]); // → "abcd"
      expect(editor.getText()).toBe("abcd");
    });

    it("stepwise redo with synthetic-edit history (J)", () => {
      const { editor } = createMultiLineEditor("a\nb\nc");
      sendKeys(editor, ["J"]); // join → "a b\nc"
      sendKeys(editor, ["J"]); // join → "a b c"
      expect(editor.getText()).toBe("a b c");

      sendKeys(editor, ["u", "u"]); // undo both → "a\nb\nc"
      expect(editor.getText()).toBe("a\nb\nc");

      sendKeys(editor, ["2", "\x12"]); // redo 2 → "a b c"
      expect(editor.getText()).toBe("a b c");

      sendKeys(editor, ["u"]); // undo last redo → "a b\nc"
      expect(editor.getText()).toBe("a b\nc");
    });
  });

  describe("redo restore hardening", () => {
    it("restore failure does not consume redo entry or change visible state", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "u"]);
      expect(editor.getText()).toBe("abcd");

      const raw = getRawEditor(editor);
      const savedState = raw.state;
      raw.state = undefined;

      try {
        expect(() => sendKeys(editor, ["\x12"])).toThrow(
          /redo restore prerequisite: editor state unavailable/i,
        );
      } finally {
        raw.state = savedState;
      }

      expect(editor.getText()).toBe("abcd");

      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("bcd");
    });

    it("partial counted redo failure preserves committed steps", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "x"]); // "cd"
      sendKeys(editor, ["u", "u"]); // "abcd"
      expect(editor.getText()).toBe("abcd");

      const raw = getRawEditor(editor);
      const originalPushUndoSnapshot = raw.pushUndoSnapshot;
      let pushCalls = 0;
      let suspendedState = raw.state;

      raw.pushUndoSnapshot = () => {
        pushCalls++;
        originalPushUndoSnapshot?.call(raw);
        if (pushCalls === 2) {
          suspendedState = raw.state;
          raw.state = undefined;
        }
      };

      try {
        expect(() => sendKeys(editor, ["2", "\x12"])).toThrow(
          /redo restore prerequisite: editor state unavailable/i,
        );
      } finally {
        raw.state = suspendedState;
        raw.pushUndoSnapshot = originalPushUndoSnapshot;
      }

      expect(editor.getText()).toBe("bcd");

      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("cd");
    });

    it("redo throws when pushUndoSnapshot is unavailable", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "u"]);
      expect(editor.getText()).toBe("abcd");

      const raw = getRawEditor(editor);
      const saved = raw.pushUndoSnapshot;
      raw.pushUndoSnapshot = undefined;

      try {
        expect(() => sendKeys(editor, ["\x12"])).toThrow(/pushUndoSnapshot/i);
      } finally {
        raw.pushUndoSnapshot = saved;
      }

      // Redo entry must NOT have been consumed
      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("bcd");
    });
  });

  describe("post-redo motion/cache coherence", () => {
    it("w motion after redo of join reads restored buffer", () => {
      const { editor } = createMultiLineEditor("aaa\nbbb ccc");

      sendKeys(editor, ["J"]);
      expect(editor.getText()).toBe("aaa bbb ccc");

      sendKeys(editor, ["u"]);
      expect(editor.getText()).toBe("aaa\nbbb ccc");

      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("aaa bbb ccc");

      sendKeys(editor, ["w", "x"]);
      expect(editor.getText()).toBe("aaa bb ccc");
    });

    it("b motion after redo reads restored buffer", () => {
      const { editor } = createEditorWithSpy("hello world");

      sendKeys(editor, ["x"]);
      expect(editor.getText()).toBe("ello world");

      sendKeys(editor, ["u"]);
      expect(editor.getText()).toBe("hello world");

      sendKeys(editor, ["\x12"]);
      expect(editor.getText()).toBe("ello world");

      sendKeys(editor, ["$", "b", "x"]);
      expect(editor.getText()).toBe("ello orld");
    });
  });

  describe("normal-mode CTRL_UNDERSCORE undo alias", () => {
    it("CTRL_UNDERSCORE in normal mode acts as undo", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x"]); // delete 'a'
      expect(editor.getText()).toBe("bcd");
      sendKeys(editor, ["\x1f"]); // CTRL_UNDERSCORE
      expect(editor.getText()).toBe("abcd");
    });

    it("CTRL_UNDERSCORE feeds redo history like u", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x"]);
      sendKeys(editor, ["\x1f"]); // undo via CTRL_UNDERSCORE
      expect(editor.getText()).toBe("abcd");
      sendKeys(editor, ["\x12"]); // redo
      expect(editor.getText()).toBe("bcd");
    });

    it("no-op CTRL_UNDERSCORE does not create redo history", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["\x1f"]); // undo with nothing to undo
      sendKeys(editor, ["\x12"]); // redo should be no-op
      expect(editor.getText()).toBe("abcd");
    });

    it("CTRL_UNDERSCORE does not insert literal control char", () => {
      const { editor } = createEditorWithSpy("hello");
      sendKeys(editor, ["\x1f"]);
      expect(!editor.getText().includes("\x1f")).toBeTruthy();
    });
  });

  describe("count-state safety for counted redo", () => {
    it("{count}<C-r> does not leak count into next command (9)", () => {
      const { editor } = createEditorWithSpy("abcdefghij");
      sendKeys(editor, ["x", "u"]);
      // 9<C-r> clamps to 1 available entry, then x deletes one char
      sendKeys(editor, ["9", "\x12", "x"]);
      expect(editor.getText()).toBe("cdefghij");
      expect(editor.getRegister()).toBe("b");
    });

    it("0 after counted redo is treated as line-start motion", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["l", "l", "x", "u"]);
      // 1<C-r> redoes the x at col 2 → "abd"; 0 = line-start; x deletes 'a'
      sendKeys(editor, ["1", "\x12", "0", "x"]);
      expect(editor.getText()).toBe("bd");
    });
  });
  describe("counted undo", () => {
    it("3u undoes 3 separate edits", () => {
      const { editor } = createMultiLineEditor("hello");
      // make 3 edits
      sendKeys(editor, ["A"]);
      sendKeys(editor, [" "]);
      sendKeys(editor, ["\x1b"]);
      sendKeys(editor, ["A"]);
      sendKeys(editor, ["w"]);
      sendKeys(editor, ["\x1b"]);
      sendKeys(editor, ["A"]);
      sendKeys(editor, ["!"]);
      sendKeys(editor, ["\x1b"]);
      // buffer should be "hello w!"
      expect(editor.getText()).toBe("hello w!");
      // 3u should undo all 3 edits
      sendKeys(editor, ["3", "u"]);
      expect(editor.getText()).toBe("hello");
    });

    it("counted undo clamps at available history", () => {
      // Start with empty text so no setup undo history exists
      const { editor } = createMultiLineEditor("");
      // make 1 edit: type a char in insert mode
      sendKeys(editor, ["i", "!", "\x1b"]);
      expect(editor.getText()).toBe("!");
      // 9u should undo the 1 available edit without error
      sendKeys(editor, ["9", "u"]);
      expect(editor.getText()).toBe("");
    });

    it("counted undo does not leak count to next command", () => {
      const { editor } = createMultiLineEditor("aaa\nbbb\nccc");
      // make 2 edits
      sendKeys(editor, ["A"]);
      sendKeys(editor, ["!"]);
      sendKeys(editor, ["\x1b"]);
      sendKeys(editor, ["j"]);
      sendKeys(editor, ["A"]);
      sendKeys(editor, ["?"]);
      sendKeys(editor, ["\x1b"]);
      // 2u
      sendKeys(editor, ["2", "u"]);
      // now press j — should move 1 line, not 2
      sendKeys(editor, ["j"]);
      // cursor should be on line 1 (0-indexed), not line 2
      expect(editor.getCursor().line).toBe(1);
    });
  });

  describe("kitty keyboard protocol sequences", () => {
    it("kitty ctrl+r triggers redo", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "u"]);
      expect(editor.getText()).toBe("abcd");
      sendKeys(editor, ["\x1b[114;5u"]); // kitty ctrl+r
      expect(editor.getText()).toBe("bcd");
    });

    it("kitty ctrl+_ triggers undo and feeds redo", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x"]);
      expect(editor.getText()).toBe("bcd");
      sendKeys(editor, ["\x1b[95;5u"]); // kitty ctrl+_
      expect(editor.getText()).toBe("abcd");
      sendKeys(editor, ["\x12"]); // redo
      expect(editor.getText()).toBe("bcd");
    });

    it("counted kitty ctrl+r works", () => {
      const { editor } = createEditorWithSpy("abcd");
      sendKeys(editor, ["x", "x"]);
      expect(editor.getText()).toBe("cd");
      sendKeys(editor, ["u", "u"]);
      expect(editor.getText()).toBe("abcd");
      sendKeys(editor, ["2", "\x1b[114;5u"]); // 2<kitty-C-r>
      expect(editor.getText()).toBe("cd");
    });
  });
});

// ---------------------------------------------------------------------------
// Char-find motions — f / t / F / T / ; / ,
// ---------------------------------------------------------------------------

describe("char-find motions — f / F / t / T / ; / ,", () => {
  it("f{char}: cursor moves to next occurrence of char", () => {
    // "hello world" col 0, fo → cursor to col 4 ('o')
    // verify via x: delete 'o' at col 4
    chk("hello world", ["f", "o", "x"], "hell world", "o");
  });

  it("t{char}: cursor moves to one before char", () => {
    // "hello world" col 0, to → cursor to col 3 ('l'), x deletes 'l'
    chk("hello world", ["t", "o", "x"], "helo world", "l");
  });

  it("F{char}: cursor moves backward to char", () => {
    // "aba" col 0→2 (ll), Fa → cursor to col 0, x deletes 'a'
    chk("aba", ["l", "l", "F", "a", "x"], "ba", "a");
  });

  it("T{char}: cursor moves to one after backward target", () => {
    // "abcde" col 4 (press e for end), Tb → finds 'b' at col 1, returns col 2
    // x at col 2 deletes 'c' → "abde"
    chk("abcde", ["e", "T", "b", "x"], "abde", "c");
  });

  it("; repeats last f motion forward", () => {
    // "hello world" col 0: fo → col 4 ('o'); ; → next 'o' col 7; x
    chk("hello world", ["f", "o", ";", "x"], "hello wrld", "o");
  });

  it(", reverses last f motion", () => {
    // "hello world" col 0: fo → col 4; ; → col 7; , → back to col 4; x
    chk("hello world", ["f", "o", ";", ",", "x"], "hell world", "o");
  });

  it("f{char} with operator: df{char} deletes to char (inclusive)", () => {
    // "hello world" col 0, dfo → deletes "hello" (col 0..4 inclusive)
    chk("hello world", ["d", "f", "o"], " world", "hello");
  });

  it("t{char} with operator: dt{char} deletes up to char (exclusive)", () => {
    // "hello world" col 0, dto → deletes "hell" (col 0..3, not 'o')
    chk("hello world", ["d", "t", "o"], "o world", "hell");
  });

  it("f{char} handles an emoji before the target", () => {
    const { editor } = createEditorWithSpy("😀xy");

    sendKeys(editor, ["f", "y"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("T{char} at EOL lands at line end instead of crashing", () => {
    const { editor } = createEditorWithSpy("abc");

    sendKeys(editor, ["$", "T", "c"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("T{char} after an emoji target at EOL lands safely", () => {
    const { editor } = createEditorWithSpy("ab😀");

    sendKeys(editor, ["$", "T", "😀"]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("f{char} accepts a single grapheme made of multiple code points", () => {
    const target = "e\u0301";
    const { editor } = createEditorWithSpy(`x${target}y`);

    sendKeys(editor, ["f", target]);

    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });
});

// ---------------------------------------------------------------------------
// Operator cancellation / edge safety
// ---------------------------------------------------------------------------

describe("operator cancellation", () => {
  it("Escape cancels pending operator without mutation", () => {
    const { editor } = createEditorWithSpy("hello");
    const before = editor.getText();
    sendKeys(editor, ["d"]); // pendingOperator = 'd'
    sendKeys(editor, ["\x1b"]); // cancel
    expect(editor.getText()).toBe(before);
    expect(editor.getMode()).toBe("normal");
  });

  it("Escape cancels pending motion without mutation", () => {
    const { editor } = createEditorWithSpy("hello");
    const before = editor.getText();
    sendKeys(editor, ["f"]); // pendingMotion = 'f'
    sendKeys(editor, ["\x1b"]); // cancel
    expect(editor.getText()).toBe(before);
  });

  it("unrecognised key after d operator cancels cleanly", () => {
    const { editor } = createEditorWithSpy("hello");
    const before = editor.getText();
    sendKeys(editor, ["d", "z"]); // 'z' is not a valid motion
    expect(editor.getText()).toBe(before);
  });

  it("invalid delete motion does not stay sticky", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();

    // If d stays pending after z, next w would delete instead of move.
    sendKeys(editor, ["d", "z", "w"]);
    expect(editor.getText()).toBe(before);
  });

  it("invalid change motion does not stay sticky", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();

    // If c stays pending after z, next w would change/delete unexpectedly.
    sendKeys(editor, ["c", "z", "w"]);
    expect(editor.getText()).toBe(before);
    expect(editor.getMode()).toBe("normal");
  });

  it("printable chunk cancels df target wait without insertion", () => {
    const { editor } = createEditorWithSpy("foo bar");

    // After d f, pasted printable chunks should cancel the wait and be ignored.
    // If operator stays sticky or text is inserted, final state differs.
    sendKeys(editor, ["d", "f", "ab", "w", "x"]);

    expect(editor.getText()).toBe("foo ar");
    expect(editor.getRegister()).toBe("b");
  });

  it("bracketed paste chunk cancels df target wait", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["d", "f", "\x1b[200~PASTE\x1b[201~", "w", "x"]);

    expect(editor.getText()).toBe("foo ar");
    expect(editor.getRegister()).toBe("b");
  });

  it("split bracketed paste cancels df target wait", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["d", "f", "\x1b[200~", "PASTE", "\x1b[201~", "w", "x"]);

    expect(editor.getText()).toBe("foo ar");
    expect(editor.getRegister()).toBe("b");
  });

  it("double-escape recovers from unterminated bracketed paste discard mode", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["\x1b[200~", "\x1b", "\x1b", "w", "x"]);

    expect(editor.getText()).toBe("foo ar");
    expect(editor.getRegister()).toBe("b");
  });

  it("double-escape recovery does not forward escape upward", () => {
    const { editor } = createEditorWithSpy("foo bar");

    const customEditorProto = Object.getPrototypeOf(
      Object.getPrototypeOf(editor),
    );
    const originalHandleInput = customEditorProto.handleInput;
    let forwardedEscapeCount = 0;

    customEditorProto.handleInput = function (
      this: unknown,
      data: string,
    ): unknown {
      if (data === "\x1b") forwardedEscapeCount++;
      return originalHandleInput.call(this, data);
    };

    try {
      sendKeys(editor, ["\x1b[200~", "\x1b", "\x1b"]);
      expect(forwardedEscapeCount).toBe(0);
    } finally {
      customEditorProto.handleInput = originalHandleInput;
    }
  });

  it("split bracketed paste end marker closes discard state", () => {
    const { editor } = createEditorWithSpy("foo bar");

    sendKeys(editor, ["\x1b[200~", "PASTE", "\x1b", "[201~", "w", "x"]);

    expect(editor.getText()).toBe("foo ar");
    expect(editor.getRegister()).toBe("b");
  });

  it("non-printable input cancels df target wait without stickiness", () => {
    const { editor } = createEditorWithSpy("foo bar");
    const before = editor.getText();

    // After d f, a non-printable key must cancel the pending operator+motion.
    // If it stays sticky, the next w would delete.
    sendKeys(editor, ["d", "f", "\x1b[C", "w"]);

    expect(editor.getText()).toBe(before);
    expect(editor.getRegister()).toBe("");
  });

  it("non-printable invalid motion is passed through after cancel", () => {
    const { editor } = createEditorWithSpy("abc");

    // d + RightArrow should cancel d and still move right.
    // Then x should delete 'b' (not 'a').
    sendKeys(editor, ["d", "\x1b[C", "x"]);

    expect(editor.getText()).toBe("ac");
    expect(editor.getRegister()).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Anti-brittleness regression: no recursive delete handler re-entry
// ---------------------------------------------------------------------------

describe("regression — delete handler recursion", () => {
  it("D repeatedly does not recurse or overflow call stack", () => {
    const { editor } = createMultiLineEditor("alpha\nbeta\ngamma");

    expect(() => {
      for (let i = 0; i < 12; i++) {
        sendKeys(editor, ["D"]);
      }
    }).not.toThrow();

    // If recursion reappears, this test typically throws RangeError before here.
    expect(editor.getText().length >= 0).toBeTruthy();
  });
});

describe("additional count combinations", () => {
  it("d2k deletes current line and two above", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd\ne");
    sendKeys(editor, ["j", "j", "j", "d", "2", "k"]);
    expect(editor.getText()).toBe("a\ne");
    expect(editor.getRegister()).toBe("b\nc\nd\n");
  });

  it("d2j from middle of line deletes properly", () => {
    const { editor } = createMultiLineEditor("abc\ndef\nghi\njkl");
    sendKeys(editor, ["l", "d", "2", "j"]);
    expect(editor.getText()).toBe("jkl");
  });

  it("d2d deletes two lines just like 2dd", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");
    sendKeys(editor, ["d", "2", "d"]);
    expect(editor.getText()).toBe("c");
    expect(editor.getRegister()).toBe("a\nb\n");
  });

  it("2j moves cursor down two lines (counted navigation)", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd");
    sendKeys(editor, ["2", "j", "x"]);
    expect(editor.getText()).toBe("a\nb\n\nd");
  });

  it("2dG cancels cleanly and swallows G because it is printable", () => {
    const { editor } = createMultiLineEditor("a\nb\nc");
    sendKeys(editor, ["2", "d", "G", "x"]);
    // Since 2dG is canceled, G is swallowed, and we just execute x on line 0
    expect(editor.getText()).toBe("\nb\nc");
    expect(editor.getRegister()).toBe("a");
  });
});

describe("surrogate pair / buffer replacement regression", () => {
  it("dd deletes only the current line when it contains surrogate pairs", () => {
    const { editor } = createEditorWithSpy("");
    (
      editor as unknown as {
        state: { lines: string[]; cursorLine: number; cursorCol: number };
      }
    ).state = {
      lines: ["😀x", "keep"],
      cursorLine: 0,
      cursorCol: 0,
    };
    sendKeys(editor, ["d", "d"]);
    expect(editor.getRegister()).toBe("😀x\n");
    expect(editor.getText()).toBe("keep");
  });

  it("9x on multiline buffer does not cross newline", () => {
    const { editor } = createEditorWithSpy("");
    (
      editor as unknown as {
        state: { lines: string[]; cursorLine: number; cursorCol: number };
      }
    ).state = {
      lines: ["ab", "cd"],
      cursorLine: 0,
      cursorCol: 0,
    };
    sendKeys(editor, ["9", "x"]);
    expect(editor.getText()).toBe("\ncd");
  });

  it("x deletes a surrogate pair without corrupting the buffer", () => {
    const { editor } = createEditorWithSpy("😀x");
    sendKeys(editor, ["x"]);
    expect(editor.getText()).toBe("x");
    expect(editor.getRegister()).toBe("😀");
  });
});

// ---------------------------------------------------------------------------
// Underscore motion — _ (first non-whitespace, linewise with operators)
// ---------------------------------------------------------------------------

describe("underscore motion — _ (first non-whitespace)", () => {
  it("_ moves to first non-whitespace char on indented line", () => {
    const { editor } = createEditorWithSpy("   hello");
    sendKeys(editor, ["_"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("_ on line with no leading whitespace stays at col 0", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["_"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("_ from mid-line moves back to first non-whitespace", () => {
    const { editor } = createEditorWithSpy("   hello world");
    sendKeys(editor, ["w", "w"]);
    sendKeys(editor, ["_"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("_ stays in normal mode", () => {
    const { editor } = createEditorWithSpy("   hello");
    sendKeys(editor, ["_"]);
    expect(editor.getMode()).toBe("normal");
  });
});

describe("counted underscore motion — {count}_", () => {
  it("2_ moves down one line then to first non-whitespace", () => {
    const { editor } = createMultiLineEditor("foo\n   bar\nbaz");
    sendKeys(editor, ["2", "_"]);
    expect(editor.getCursor()).toEqual({ line: 1, col: 3 });
  });

  it("1_ is same as plain _", () => {
    const { editor } = createEditorWithSpy("   hello");
    sendKeys(editor, ["1", "_"]);
    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
  });

  it("counted _ clamps at last line", () => {
    const { editor } = createMultiLineEditor("foo\n   bar");
    sendKeys(editor, ["9", "_"]);
    expect(editor.getCursor()).toEqual({ line: 1, col: 3 });
  });

  it("3_ skips wrapped visual rows and lands on the target logical line", () => {
    const wrappedLine = "x".repeat(200);
    const { editor } = createMultiLineEditor(`top\n${wrappedLine}\n  bottom`);
    sendKeys(editor, ["3", "_"]);
    expect(editor.getCursor()).toEqual({ line: 2, col: 2 });
  });
});

describe("operator + underscore — d_ / c_ / y_ (linewise)", () => {
  it("d_ deletes entire current line (linewise)", () => {
    const { editor } = createMultiLineEditor("hello\nworld\nfoo");
    sendKeys(editor, ["d", "_"]);
    expect(editor.getText()).toBe("world\nfoo");
    expect(editor.getRegister()).toBe("hello\n");
  });

  it("d3_ deletes 3 lines", () => {
    const { editor } = createMultiLineEditor("a\nb\nc\nd\ne");
    sendKeys(editor, ["d", "3", "_"]);
    expect(editor.getText()).toBe("d\ne");
    expect(editor.getRegister()).toBe("a\nb\nc\n");
  });

  it("c_ changes current line and enters insert mode", () => {
    const { editor } = createMultiLineEditor("hello\nworld");
    sendKeys(editor, ["c", "_"]);
    expect(editor.getMode()).toBe("insert");
    // Line content should be cleared but line preserved
  });

  it("y_ yanks current line without mutation", () => {
    const { editor } = createMultiLineEditor("hello\nworld");
    const before = editor.getText();
    sendKeys(editor, ["y", "_"]);
    expect(editor.getRegister()).toBe("hello\n");
    expect(editor.getText()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Replace — r{char}
// ---------------------------------------------------------------------------

describe("replace — r{char}", () => {
  it("ra replaces char at cursor", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["r", "a"]);
    expect(editor.getText()).toBe("aello");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("r replaces char in middle of word", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["l", "l", "r", "x"]);
    expect(editor.getText()).toBe("hexlo");
    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("r replaces a surrogate pair without splitting it", () => {
    const { editor } = createEditorWithSpy("😀x");
    sendKeys(editor, ["r", "a"]);
    expect(editor.getText()).toBe("ax");
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("r accepts a single grapheme made of multiple code points", () => {
    const replacement = "e\u0301";
    const { editor } = createEditorWithSpy("abc");
    sendKeys(editor, ["r", replacement]);
    expect(editor.getText()).toBe(`${replacement}bc`);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it("3rx replaces 3 chars", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["3", "r", "x"]);
    expect(editor.getText()).toBe("xxxlo");
    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
  });

  it("r + Escape cancels", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["r", "\x1b"]);
    expect(editor.getText()).toBe("hello");
    expect(editor.getMode()).toBe("normal");
  });

  it("5rx on short line cancels (not enough chars)", () => {
    const { editor } = createEditorWithSpy("hi");
    sendKeys(editor, ["5", "r", "x"]);
    expect(editor.getText()).toBe("hi");
  });

  it("r stays in normal mode", () => {
    const { editor } = createEditorWithSpy("hello");
    sendKeys(editor, ["r", "a"]);
    expect(editor.getMode()).toBe("normal");
  });

  it("r does not affect register", () => {
    const { editor } = createEditorWithSpy("hello");
    editor.setRegister("untouched");
    sendKeys(editor, ["r", "a"]);
    expect(editor.getRegister()).toBe("untouched");
  });
});
