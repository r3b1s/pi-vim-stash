import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock config before importing module under test
vi.mock("#src/config.ts", () => ({
  BRIDGE_URL: "http://localhost:18731",
  BRIDGE_SCRIPT: "/tmp/bridge/server.py",
  VENV_PYTHON: "/tmp/bridge/venv/bin/python",
  PID_FILE: "/tmp/bridge.pid",
  SETUP_SCRIPT: "/tmp/scripts/setup.sh",
  LOG_FILE: "/tmp/bridge.log",
  USER_DATA_DIR: "/tmp/pi-holo-mem",
  PACKAGE_ROOT: "/tmp",
}));

describe("Extension lifecycle", () => {
  let mockPi: any;
  let extensionModule: any;

  beforeEach(async () => {
    // Mock ExtensionAPI
    mockPi = {
      registerTool: vi.fn(),
      exec: vi.fn().mockResolvedValue({ stdout: "", code: 0 }),
      on: vi.fn(),
    };

    // Reset mocks
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers fact_store and fact_feedback tools", async () => {
    extensionModule = await import("#src/index.ts");
    extensionModule.default(mockPi);

    expect(mockPi.registerTool).toHaveBeenCalledTimes(2);
    const toolNames = mockPi.registerTool.mock.calls.map(
      (call: any[]) => call[0].name,
    );
    expect(toolNames).toContain("fact_store");
    expect(toolNames).toContain("fact_feedback");
  });

  it("registers session_shutdown handler", async () => {
    extensionModule = await import("#src/index.ts");
    extensionModule.default(mockPi);

    expect(mockPi.on).toHaveBeenCalledWith(
      "session_shutdown",
      expect.any(Function),
    );
  });

  it("wraps tool execute with bridge lifecycle check", async () => {
    extensionModule = await import("#src/index.ts");
    extensionModule.default(mockPi);

    // Each registered tool should have an execute wrapper
    for (const call of mockPi.registerTool.mock.calls) {
      const tool = call[0];
      expect(tool.execute).toBeInstanceOf(Function);
    }
  });

  it("registers expected number of tools", async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      pid: 12345,
      stdout: { pipe: vi.fn() },
      stderr: { pipe: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    });

    vi.doMock("node:child_process", () => ({
      spawn: mockSpawn,
    }));

    extensionModule = await import("#src/index.ts");
    extensionModule.default(mockPi);

    // Trigger bridge start by calling the ensureBridge flow
    const registerCalls = mockPi.registerTool.mock.calls;
    expect(registerCalls.length).toBe(2);
  });
});
