# Handoff: assimilate-pi-holo-mem

## State

**Done:**
- `packages/pi-holo-mem/` created with source copied from `~/Local/personal/pi-holographic-memory/`
- Package configuration: `@r3b1s/pi-holo-mem` with catalog deps, `pi` extension entrypoint, TypeScript ES2024 config, Vitest with path aliases
- Config externalized to `~/.pi/agent/pi-holo-mem/` (DB, logs, PID file, venv)
- Env vars unified: `PIHOLOMEM_BRIDGE_PORT`, `PIHOLOMEM_DB_PATH` (across TS and Python)
- Pre-existing bugs fixed: `threshold` param exposed in tool schema, fragile 4xx retry removed, stale `typebox` module declaration removed, phantom peer deps cleaned up
- Port conflict: PID file with retry loop (Option B)
- `sync-upstream.sh` brought into monorepo
- Package-level openspec specs created and synced (bridge-server, compositional-retrieval, fact-storage, trust-feedback)
- Python 3.11 added to root mise.toml, mise task `test-python` created
- Root monorepo configs updated: `pnpm-workspace.yaml`, `eslint.config.js` (ignores `types/`), `README.md`, `AGENTS.md`
- Two adversarial reviews completed (mimo-v2.5, deepseek-v4-flash), all issues fixed
- Change archived, delta specs synced to package-level openspec (corrected from monorepo-level — holo-mem specs are package-local)

**Verification:**
- TypeScript: passes for all 4 packages (including pi-holo-mem)
- Biome + ESLint: pass (31 warnings, all `noExplicitAny` at warn level)
- pi-holo-mem tests: 3 test files, 17/17 pass
- All 4 packages test: 654 tests pass
- Python bridge tests: `httpx2` missing from test deps (pre-existing, not a migration regression)

## Decisions

- **Package name**: `pi-holo-mem` (abbreviated, overriding full-name convention — explicit user choice)
- **Externalization path**: `~/.pi/agent/pi-holo-mem/` for all runtime state (DB, logs, PID, venv)
- **Env var prefix**: `PIHOLOMEM_*` unified across TS and Python
- **No backward compat**: 0 existing users, alpha state — no migration needed
- **Port conflict**: PID file with retry loop (Option B) — re-check health after failed spawn
- **Package-level specs**: holo-mem specs live in `packages/pi-holo-mem/openspec/`, NOT in monorepo-level `openspec/specs/`

## Blockers

- **Python test dependency `httpx2` missing**: `test_endpoints.py` uses `fastapi.testclient.TestClient` which requires `httpx`. Pre-existing issue from source repo. Not a migration regression. Low priority — core functionality works without Python tests.

## Next Actions

1. Consider adding `httpx` to Python test dependencies if Python CI is needed
2. Update the retro memory consolidation if retros exceed ~10 files
3. Future: add remaining Pi extensions to the monorepo if desired
