import { describe, expect, it } from "vitest";
import { SubagentTracker } from "#src/tracker";
import type { SubagentRecord } from "#src/types";

function makeRecord(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  return {
    id: "test-id",
    type: "Explore",
    prompt: "test prompt",
    status: "starting",
    sessionName: "_pi-sub-test",
    windowIndex: 0,
    configDir: "/tmp/test",
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("SubagentTracker", () => {
  it("adds and retrieves records", () => {
    const tracker = new SubagentTracker();
    const record = makeRecord();
    tracker.add(record);

    expect(tracker.get("test-id")).toBe(record);
    expect(tracker.get("nonexistent")).toBeUndefined();
  });

  it("updates status", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord());

    expect(tracker.updateStatus("test-id", "completed")).toBe(true);
    expect(tracker.get("test-id")?.status).toBe("completed");
    expect(tracker.get("test-id")?.completedAt).toBeDefined();

    expect(tracker.updateStatus("nonexistent", "completed")).toBe(false);
  });

  it("sets result", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord());

    expect(tracker.setResult("test-id", "task completed")).toBe(true);
    expect(tracker.get("test-id")?.result).toBe("task completed");

    expect(tracker.setResult("nonexistent", "result")).toBe(false);
  });

  it("sets error", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord());

    expect(tracker.setError("test-id", "something failed")).toBe(true);
    expect(tracker.get("test-id")?.error).toBe("something failed");
  });

  it("sets session file path", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord());

    expect(tracker.setSessionFilePath("test-id", "/path/to/file.jsonl")).toBe(
      true,
    );
    expect(tracker.get("test-id")?.sessionFilePath).toBe("/path/to/file.jsonl");
  });

  it("removes records", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord());
    expect(tracker.size).toBe(1);

    expect(tracker.remove("test-id")).toBe(true);
    expect(tracker.get("test-id")).toBeUndefined();
    expect(tracker.size).toBe(0);

    expect(tracker.remove("nonexistent")).toBe(false);
  });

  it("lists all IDs and records", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord({ id: "id1", type: "Explore" }));
    tracker.add(makeRecord({ id: "id2", type: "implementer" }));

    expect(tracker.getAllIds()).toEqual(expect.arrayContaining(["id1", "id2"]));
    expect(tracker.getAll().length).toBe(2);
  });

  it("clears all records", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord({ id: "id1" }));
    tracker.add(makeRecord({ id: "id2" }));
    expect(tracker.size).toBe(2);

    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.getAllIds()).toEqual([]);
  });

  it("tracks size correctly", () => {
    const tracker = new SubagentTracker();
    expect(tracker.size).toBe(0);

    tracker.add(makeRecord({ id: "a" }));
    expect(tracker.size).toBe(1);

    tracker.add(makeRecord({ id: "b" }));
    expect(tracker.size).toBe(2);

    tracker.remove("a");
    expect(tracker.size).toBe(1);
  });

  it("sets completedAt on terminal status transitions", () => {
    const tracker = new SubagentTracker();
    tracker.add(makeRecord({ id: "test" }));

    tracker.updateStatus("test", "completed");
    expect(tracker.get("test")?.completedAt).toBeDefined();

    // Starting again should not change completedAt
    const completedAt = tracker.get("test")?.completedAt;
    tracker.updateStatus("test", "starting");
    expect(tracker.get("test")?.completedAt).toBe(completedAt);
  });
});
