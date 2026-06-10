import { beforeEach, describe, expect, it, vi } from "vitest";

describe("fact_store tool", () => {
  let mockPi: any;
  let registerFactStoreTool: any;

  beforeEach(async () => {
    vi.resetModules();

    mockPi = {
      registerTool: vi.fn(),
    };

    registerFactStoreTool = (await import("#src/tools/fact-store.ts"))
      .registerFactStoreTool;
  });

  it("registers a tool named fact_store", () => {
    const mockClient = { factStore: vi.fn() };
    registerFactStoreTool(mockPi, mockClient);

    expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
    const tool = mockPi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("fact_store");
  });

  it("tool has all expected actions in parameters", () => {
    const mockClient = { factStore: vi.fn() };
    registerFactStoreTool(mockPi, mockClient);

    const tool = mockPi.registerTool.mock.calls[0][0];
    const actionParam = tool.parameters?.properties?.action;
    expect(actionParam).toBeDefined();

    // Should accept all 9 actions
    const allowedActions = actionParam.anyOf || actionParam.oneOf || [];
    const actionValues = allowedActions.map((a: any) => a.const || a.enum?.[0]);
    expect(actionValues).toContain("add");
    expect(actionValues).toContain("search");
    expect(actionValues).toContain("probe");
    expect(actionValues).toContain("related");
    expect(actionValues).toContain("reason");
    expect(actionValues).toContain("contradict");
    expect(actionValues).toContain("update");
    expect(actionValues).toContain("remove");
    expect(actionValues).toContain("list");
  });

  it("execute calls client.factStore and returns JSON result", async () => {
    const mockResult = { status: "ok", fact_id: 42 };
    const mockClient = {
      factStore: vi.fn().mockResolvedValue(mockResult),
    };

    registerFactStoreTool(mockPi, mockClient);
    const tool = mockPi.registerTool.mock.calls[0][0];

    const result = await tool.execute(
      "call-1",
      { action: "add", content: "test fact" },
      new AbortController().signal,
      vi.fn(),
      {},
    );

    expect(mockClient.factStore).toHaveBeenCalledWith({
      action: "add",
      content: "test fact",
    });
    expect(result.content[0].text).toBe(JSON.stringify(mockResult));
  });
});

describe("fact_feedback tool", () => {
  let mockPi: any;
  let registerFactFeedbackTool: any;

  beforeEach(async () => {
    vi.resetModules();

    mockPi = {
      registerTool: vi.fn(),
    };

    registerFactFeedbackTool = (await import("#src/tools/fact-feedback.ts"))
      .registerFactFeedbackTool;
  });

  it("registers a tool named fact_feedback", () => {
    const mockClient = { factFeedback: vi.fn() };
    registerFactFeedbackTool(mockPi, mockClient);

    expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
    const tool = mockPi.registerTool.mock.calls[0][0];
    expect(tool.name).toBe("fact_feedback");
  });

  it("has helpful and unhelpful actions", () => {
    const mockClient = { factFeedback: vi.fn() };
    registerFactFeedbackTool(mockPi, mockClient);

    const tool = mockPi.registerTool.mock.calls[0][0];
    const actionParam = tool.parameters?.properties?.action;
    expect(actionParam).toBeDefined();

    const allowedActions = actionParam.anyOf || actionParam.oneOf || [];
    const actionValues = allowedActions.map((a: any) => a.const || a.enum?.[0]);
    expect(actionValues).toContain("helpful");
    expect(actionValues).toContain("unhelpful");
  });

  it("requires fact_id parameter", () => {
    const mockClient = { factFeedback: vi.fn() };
    registerFactFeedbackTool(mockPi, mockClient);

    const tool = mockPi.registerTool.mock.calls[0][0];
    expect(tool.parameters?.properties?.fact_id).toBeDefined();
  });

  it("execute calls client.factFeedback and returns JSON result", async () => {
    const mockResult = { status: "ok" };
    const mockClient = {
      factFeedback: vi.fn().mockResolvedValue(mockResult),
    };

    registerFactFeedbackTool(mockPi, mockClient);
    const tool = mockPi.registerTool.mock.calls[0][0];

    const result = await tool.execute(
      "call-2",
      { action: "helpful", fact_id: 1 },
      new AbortController().signal,
      vi.fn(),
      {},
    );

    expect(mockClient.factFeedback).toHaveBeenCalledWith({
      action: "helpful",
      fact_id: 1,
    });
    expect(result.content[0].text).toBe(JSON.stringify(mockResult));
  });
});
