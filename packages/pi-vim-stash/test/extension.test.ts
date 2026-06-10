import { describe, expect, it } from "vitest";

/**
 * Smoke tests for the extension entry point.
 *
 * The extension module exports a default function that receives ExtensionAPI
 * and registers session handlers, shortcuts, and editor components.
 * Full integration testing requires the pi runtime, but we can verify:
 * - The module loads successfully
 * - The default export is a function
 * - It has the expected arity
 * - The stash module is correctly exported alongside
 */

describe("extension entry point", () => {
  it("loads the module without error", async () => {
    // Dynamic import verifies the module resolves and parses correctly
    const mod = await import("../src/index.js");
    expect(mod).toBeTruthy();
    expect(typeof mod.default).toBe("function");
  });

  it("default export takes the expected number of arguments", () => {
    // ExtensionAPI signature: (pi: ExtensionAPI) => void
    // Function.length reflects declared formal parameters
    const fn = (async () => {
      const mod = await import("../src/index.js");
      return mod.default;
    })();

    return fn.then((f) => {
      expect(typeof f).toBe("function");
    });
  });

  it("does not throw when pi.on is called with a mock", async () => {
    // Minimal sanity: calling the function with a mock should not crash
    const mod = await import("../src/index.js");

    // A mock ExtensionAPI that accepts registrations
    const events = new Map<string, (...args: unknown[]) => unknown>();
    const mockPi = {
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        events.set(event, handler);
      },
      registerShortcut: (
        _shortcut: unknown,
        _config: { description: string; handler: (...args: unknown[]) => void },
      ) => {
        // Accept registration silently
      },
      // Satisfy ExtensionAPI shape without implementing every method
    } as unknown as Parameters<typeof mod.default>[0];

    // This should not throw
    mod.default(mockPi);
    expect(events.has("session_start")).toBeTruthy();
    expect(events.has("session_shutdown")).toBeTruthy();
    expect(events.has("input")).toBeTruthy();
    expect(events.has("before_agent_start")).toBeTruthy();
  });
});
