## Why

pi-holographic-memory is a standalone Pi extension that provides structured fact storage with compositional reasoning via HRR algebra. It's been prepared for monorepo alignment (TypeScript toolchain, package naming, conventions) but still lives in its own repo. Bringing it into pi-things consolidates all Pi extensions under one roof and gives it the benefit of shared tooling, unified CI, and consistent conventions.

This is also the first package with a Python runtime component (a FastAPI bridge server), which introduces a new pattern for the monorepo: full externalization of runtime state to `~/.pi/agent/`.

## What Changes

- Copy source files from `~/Local/personal/pi-holographic-memory/` into `packages/pi-holo-mem/` (renamed from `pi-holographic-memory`)
- Drop standalone tooling configs (biome.json, eslint.config.js, tsconfig.json, vitest.config.ts, .mise.toml, .npmrc, .gitignore, pnpm-workspace.yaml) — monorepo root covers all of these
- Drop `.pi/skills/` and `.pi/prompts/` — outdated copies of openspec skills already in monorepo
- Rewrite package.json to use `catalog:` deps, drop standalone fields, rename to `@r3b1s/pi-holo-mem`
- Rewrite tsconfig.json to extend `../../tsconfig.base.json`
- Rewrite vitest.config.ts to match monorepo pattern
- Externalize all runtime state from the package directory to `~/.pi/agent/pi-holo-mem/`: Python venv, bridge PID file, bridge log file (database already externalized)
- Bring in openspec specs (bridge-server, fact-storage, compositional-retrieval, trust-feedback) as package-level specs
- Add `allowBuilds` entries for `@google/genai`, `esbuild`, `protobufjs` to monorepo pnpm-workspace.yaml (if not already present)
- Update monorepo-level specs to reflect the new package and Python runtime pattern

## Capabilities

### New Capabilities

- `holo-mem-bridge-server`: Python FastAPI bridge server lifecycle management — auto-start, health checks, crash recovery, graceful shutdown. The bridge wraps upstream Holographic core and exposes HTTP API for TypeScript tools.
- `holo-mem-fact-storage`: 5-action structured fact store (add, search, update, remove, list) with SQLite + FTS5, entity resolution, category tagging, and trust scoring. The remaining 4 actions (probe, related, reason, contradict) are split into a separate spec — see `holo-mem-compositional-retrieval`.
- `holo-mem-compositional-retrieval`: HRR-based compositional queries — probe (all facts about entity), related (structurally adjacent entities), reason (multi-entity composition), contradict (conflict detection).
- `holo-mem-trust-feedback`: Asymmetric trust scoring via fact_feedback tool — helpful (+0.05) and unhelpful (-0.10) signals that shape retrieval priority over time.

### Modified Capabilities

- `monorepo-structure`: Adds fourth package (`pi-holo-mem`), introduces Python runtime pattern with full state externalization to `~/.pi/agent/`

## Impact

- **New package**: `packages/pi-holo-mem/` with TypeScript source, Python bridge source, scripts
- **Runtime externalization**: `~/.pi/agent/pi-holo-mem/` holds venv, DB, PID, log files — no runtime artifacts in package directory
- **pnpm-workspace.yaml**: `allowBuilds` entries for Python-adjacent build deps
- **Monorepo specs updated**: monorepo-structure spec reflects 4 packages and externalized runtime pattern
- **No behavioral changes**: Extension works identically after migration
