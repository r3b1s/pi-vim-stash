import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentTracker } from "#src/tracker";

// We will mock the session parser for pollForCompletion tests
const analyzeSessionFileMock = vi.fn();
vi.mock("#src/session-parser", () => ({
  analyzeSessionFile: analyzeSessionFileMock,
}));

// Mock fs.watch for watchForCompletion tests; all other fs functions stay real
const watchMock = vi.fn();
vi.mock("node:fs", async () => ({
  ...(await vi.importActual<typeof import("node:fs")>("node:fs")),
  watch: watchMock,
}));

// Re-import after mock setup
let pollForCompletion: typeof import("#src/session-monitor").pollForCompletion;
let monitorSubagent: typeof import("#src/session-monitor").monitorSubagent;
let watchForCompletion: typeof import("#src/session-monitor").watchForCompletion;
let MAX_POLL_TIME_MS: number;
let MAX_STALE_POLLS: number;
let WATCH_TIMEOUT_MS: number;
let FALLBACK_POLL_INTERVAL_MS: number;
let FALLBACK_MAX_STALE_POLLS: number;

describe("pollForCompletion", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    // Re-mock and re-import
    vi.doMock("#src/session-parser", () => ({
      analyzeSessionFile: analyzeSessionFileMock,
    }));
    const mod = await import("#src/session-monitor");
    pollForCompletion = mod.pollForCompletion;
    monitorSubagent = mod.monitorSubagent;
    watchForCompletion = mod.watchForCompletion;
    MAX_POLL_TIME_MS = mod.MAX_POLL_TIME_MS;
    MAX_STALE_POLLS = mod.MAX_STALE_POLLS;
    WATCH_TIMEOUT_MS = mod.WATCH_TIMEOUT_MS;
    FALLBACK_POLL_INTERVAL_MS = mod.FALLBACK_POLL_INTERVAL_MS;
    FALLBACK_MAX_STALE_POLLS = mod.FALLBACK_MAX_STALE_POLLS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns completed=true when session file shows completion with stable entries", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-1",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    analyzeSessionFileMock.mockReturnValue({
      completed: true,
      result: "Task done",
      entryCount: 5,
      lastUserTimestamp: Date.now(),
      lastAssistantTimestamp: Date.now(),
    });

    const result = await pollForCompletion(
      tracker,
      "agent-1",
      "/fake/path.jsonl",
      undefined,
      10_000, // maxPollTimeMs
      100, // maxStalePolls (won't trigger)
    );

    expect(result.completed).toBe(true);
    expect(result.result).toBe("Task done");

    const record = tracker.get("agent-1");
    expect(record?.status).toBe("completed");
    expect(record?.result).toBe("Task done");
  });

  it("waits for inactivity grace period before declaring completion", async () => {
    vi.useFakeTimers();
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-2",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    // Return completed with stable entry count
    analyzeSessionFileMock.mockReturnValue({
      completed: true,
      result: "Final result",
      entryCount: 3,
      lastUserTimestamp: Date.now(),
      lastAssistantTimestamp: Date.now(),
    });

    const pollPromise = pollForCompletion(
      tracker,
      "agent-2",
      "/fake/path.jsonl",
      undefined,
      60_000,
      100,
    );

    // Advance past the inactivity grace period (3s) plus poll interval (500ms)
    await vi.advanceTimersByTimeAsync(4_000);

    const result = await pollPromise;
    expect(result.completed).toBe(true);
    expect(result.result).toBe("Final result");

    vi.useRealTimers();
  });

  it("returns error when max poll time is exceeded", async () => {
    vi.useFakeTimers();
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-3",
      type: "implementer",
      prompt: "test",
      status: "starting",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    // Never complete — just return not-completed
    analyzeSessionFileMock.mockReturnValue({
      completed: false,
      result: undefined,
      entryCount: 1,
    });

    const pollPromise = pollForCompletion(
      tracker,
      "agent-3",
      "/fake/path.jsonl",
      undefined,
      2_000, // very short timeout: 2 seconds
      100, // high stale limit so timeout triggers first
    );

    await vi.advanceTimersByTimeAsync(3_000);

    const result = await pollPromise;
    expect(result.completed).toBe(false);
    expect(result.result).toBeUndefined();

    const record = tracker.get("agent-3");
    expect(record?.status).toBe("error");
    expect(record?.error).toContain("timed out");
    vi.useRealTimers();
  });

  it("returns error when stale no-progress is detected", async () => {
    vi.useFakeTimers();
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-4",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    // Return not-completed with same entry count every time
    analyzeSessionFileMock.mockReturnValue({
      completed: false,
      result: undefined,
      entryCount: 2,
    });

    // Low stale poll limit: 3 polls = ~1500ms
    const pollPromise = pollForCompletion(
      tracker,
      "agent-4",
      "/fake/path.jsonl",
      undefined,
      60_000, // generous timeout so staleness triggers first
      3, // trigger after 3 stale polls
    );

    // Advance past 3 poll cycles
    await vi.advanceTimersByTimeAsync(3_000);

    const result = await pollPromise;
    expect(result.completed).toBe(false);
    expect(result.result).toBeUndefined();

    const record = tracker.get("agent-4");
    expect(record?.status).toBe("error");
    expect(record?.error).toContain("stalled");
    vi.useRealTimers();
  });

  it("stops polling when abort signal is received", async () => {
    vi.useFakeTimers();
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-5",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    // Never complete
    analyzeSessionFileMock.mockReturnValue({
      completed: false,
      result: undefined,
      entryCount: 1,
    });

    const controller = new AbortController();
    const pollPromise = pollForCompletion(
      tracker,
      "agent-5",
      "/fake/path.jsonl",
      controller.signal,
      60_000,
      100,
    );

    // Let one poll cycle complete, then abort while the function is
    // suspended at the next await sleep(POLL_INTERVAL_MS).
    await vi.advanceTimersByTimeAsync(600);
    controller.abort();

    // Advance timers again so the suspended sleep resolves and the
    // while-loop checks the now-aborted signal.
    await vi.advanceTimersByTimeAsync(600);

    const result = await pollPromise;
    expect(result.completed).toBe(false);
    expect(result.result).toBeUndefined();

    const record = tracker.get("agent-5");
    expect(record?.status).toBe("stopped");
    vi.useRealTimers();
  });

  it("resets stale counter when entry count changes", async () => {
    vi.useFakeTimers();
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-6",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    // First 2 polls: same entry count (stale=2), then entry count changes
    // After reset, continue returning with progress to avoid hitting stale
    analyzeSessionFileMock
      .mockReturnValueOnce({
        completed: false,
        result: undefined,
        entryCount: 1,
      })
      .mockReturnValueOnce({
        completed: false,
        result: undefined,
        entryCount: 1,
      })
      .mockReturnValueOnce({
        completed: false,
        result: undefined,
        entryCount: 2, // progress! resets stale to 0
      })
      .mockReturnValue({
        completed: false,
        result: undefined,
        entryCount: 2, // keep returning to avoid further triggers
      });

    const controller = new AbortController();
    // Stale limit is 3, so 2 stale polls + reset should not trigger
    const pollPromise = pollForCompletion(
      tracker,
      "agent-6",
      "/fake/path.jsonl",
      controller.signal,
      60_000,
      3,
    );

    // Advance past 4 poll cycles (~2000ms fake time):
    //   1st: entryCount=1, stalePolls=0 (reset from 0)
    //   2nd: entryCount=1, stalePolls=1
    //   3rd: entryCount=2 (progress!), stalePolls=0 (reset)
    //   4th: entryCount=2, stalePolls=1
    // ← function enters sleep(500). stalePolls=1 (< maxStalePolls=3)
    await vi.advanceTimersByTimeAsync(2_000);

    // Abort while function is suspended in sleep(500)
    controller.abort();
    await vi.advanceTimersByTimeAsync(600);

    const result = await pollPromise;
    expect(result.completed).toBe(false);
    expect(result.result).toBeUndefined();

    const record = tracker.get("agent-6");
    // Should be "stopped" (not "error"), confirming the stale counter
    // was reset before it could reach the limit of 3
    expect(record?.status).toBe("stopped");
    vi.useRealTimers();
  });
});

describe("monitorSubagent", () => {
  it("handles startup timeout when session file never appears", async () => {
    // Fake BOTH timers and Date so that Date.now() used inside
    // waitForSessionFile advances with vi.advanceTimersByTimeAsync.
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "setInterval"] });
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-startup",
      type: "implementer",
      prompt: "test",
      status: "starting",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    const pollPromise = monitorSubagent(
      tracker,
      "agent-startup",
      "/nonexistent/session-dir",
    );

    // Advance past MAX_STARTUP_WAIT_MS (10,000ms)
    await vi.advanceTimersByTimeAsync(11_000);

    const result = await pollPromise;
    expect(result.completed).toBe(false);
    expect(result.result).toBeUndefined();
    const record = tracker.get("agent-startup");
    expect(record?.status).toBe("error");
    expect(record?.error).toContain("Session file not found");

    vi.useRealTimers();
  });
});

describe("constants", () => {
  it("MAX_POLL_TIME_MS is 5 minutes", () => {
    expect(MAX_POLL_TIME_MS).toBe(300_000);
  });

  it("MAX_STALE_POLLS is 30", () => {
    expect(MAX_STALE_POLLS).toBe(30);
  });

  it("WATCH_TIMEOUT_MS is 30 seconds", () => {
    expect(WATCH_TIMEOUT_MS).toBe(30_000);
  });

  it("FALLBACK_POLL_INTERVAL_MS is 1 second", () => {
    expect(FALLBACK_POLL_INTERVAL_MS).toBe(1_000);
  });

  it("FALLBACK_MAX_STALE_POLLS is 60", () => {
    expect(FALLBACK_MAX_STALE_POLLS).toBe(60);
  });
});

describe("watchForCompletion", () => {
  let watcher: EventEmitter & { close: () => void };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.restoreAllMocks();
    // Our top-level vi.mock("node:fs") is still active. Set up the mock
    // watcher so watchForCompletion can start.
    watcher = new EventEmitter() as EventEmitter & { close: () => void };
    watcher.close = vi.fn();
    // Mock fs.watch: return a controllable watcher and automatically
    // register the callback as a "change" listener (matching real behavior)
    watchMock.mockImplementation(
      (_dirPath: string, callback: (...args: unknown[]) => void) => {
        watcher.on("change", callback);
        return watcher;
      },
    );
    // Re-mock session-parser (restoreAllMocks cleared analyzeSessionFileMock)
    vi.doMock("#src/session-parser", () => ({
      analyzeSessionFile: analyzeSessionFileMock,
    }));
    const mod = await import("#src/session-monitor");
    watchForCompletion = mod.watchForCompletion;
    pollForCompletion = mod.pollForCompletion;
    monitorSubagent = mod.monitorSubagent;
    MAX_POLL_TIME_MS = mod.MAX_POLL_TIME_MS;
    WATCH_TIMEOUT_MS = mod.WATCH_TIMEOUT_MS;
    FALLBACK_POLL_INTERVAL_MS = mod.FALLBACK_POLL_INTERVAL_MS;
    FALLBACK_MAX_STALE_POLLS = mod.FALLBACK_MAX_STALE_POLLS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("detects completion via fs.watch events with inactivity grace", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-watch",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    const watchPromise = watchForCompletion(
      tracker,
      "agent-watch",
      "/fake/path.jsonl",
    );

    // Let microtasks settle so watcher is fully attached
    await vi.advanceTimersByTimeAsync(10);

    // First event: detects completion with entryCount=5
    analyzeSessionFileMock.mockReturnValue({
      completed: true,
      result: "Task done",
      entryCount: 5,
      lastUserTimestamp: Date.now(),
      lastAssistantTimestamp: Date.now(),
    });
    watcher.emit("change", "change", "path.jsonl");

    // Second event: stable entryCount (5 === 5) — starts grace timer
    watcher.emit("change", "change", "path.jsonl");

    // Advance in stages: past the inactivity grace period (3s) + buffer
    for (let step = 0; step < 8; step++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    const result = await watchPromise;
    expect(result.completed).toBe(true);
    expect(result.result).toBe("Task done");

    const record = tracker.get("agent-watch");
    expect(record?.status).toBe("completed");
    expect(record?.result).toBe("Task done");
    expect(watcher.close).toHaveBeenCalled();
  });

  it("resets grace timer when entry count changes during grace", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-grace",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    const watchPromise = watchForCompletion(
      tracker,
      "agent-grace",
      "/fake/path.jsonl",
    );
    await vi.advanceTimersByTimeAsync(10);

    // First event: completed, entryCount=5
    analyzeSessionFileMock.mockReturnValue({
      completed: true,
      result: "First",
      entryCount: 5,
    });
    watcher.emit("change", "change", "path.jsonl");

    // Second event: same entryCount → should start grace timer
    watcher.emit("change", "change", "path.jsonl");
    await vi.advanceTimersByTimeAsync(1_000);

    // Before grace expires, emit with changed entryCount
    analyzeSessionFileMock.mockReturnValue({
      completed: true,
      result: "Revised",
      entryCount: 6,
    });
    watcher.emit("change", "change", "path.jsonl");

    // Now stable again → grace restarts
    analyzeSessionFileMock.mockReturnValue({
      completed: true,
      result: "Revised",
      entryCount: 6,
    });
    watcher.emit("change", "change", "path.jsonl");

    // Advance in stages past full grace period (3s from last stable)
    for (let step = 0; step < 8; step++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    const result = await watchPromise;
    expect(result.completed).toBe(true);
    // Should get the revised result (entryCount=6), not the first
    expect(result.result).toBe("Revised");

    const record = tracker.get("agent-grace");
    expect(record?.status).toBe("completed");
    expect(record?.result).toBe("Revised");
  });

  it("falls back to polling after WATCH_TIMEOUT_MS without events", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-poll",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    // Return completed on the second poll (first sets entryCount)
    analyzeSessionFileMock
      .mockReturnValueOnce({
        completed: true,
        result: "Poll result",
        entryCount: 2,
      })
      .mockReturnValue({
        completed: true,
        result: "Poll result",
        entryCount: 2,
      });

    const watchPromise = watchForCompletion(
      tracker,
      "agent-poll",
      "/fake/path.jsonl",
    );

    // Advance past watch timeout (30s) → fallback to polling
    // After fallback, polling at 1s interval. First poll sets
    // lastEntryCount=2, second poll starts grace, 3s grace → resolved.
    await vi.advanceTimersByTimeAsync(35_000);

    const result = await watchPromise;
    expect(result.completed).toBe(true);
    expect(result.result).toBe("Poll result");

    // Watcher should have been closed during fallback
    expect(watcher.close).toHaveBeenCalled();

    const record = tracker.get("agent-poll");
    expect(record?.status).toBe("completed");
    expect(record?.result).toBe("Poll result");
  });

  it("falls back to polling when fs.watch emits an error", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-err",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    analyzeSessionFileMock
      .mockReturnValueOnce({
        completed: true,
        result: "Error fallback",
        entryCount: 2,
      })
      .mockReturnValue({
        completed: true,
        result: "Error fallback",
        entryCount: 2,
      });

    const watchPromise = watchForCompletion(
      tracker,
      "agent-err",
      "/fake/path.jsonl",
    );
    await vi.advanceTimersByTimeAsync(10);

    // Emit error on watcher → triggers fallback to polling
    watcher.emit("error", new Error("watch error"));

    // Now in polling mode (1s interval). First poll sets lastEntryCount,
    // second starts grace, 3s grace → resolved.
    await vi.advanceTimersByTimeAsync(6_000);

    const result = await watchPromise;
    expect(result.completed).toBe(true);
    expect(result.result).toBe("Error fallback");
    expect(watcher.close).toHaveBeenCalled();
  });

  it("falls back to polling when fs.watch setup throws", async () => {
    // Clear the default mock return so watch throws
    watchMock.mockReset();
    watchMock.mockImplementation(() => {
      throw new Error("ENOSPC");
    });

    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-fail",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    analyzeSessionFileMock
      .mockReturnValueOnce({
        completed: true,
        result: "Setup fail fallback",
        entryCount: 2,
      })
      .mockReturnValue({
        completed: true,
        result: "Setup fail fallback",
        entryCount: 2,
      });

    const watchPromise = watchForCompletion(
      tracker,
      "agent-fail",
      "/fake/path.jsonl",
    );

    // Immediate fallback to polling + poll cycles + grace
    await vi.advanceTimersByTimeAsync(6_000);

    const result = await watchPromise;
    expect(result.completed).toBe(true);
    expect(result.result).toBe("Setup fail fallback");
  });

  it("handles abort signal during watch phase", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-abort",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    const controller = new AbortController();
    const watchPromise = watchForCompletion(
      tracker,
      "agent-abort",
      "/fake/path.jsonl",
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(10);

    controller.abort();
    await vi.advanceTimersByTimeAsync(10);

    const result = await watchPromise;
    expect(result.completed).toBe(false);
    expect(result.result).toBeUndefined();

    const record = tracker.get("agent-abort");
    expect(record?.status).toBe("stopped");
    expect(watcher.close).toHaveBeenCalled();
  });

  it("returns stopped immediately when signal is already aborted", async () => {
    const tracker = new SubagentTracker();
    tracker.add({
      id: "agent-pre",
      type: "implementer",
      prompt: "test",
      status: "running",
      sessionName: "test-session",
      windowIndex: 0,
      configDir: "/tmp",
      startedAt: Date.now(),
    });

    const controller = new AbortController();
    controller.abort();

    const result = await watchForCompletion(
      tracker,
      "agent-pre",
      "/fake/path.jsonl",
      controller.signal,
    );

    expect(result.completed).toBe(false);
    const record = tracker.get("agent-pre");
    expect(record?.status).toBe("stopped");
  });
});
