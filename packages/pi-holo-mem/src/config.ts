/**
 * Configuration and path resolution for pi-holo-mem extension.
 *
 * Runtime state (venv, database, PID, logs) is externalized to ~/.pi/agent/pi-holo-mem/.
 * Source-relative paths (bridge script, setup script) use import.meta.url.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Bridge server port (from env or default)
export const BRIDGE_PORT = Number(process.env.PIHOLOMEM_BRIDGE_PORT) || 18731;

// Bridge server URL
export const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`;

// User data directory — all runtime state lives here
// PLACE THIS BEFORE any exports that reference it
export const USER_DATA_DIR = join(homedir(), ".pi", "agent", "pi-holo-mem");

// Package root — resolved from this module's location (src/config.ts → parent)
export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Bridge Python server script (source-relative)
export const BRIDGE_SCRIPT = join(
  PACKAGE_ROOT,
  "python",
  "bridge",
  "server.py",
);

// Setup script path (source-relative)
export const SETUP_SCRIPT = join(PACKAGE_ROOT, "scripts", "setup.sh");

// Python interpreter inside the externalized venv
export const VENV_PYTHON = join(
  USER_DATA_DIR,
  "python",
  "venv",
  "bin",
  "python",
);

// PID file for tracking the bridge process
export const PID_FILE = join(USER_DATA_DIR, "bridge.pid");

// Log file for bridge stdout/stderr (fallback; per-session logs use bridge.{PID}.log)
export const LOG_FILE = join(USER_DATA_DIR, "bridge.log");

// Database path
export const DB_PATH = join(USER_DATA_DIR, "memory_store.db");
