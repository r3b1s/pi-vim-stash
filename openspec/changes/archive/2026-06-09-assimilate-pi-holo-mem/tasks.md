## 1. Copy source files to monorepo

- [x] 1.1 Create `packages/pi-holo-mem/` directory
- [x] 1.2 Copy `src/` from source repo to `packages/pi-holo-mem/src/`
- [x] 1.3 Copy `test/` from source repo to `packages/pi-holo-mem/test/`
- [x] 1.4 Copy `python/` from source repo to `packages/pi-holo-mem/python/` (bridge, upstream, tests, requirements.txt)
      **Exclude** `python/venv/`, `python/__pycache__/`, `python/.pytest_cache/` from copy
- [x] 1.5 Copy `scripts/` from source repo to `packages/pi-holo-mem/scripts/`
- [x] 1.6 Copy `types/` from source repo to `packages/pi-holo-mem/types/`
- [x] 1.7 Copy `plugin.yaml` from source repo to `packages/pi-holo-mem/plugin.yaml`
- [x] 1.8 Copy `README.md` and `KNOWN_ISSUES.md` from source repo
- [x] 1.9 Copy `scripts/sync-upstream.sh` explicitly (source management script, not tooling config)

## 2. Drop standalone tooling configs

**Files to NOT copy (tooling configs — monorepo root covers these):**
- [x] 2.1 `.npmrc`
- [x] 2.2 `biome.json`
- [x] 2.3 `eslint.config.js`
- [x] 2.4 `vitest.config.ts` (will rewrite to monorepo pattern)
- [x] 2.5 `.mise.toml`
- [x] 2.6 `pnpm-workspace.yaml`
- [x] 2.7 `.gitignore`
- [x] 2.8 `pnpm-lock.yaml`

**Files that ARE copied but are NOT tooling configs:**
- [x] 2.9 `scripts/sync-upstream.sh` (source management script)
- [x] 2.10 `types/ambient.d.ts` (type declarations)
- [x] 2.11 `KNOWN_ISSUES.md` (documentation)

**Other items to NOT copy:**
- [x] 2.12 Do NOT copy `.pi/skills/` or `.pi/prompts/` (already in monorepo, source copies are outdated)

## 3. Rewrite package.json for monorepo

- [x] 3.1 Create `packages/pi-holo-mem/package.json` with name `@r3b1s/pi-holo-mem`
- [x] 3.2 Set `publishConfig.access` to `"public"`
- [x] 3.3 Set scripts: `check` (tsc --noEmit), `lint` (eslint src/ test/), `test` (vitest run)
- [x] 3.4 Switch devDependencies to `catalog:` references for typescript, vitest, @types/node, eslint, typescript-eslint, @biomejs/biome
- [x] 3.5 Keep `@sinclair/typebox` as devDependency (not in catalog — package-specific)
- [x] 3.6 Set peerDependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai` all `"*"`
- [x] 3.7 Set `imports` field with `#src/*`, `#test/*`, and `"typebox": "@sinclair/typebox"` aliases
- [x] 3.8 Set `pi.extensions` to `["./src/index.ts"]`
- [x] 3.9 Set `engines.node` to `">=22"`, `license` to `"MIT"`
- [x] 3.10 Remove `packageManager` (monorepo root handles this). Explicitly REMOVE `pnpm.onlyBuiltDependencies` — this is dead config that lists packages not in the dependency tree

## 3b. Fix pre-existing bugs during migration

- [x] 3b.1 Expose `threshold` parameter in `src/types.ts` FactStoreParams interface (optional float, default `0.0`)
- [x] 3b.2 Add `threshold` to the tool schema in `src/tools/fact-store.ts`
- [x] 3b.3 Remove 4xx retry logic in `src/client.ts` — only retry on 5xx or network errors

## 4. Rewrite tsconfig.json

- [x] 4.1 Create `packages/pi-holo-mem/tsconfig.json` extending `../../tsconfig.base.json`
- [x] 4.2 Add `compilerOptions.paths` for `#src/*` and `#test/*`
- [x] 4.3 Set `include` to `["src/**/*.ts", "types/**/*.d.ts", "test/**/*.ts"]`
- [x] 4.4 Set `exclude` to `["node_modules", "dist"]`

## 5. Rewrite vitest.config.ts

- [x] 5.1 Create `packages/pi-holo-mem/vitest.config.ts` matching monorepo pattern (new URL() for aliases)
- [x] 5.2 Include `#src` and `#test` aliases
- [x] 5.3 Include `typebox` → `@sinclair/typebox` alias (package-specific)

## 6. Externalize runtime state in config.ts

- [x] 6.1 Add `USER_DATA_DIR` constant: `join(homedir(), ".pi", "agent", "pi-holo-mem")` — PLACE THIS BEFORE any exports that reference it
- [x] 6.2 `BRIDGE_SCRIPT` → `join(PACKAGE_ROOT, "python", "bridge", "server.py")` (source-relative, unchanged behavior)
- [x] 6.3 `SETUP_SCRIPT` → `join(PACKAGE_ROOT, "scripts", "setup.sh")` (source-relative, unchanged behavior)
- [x] 6.4 `VENV_PYTHON` → `join(USER_DATA_DIR, "python", "venv", "bin", "python")`
- [x] 6.5 `PID_FILE` → `join(USER_DATA_DIR, "bridge.pid")`
- [x] 6.6 `LOG_FILE` → `join(USER_DATA_DIR, "bridge.log")`
- [x] 6.7 `DB_PATH` → `join(USER_DATA_DIR, "memory_store.db")` (was `pi-holographic-memory`, now `pi-holo-mem`)
- [x] 6.8 `BRIDGE_URL` — keep using `BRIDGE_PORT` but update env var to `PIHOLOMEM_BRIDGE_PORT`
- [x] 6.9 Remove `PROJECT_ROOT` constant entirely (renamed to `PACKAGE_ROOT`)
- [x] 6.10 Update `src/index.ts` to import `USER_DATA_DIR` from config.ts for per-session log paths: `join(USER_DATA_DIR, \`bridge.${pid}.log\`)`
- [x] 6.11 Update `src/index.ts` to remove `PROJECT_ROOT` import (no longer needed)

## 7. Update scripts/setup.sh for externalized venv

- [x] 7.1 Change `VENV_DIR` to `~/.pi/agent/pi-holo-mem/python/venv`
- [x] 7.2 Update `requirements.txt` path to `python/requirements.txt` (relative to package root)
- [x] 7.3 Ensure script creates `~/.pi/agent/pi-holo-mem/` directory if it doesn't exist

## 7b. Update Python bridge for unified path and env vars

- [x] 7b.1 Update `python/bridge/server.py` fallback DB path from `pi-holographic-memory` to `pi-holo-mem`
- [x] 7b.2 Update `python/bridge/server.py` env var from `PI_HOLOGRAPHIC_DB_PATH` to `PIHOLOMEM_DB_PATH`
- [x] 7b.3 Update `python/bridge/server.py` env var from `PI_HOLOGRAPHIC_PORT` to `PIHOLOMEM_BRIDGE_PORT`

## 8. Add package scaffolding

- [x] 8.1 Create `packages/pi-holo-mem/AGENTS.md` redirect stub (matches monorepo convention)
- [x] 8.2 Create `packages/pi-holo-mem/LICENSE` (MIT)
- [x] 8.3 Add vestigial comment to top of `python/__init__.py`: `"Vestigial Hermes MemoryProvider plugin. Retained for upstream sync compatibility. Not used by Pi extension."` (keep all 444 lines of existing code)

## 8b. Root monorepo config updates

- [x] 8b.1 Add `python = "3.11"` to root `mise.toml` under `[tools]`
- [x] 8b.2 Add Python entries to root `.gitignore`: `__pycache__/`, `*.pyc`, `*.pyo`, `*.pyd`, `.pytest_cache/`
- [x] 8b.3 Update root `AGENTS.md` structure listing to include 4th package `pi-holo-mem`
- [x] 8b.4 Uncomment and add `"./packages/pi-holo-mem"` to `.pi/settings.json` packages list
- [x] 8b.5 Add mise task `test-python` to `mise.toml` that runs pytest in a throwaway venv (do NOT wire into the main `ci` task)
- [x] 8b.6 Fix `pnpm-workspace.yaml` `allowBuilds` placeholder strings to actual booleans (`false`) — currently uses `"false"` string literals

## 9. Bring in openspec specs

- [x] 9.1 Create `packages/pi-holo-mem/openspec/config.yaml` for package-level openspec
- [x] 9.2 Copy `openspec/specs/bridge-server/` → `packages/pi-holo-mem/openspec/specs/bridge-server/`
- [x] 9.3 Copy `openspec/specs/fact-storage/` → `packages/pi-holo-mem/openspec/specs/fact-storage/`
- [x] 9.4 Copy `openspec/specs/compositional-retrieval/` → `packages/pi-holo-mem/openspec/specs/compositional-retrieval/`
- [x] 9.5 Copy `openspec/specs/trust-feedback/` → `packages/pi-holo-mem/openspec/specs/trust-feedback/`
- [x] 9.6 Update bridge-server spec to reflect externalized runtime paths
- [x] 9.7 Archive or skip `restructure-for-pi-things` change (already implemented)

## 9b. Document openspec convention

- [x] 9b.1 Add note to root `AGENTS.md` about package-level openspec convention: "Each package may have its own `openspec/` directory. cd into the package dir to work with package-level specs."

## 10. Monorepo config adjustments

- [x] 10.1 Verify `pnpm-workspace.yaml` `allowBuilds` has `@google/genai`, `esbuild`, `protobufjs` (already present — confirm)
- [x] 10.2 Verify `eslint.config.js` ignores cover `python/` directory within packages
- [x] 10.3 Verify `biome.json` ignores cover `python/` directory

## 11. Verify

- [x] 11.1 Run `pnpm install` from monorepo root — no errors
- [x] 11.2 Run `pnpm --filter @r3b1s/pi-holo-mem run check` — TypeScript passes
- [x] 11.3 Run `pnpm --filter @r3b1s/pi-holo-mem run lint` — ESLint passes
- [x] 11.4 Run `pnpm --filter @r3b1s/pi-holo-mem run test` — Vitest passes
- [x] 11.5 Run `pnpm run check` — all packages pass
- [x] 11.6 Run `pnpm run lint` — all packages pass
- [x] 11.7 Run `pnpm run test` — all packages pass
- [x] 11.8 `grep -r 'pi-holographic-memory' packages/pi-holo-mem/` returns zero matches
- [x] 11.9 `grep -r 'PROJECT_ROOT' packages/pi-holo-mem/src/` returns zero matches
- [x] 11.10 `grep -r 'PI_HOLOGRAPHIC' packages/pi-holo-mem/` returns zero matches
- [x] 11.11 Verify `python/venv/`, `python/__pycache__/`, `python/.pytest_cache/` do NOT exist in the copied package
- [x] 11.12 `mise run test-python` passes

## 12. Update README

- [x] 12.1 Update package README.md for new paths (`pi-holo-mem` instead of `pi-holographic-memory`)
- [x] 12.2 Update structure section to reflect `python/` subdirectory layout
- [x] 12.3 Update setup instructions for externalized venv location (`~/.pi/agent/pi-holo-mem/python/venv/`)
