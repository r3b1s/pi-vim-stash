/**
 * Pi extension entry point with bridge lifecycle management.
 */

import { type ChildProcess, spawn } from "node:child_process";
import {
  access,
  constants,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { BridgeClient } from "./client.ts";
import {
  BRIDGE_SCRIPT,
  BRIDGE_URL,
  LOG_FILE,
  PID_FILE,
  SETUP_SCRIPT,
  USER_DATA_DIR,
  VENV_PYTHON,
} from "./config.ts";
import { registerFactFeedbackTool } from "./tools/fact-feedback.ts";
import { registerFactStoreTool } from "./tools/fact-store.ts";

export default function (pi: ExtensionAPI) {
  let bridgeProcess: ChildProcess | null = null;
  let currentSessionLogFile: string | null = null;
  let bridgeStarted = false;
  let restartAttempts = 0;
  const maxRestarts = 5;

  const client = new BridgeClient(BRIDGE_URL);

  // Check if bridge is healthy
  async function checkHealth(): Promise<boolean> {
    try {
      const response = await client.health();
      return response.status === "ok" && response.ready;
    } catch {
      return false;
    }
  }

  // Wait for bridge to become healthy with timeout
  async function waitForHealth(timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const healthy = await checkHealth();
      if (healthy) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    return false;
  }

  // Check if venv exists
  async function venvExists(): Promise<boolean> {
    try {
      await access(VENV_PYTHON, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  // Run setup script
  async function runSetup(): Promise<void> {
    console.log("[pi-holo-mem] Running setup script...");
    const { stdout, code } = await pi.exec("bash", [SETUP_SCRIPT]);
    console.log("[pi-holo-mem] Setup output:", stdout);
    if (code !== 0) {
      throw new Error(`Setup script failed with code ${code}`);
    }
  }

  // Start bridge server
  async function startBridge(): Promise<void> {
    if (bridgeStarted) {
      return;
    }

    console.log("[pi-holo-mem] Starting bridge server...");

    // Check if venv exists, run setup if not
    const hasVenv = await venvExists();
    if (!hasVenv) {
      console.log("[pi-holo-mem] venv not found, running setup...");
      await runSetup();
    }

    // Spawn bridge process
    bridgeProcess = spawn(VENV_PYTHON, [BRIDGE_SCRIPT], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Per-session log file named after bridge PID for multi-session isolation
    const sessionLogFile = bridgeProcess.pid
      ? join(USER_DATA_DIR, `bridge.${bridgeProcess.pid}.log`)
      : LOG_FILE;
    currentSessionLogFile = sessionLogFile;

    const logStream = await import("node:fs").then((fs) =>
      fs.createWriteStream(sessionLogFile, { flags: "a" }),
    );

    // Pipe stdout and stderr to log file
    if (bridgeProcess.stdout) {
      bridgeProcess.stdout.pipe(logStream);
    }
    if (bridgeProcess.stderr) {
      bridgeProcess.stderr.pipe(logStream);
    }

    // Write PID file atomically
    if (bridgeProcess.pid) {
      const tempPidFile = join(tmpdir(), `bridge.pid.${process.pid}`);
      await writeFile(tempPidFile, String(bridgeProcess.pid), "utf-8");
      await rename(tempPidFile, PID_FILE); // Atomic on same filesystem
      console.log(`[pi-holo-mem] Bridge started with PID ${bridgeProcess.pid}`);
    }

    bridgeStarted = true;
    restartAttempts = 0;

    // Handle process exit (crash detection)
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    bridgeProcess.on("exit", async (code, signal) => {
      console.log(
        `[pi-holo-mem] Bridge exited with code ${code}, signal ${signal}`,
      );
      bridgeStarted = false;
      bridgeProcess = null;

      // Don't unlink PID file here — will be overwritten atomically by next startBridge()
      // This prevents the race condition where another process sees no PID file

      // Auto-restart if it was an unexpected exit
      if (code !== 0 && restartAttempts < maxRestarts) {
        const delay = 2 ** restartAttempts * 1000; // 1s, 2s, 4s, 8s, 16s
        console.log(
          `[pi-holo-mem] Restarting bridge in ${delay}ms (attempt ${restartAttempts + 1}/${maxRestarts})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        restartAttempts++;
        await startBridge();
      } else if (restartAttempts >= maxRestarts) {
        console.error(
          "[pi-holo-mem] Max restart attempts reached. Bridge not restarted.",
        );
      }
    });

    // Wait for health check
    const healthy = await waitForHealth();
    if (!healthy) {
      throw new Error("Bridge failed to become healthy within timeout");
    }

    console.log("[pi-holo-mem] Bridge is healthy and ready");
  }

  // Ensure bridge is running before tool execution
  async function ensureBridge(): Promise<void> {
    const healthy = await checkHealth();
    if (!healthy) {
      await startBridge();
    }
  }

  // Wrap tool registration to inject bridge lifecycle check
  const _origRegisterTool = pi.registerTool.bind(pi);
  const wrappedRegisterTool = (tool: any) => {
    const originalExecute = tool.execute;
    tool.execute = async function (...args: any[]) {
      await ensureBridge();
      return originalExecute.apply(this, args);
    };
    _origRegisterTool(tool);
  };

  // Register tools with wrapped registration
  registerFactStoreTool(pi, client, wrappedRegisterTool);
  registerFactFeedbackTool(pi, client, wrappedRegisterTool);

  // Handle session shutdown
  pi.on("session_shutdown", async (_event: any, _ctx: any) => {
    console.log("[pi-holo-mem] Session shutdown, stopping bridge...");

    if (bridgeProcess) {
      // Send SIGTERM
      bridgeProcess.kill("SIGTERM");

      // Wait 5 seconds for graceful shutdown
      const shutdownTimeout = 5000;
      const shutdownPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log(
            "[pi-holo-mem] Bridge didn't exit gracefully, sending SIGKILL...",
          );
          bridgeProcess?.kill("SIGKILL");
          resolve();
        }, shutdownTimeout);

        if (bridgeProcess) {
          bridgeProcess.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        }
      });

      await shutdownPromise;

      // Clean up PID file
      try {
        await unlink(PID_FILE);
      } catch {
        // Ignore if file doesn't exist
      }

      // Clean up session log if small (no useful debug info)
      if (currentSessionLogFile) {
        try {
          const logStats = await stat(currentSessionLogFile);
          if (logStats.size < 1024) {
            await unlink(currentSessionLogFile).catch(() => {});
          }
        } catch {
          // File already gone or inaccessible
        }
        currentSessionLogFile = null;
      }

      bridgeStarted = false;
      bridgeProcess = null;
      console.log("[pi-holo-mem] Bridge stopped");
    }
  });
}
