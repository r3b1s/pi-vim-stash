## Context

pi-holographic-memory is a standalone Pi extension repo at `~/Local/personal/pi-holographic-memory/`. It provides structured fact storage with HRR-based compositional reasoning via a Python FastAPI bridge server. The TypeScript extension auto-starts the bridge as a child process and communicates over HTTP.

The extension has already been prepared for monorepo alignment: TypeScript configs, Biome, ESLint, pnpm, import style, path aliases, and package naming all match pi-things conventions. The remaining work is structural migration and runtime externalization.

This is the first pi-things package with a Python runtime component, introducing a new pattern for the monorepo.

## Goals / Non-Goals

**Goals:**
- Migrate pi-holographic-memory into `packages/pi-holo-mem/` with all source, tests, and specs
- Externalize all runtime state to `~/.pi/agent/pi-holo-mem/` (venv, DB, PID, logs)
- Drop standalone tooling — monorepo root covers everything
- Bring openspec specs into the package as package-level specs
- Preserve all existing behavior with zero functional changes

**Non-Goals:**
- Improving or refactoring the holographic memory extension itself
- Adding Python testing infrastructure to the monorepo (Python tests stay in the package)
- Setting up CI for Python components at the monorepo level
- Cleaning up or archiving the source repo (left as-is)

## Decisions

### Package directory name: `pi-holo-mem`

Shorter than `pi-holographic-memory` while still descriptive. Matches the pattern of other package names (`pi-vim-stash`, `pi-token-killer`).

**Alternatives considered:**
- `pi-holographic-memory` — too long, inconsistent with other package name lengths
- `pi-holo` — too vague, doesn't convey "memory"

### Full externalization of runtime state (Option C)

All runtime artifacts live at `~/.pi/agent/pi-holo-mem/`:
- `python/venv/` — Python virtual environment
- `memory_store.db` — SQLite database (already externalized)
- `bridge.pid` — bridge process PID file
- `bridge.log` — bridge log file

The package directory contains only source code. No runtime artifacts in the package dir.

**Rationale:**
- Cleanest separation: source in repo, state on user's machine
- `config.ts` becomes purely `homedir()`-based — no `PROJECT_ROOT` resolution needed for runtime paths
- Consistent with how the DB was already externalized
- Avoids `.gitignore` entries for runtime files in package dir

**Alternatives considered:**
- Option A (keep as-is): Runtime files in package dir — pollutes source tree
- Option B (partial): Only PID/log externalized — inconsistent, venv still in package dir

### Python source stays in package

`python/bridge/`, `python/upstream/`, `scripts/` ship with the package as source code. They're version-controlled artifacts, not runtime state. The `scripts/setup.sh` creates the venv in the externalized location (`~/.pi/agent/pi-holo-mem/python/venv/`).

### Package-level openspec specs (applies to ALL packages)

Each package CAN have its own `openspec/` directory. The openspec CLI discovers specs from CWD, so running from a package directory finds that package's specs. The monorepo root `openspec/` continues to hold monorepo-level specs.

```
pi-things/
├── openspec/                     # monorepo specs (monorepo-structure, shared-toolchain, etc.)
└── packages/
    ├── pi-holo-mem/
    │   └── openspec/             # package specs (bridge-server, fact-storage, etc.)
    │       ├── specs/
    │       └── changes/
    ├── pi-skill-creator/         # may also have package-level openspec/
    ├── pi-vim-stash/
    └── pi-token-killer/
```

**Convention (documented in AGENTS.md):** `cd` into the package directory to work with package-level specs. Running from repo root sees monorepo specs; running from package dir sees package specs.

**Trade-off:** Agent skills need to be aware of this scoping. This is a workflow convention, not a technical limitation. Every package in the monorepo follows the same rule.

### config.ts rewrite

Replace `PROJECT_ROOT`-based paths with `homedir()`-based paths:

```typescript
// Before (PROJECT_ROOT based)
export const BRIDGE_SCRIPT = join(PROJECT_ROOT, "python", "bridge", "server.py");
export const VENV_PYTHON = join(PROJECT_ROOT, "python", "venv", "bin", "python");
export const PID_FILE = join(PROJECT_ROOT, "bridge.pid");
export const LOG_FILE = join(PROJECT_ROOT, "bridge.log");

// After (homedir based, using dirname(import.meta.url) only for source-relative paths)
const USER_DATA_DIR = join(homedir(), ".pi", "agent", "pi-holo-mem");

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SETUP_SCRIPT = join(PACKAGE_ROOT, "scripts", "setup.sh");
export const BRIDGE_SCRIPT = join(PACKAGE_ROOT, "python", "bridge", "server.py");
export const VENV_PYTHON = join(USER_DATA_DIR, "python", "venv", "bin", "python");
export const PID_FILE = join(USER_DATA_DIR, "bridge.pid");
export const LOG_FILE = join(USER_DATA_DIR, "bridge.log");
export const DB_PATH = join(USER_DATA_DIR, "memory_store.db");
```

> **Note on ordering:** `USER_DATA_DIR` is declared before any exports that reference it to avoid temporal dead zone issues. `PACKAGE_ROOT` (source-relative) is declared after `USER_DATA_DIR` since it doesn't depend on it.

**Full list of config.ts constant changes:**
- `USER_DATA_DIR` — NEW: `join(homedir(), ".pi", "agent", "pi-holo-mem")`
- `PACKAGE_ROOT` — RENAMED from `PROJECT_ROOT`: `dirname(dirname(fileURLToPath(import.meta.url)))`
- `BRIDGE_URL` — KEPT: uses `BRIDGE_PORT`, env var changes to `PIHOLOMEM_BRIDGE_PORT`
- `BRIDGE_SCRIPT` — KEPT: source-relative, `join(PACKAGE_ROOT, "python", "bridge", "server.py")`
- `SETUP_SCRIPT` — NEW: `join(PACKAGE_ROOT, "scripts", "setup.sh")`
- `VENV_PYTHON` — CHANGED: `join(USER_DATA_DIR, "python", "venv", "bin", "python")`
- `PID_FILE` — CHANGED: `join(USER_DATA_DIR, "bridge.pid")`
- `LOG_FILE` — CHANGED: `join(USER_DATA_DIR, "bridge.log")`
- `DB_PATH` — CHANGED: `join(USER_DATA_DIR, "memory_store.db")` (was `pi-holographic-memory`, now `pi-holo-mem`)
- `PROJECT_ROOT` — REMOVED entirely
```

Source-relative paths (bridge script, setup script) still use `import.meta.url`. Runtime paths (venv, PID, log, DB) use `homedir()`.

### pnpm-workspace.yaml allowBuilds

The source repo needs `allowBuilds` for `@google/genai`, `esbuild`, `protobufjs`. The monorepo root `pnpm-workspace.yaml` already has these entries — no change needed, but verify during migration.

### scripts/setup.sh updated for externalization

The setup script creates the venv at `~/.pi/agent/pi-holo-mem/python/venv/` instead of `python/venv/` inside the package. This is the only script change needed — `sync-upstream.sh` operates on package source and doesn't touch runtime state.

### Environment variable unification

Both TypeScript and Python sides use a unified `PIHOLOMEM_*` prefix:

| Variable | Value | Used by |
|---|---|---|
| `PIHOLOMEM_BRIDGE_PORT` | Bridge server port (e.g. `9876`) | TypeScript, Python |
| `PIHOLOMEM_DB_PATH` | Path to SQLite database | Python (fallback) |

The old env vars (`PI_HOLOGRAPHIC_DB_PATH`, `PI_HOLOGRAPHIC_PORT`) are replaced. No backward compatibility — alpha stage, 0 users.

### Pre-existing bug fixes: threshold parameter and 4xx retry

Two bugs identified during migration review are fixed as part of this change:

**Expose `threshold` parameter in TypeScript tool schema:**
- Add `threshold` as an optional float parameter (default `0.0`) to `FactStoreParams` in `src/types.ts`
- Add `threshold` to the tool schema in `src/tools/fact-store.ts`
- The Python bridge already accepts this parameter — the TypeScript side just wasn't exposing it

**Remove 4xx retry logic in client.ts:**
- The HTTP client unconditionally retried on 4xx client errors (e.g. 404 Not Found, 422 Validation Error)
- 4xx responses indicate a caller mistake, not a transient failure — retrying is incorrect
- Only retry on 5xx server errors or network-level failures

### Port conflict retry loop

When multiple Pi sessions start concurrently, both may attempt to spawn the bridge server on the same port. The second spawn will fail on bind. Resolution strategy:

1. Before spawning, check for a PID file at `~/.pi/agent/pi-holo-mem/bridge.pid`
2. If PID file exists and `/health` responds, connect to existing bridge (don't spawn)
3. If no PID file, spawn the bridge and wait for health check
4. If spawn succeeds but port bind fails (detected via health check timeout), re-check whether another bridge is now running
5. Retry loop: check PID file → health check → spawn → health check → re-check (max 3 attempts)

This approach handles the concurrent-session race without locking, which is appropriate for an alpha-stage extension.

### TypeScript config: typebox alias

The source repo uses `typebox` as an import alias for `@sinclair/typebox` in vitest.config.ts. Two options:
- **Option A (carry forward):** Keep the `typebox` alias in `package.json` `imports` field and vitest.config.ts
- **Option B (clean):** Change all imports from `"typebox"` to `"@sinclair/typebox"` directly

**Decision:** Option B — change all imports to `@sinclair/typebox` directly. Cleaner, no alias indirection, one less thing to maintain. The `verify` task includes a grep to confirm no `typebox` alias imports remain.

### Monorepo config: .pi/settings.json packages list

The `.pi/settings.json` file at repo root lists packages for Pi extension discovery. After migration, `"./packages/pi-holo-mem"` must be added (or uncommented if already present). This ensures the Pi agent discovers the extension when loading the monorepo.

### Openspec discoverability convention for all packages

This applies to ALL packages in the monorepo, not just pi-holo-mem. Each package may have its own `openspec/` directory with package-level specs. The convention is:

> **cd into the package directory to work with package-level specs.**

The openspec CLI discovers specs from the current working directory. Running from repo root sees monorepo specs; running from `packages/pi-holo-mem/` sees that package's specs. This is documented in `AGENTS.md`.

### Python version pin

Add `python = "3.11"` to the root `mise.toml` under `[tools]`. This pins the Python version for the holographic memory bridge (and any future Python components). The setup script uses `mise` to provision the pinned version before creating the venv.

## Risks / Trade-offs

**[Risk] Python venv path change breaks existing installs** → Users who already have a venv at the old location will need to re-run setup. Mitigation: `index.ts` already detects missing venv and runs setup automatically.

**[Risk] Package-level openspec not discoverable from agent context** → If the agent always runs from repo root, it won't see package-level specs. Mitigation: Document the convention; agent skills can be updated to `cd` into package dirs when working on package-specific changes.

**[Risk] `@google/genai` build dep may cause issues** → This dependency requires `allowBuilds` and may have platform-specific build steps. Mitigation: Already handled in monorepo's pnpm-workspace.yaml.

**[Trade-off] Full externalization means more paths to manage** → Six paths in config.ts instead of two. But each path is explicit and self-documenting, and the separation is clean.

**[Trade-off] Python tests not integrated into monorepo CI** → `pnpm -r run test` only runs Vitest, not pytest. Python tests remain a manual step. Acceptable for now — Python is a secondary runtime in this package.
