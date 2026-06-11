/**
 * Bridge to pi-subagents-deterministic (PSD).
 *
 * PSD is an optional peer dependency. When present, PTS calls
 * setSpawner() on PSD to inject the tmux spawn mechanism, and
 * setResultProvider() to inject the tracker-based result lookup.
 * When absent, PTS runs in standalone mode.
 *
 * The Spawner interface is defined locally (matching PSD's export)
 * so that this module compiles even when PSD is not installed.
 */

/**
 * Spawner interface matching PSD's `Spawner` export.
 *
 * PSD's Spawner interface signature:
 *   spawn(agentType: string, prompt: string, options: SpawnOptions): string | Promise<string>
 */
export interface Spawner {
  spawn(
    agentType: string,
    prompt: string,
    options: Record<string, unknown>,
  ): string | Promise<string>;
}

/**
 * Shape of the PSD API that PTS interacts with at runtime.
 */
export interface PsdApi {
  setSpawner: (spawner: Spawner) => void;
  setResultProvider: (provider: {
    getResult: (agentId: string) => Promise<{
      content: { type: "text"; text: string }[];
      details: unknown;
    } | null>;
  }) => void;
}

/**
 * Dynamically import PSD with retry for loading order race.
 * Retries up to 3 times with 200ms interval.
 *
 * Returns the PSD module's API surface if found, or undefined.
 */
export async function importPsd(): Promise<PsdApi | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Dynamic import — PSD is optional, this will fail gracefully at
      // runtime if PSD is not installed.
      const mod = await import("@r3b1s/pi-subagents-deterministic");
      if (
        mod &&
        typeof (mod as Record<string, unknown>).setSpawner === "function"
      ) {
        return mod;
      }
    } catch {
      // Not loaded yet — wait and retry
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return undefined;
}
