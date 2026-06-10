## Purpose

Defines the pnpm workspace monorepo structure, package layout, tooling management, and conventions for consolidating multiple Pi extension packages into a single repository.

## Requirements

### Requirement: pnpm workspace configuration
The monorepo SHALL use pnpm 9+ workspaces with `packages/*` layout. The root `package.json` SHALL be `"private": true` with `"packageManager"` field specifying the pnpm version. `pnpm-workspace.yaml` SHALL define `packages: ["packages/*"]` with `linkWorkspacePackages: false` and a `catalog:` section for centralized dependency versions.

#### Scenario: Workspace resolves packages
- **WHEN** `pnpm install` is run from the repo root
- **THEN** all packages under `packages/` are linked as workspace packages and dependencies resolve from the catalog

#### Scenario: Cross-package imports use registry
- **WHEN** package A imports package B
- **THEN** the import resolves from the npm registry (not workspace symlink) because `linkWorkspacePackages` is false

### Requirement: Four packages in packages/
Four packages SHALL reside under `packages/`: `pi-skill-creator`, `pi-vim-stash`, `pi-token-killer` (copied from their standalone repos), and `pi-holo-mem` (migrated from `~/Local/personal/pi-holographic-memory/`). Original repositories SHALL NOT be modified or deleted.

**Python runtime pattern:** `pi-holo-mem` introduces a new pattern — Python runtime with a mise task (`test-python`) that runs pytest in a throwaway venv. This task is NOT wired into the main `ci` task. Python remains a secondary runtime in the monorepo.

**Openspec convention:** Each package may have its own `openspec/` directory. cd into the package dir to work with package-level specs. This applies to ALL packages (pi-skill-creator already has one; pi-holo-mem introduces bridge-server, fact-storage, compositional-retrieval, and trust-feedback specs).

#### Scenario: pi-skill-creator copied with structure preserved
- **WHEN** the copy is complete
- **THEN** `packages/pi-skill-creator/` contains `src/`, `skills/`, `third_party/`, `openspec/`, and all source files from the original repo

#### Scenario: pi-vim-stash restructured to src/
- **WHEN** pi-vim-stash is copied
- **THEN** flat `.ts` files (`index.ts`, `stash.ts`, `motions.ts`, etc.) are moved into `packages/pi-vim-stash/src/` and `test/` files are moved to `packages/pi-vim-stash/test/`

#### Scenario: pi-token-killer copied with source moved to src/
- **WHEN** rtk-pi is copied into `packages/pi-token-killer/`
- **THEN** `index.ts` and `rewrite.ts` are in `packages/pi-token-killer/src/` and `rtk.md` is preserved

#### Scenario: pi-holo-mem migrated with externalized runtime
- **WHEN** pi-holographic-memory is migrated into `packages/pi-holo-mem/`
- **THEN** the package contains only source code (`src/`, `test/`, `python/`, `scripts/`, `types/`, `plugin.yaml`) and all runtime state (venv, database, PID, logs) resides at `~/.pi/agent/pi-holo-mem/`

#### Scenario: pi-holo-mem Python source ships with package
- **WHEN** the migration is complete
- **THEN** `packages/pi-holo-mem/python/` contains `bridge/` (FastAPI server), `upstream/` (synced Holographic core), and `requirements.txt`

#### Scenario: Original repos untouched
- **WHEN** the consolidation is complete
- **THEN** the original repos at `~/Local/personal/pi-skill-creator/`, `~/Local/personal/pi-vim-stash/`, `~/Local/personal/rtk-pi/`, and `~/Local/personal/pi-holographic-memory/` are unchanged

### Requirement: Package names scoped to @r3b1s
All packages SHALL use the `@r3b1s/pi-*` npm scope. Each `package.json` SHALL have `"name": "@r3b1s/pi-<name>"` and `"publishConfig": { "access": "public" }`.

#### Scenario: Package names resolve correctly
- **WHEN** `pnpm install` completes
- **THEN** workspace packages are accessible as `@r3b1s/pi-skill-creator`, `@r3b1s/pi-vim-stash`, `@r3b1s/pi-token-killer`, and `@r3b1s/pi-holo-mem`

### Requirement: mise manages tool versions
`mise.toml` at the repo root SHALL declare `pnpm = "11"` and `node = "lts"` under `[tools]` (pnpm listed first to ensure its bin directory takes precedence on PATH over node-bundled corepack pnpm). Running `mise install` SHALL provision these tools.

#### Scenario: mise install provisions environment
- **WHEN** `mise install` is run from the repo root
- **THEN** Node.js LTS and pnpm 11 are installed and available on PATH (pnpm 11 wins over node-bundled corepack pnpm due to PATH ordering)

#### Scenario: pnpm version matches packageManager field
- **WHEN** `pnpm --version` is run from the repo root
- **THEN** it returns a pnpm 11.x version matching the `packageManager` field in root `package.json`

#### Scenario: mise tasks provide dev commands
- **WHEN** `mise run ci` is executed
- **THEN** typecheck, lint, and test tasks run in parallel

### Requirement: Per-package AGENTS.md redirect stubs
Each package directory SHALL contain an `AGENTS.md` file that warns if Pi is started from a subdirectory and redirects to the repo root.

#### Scenario: Agent started from package subdirectory
- **WHEN** Pi is started from `packages/pi-vim-stash/`
- **THEN** the AGENTS.md instructs the agent to launch from the repo root instead

### Requirement: Licenses preserved
Each package SHALL retain its original license. `pi-skill-creator` SHALL remain Apache-2.0. `pi-vim-stash`, `pi-token-killer`, and `pi-holo-mem` SHALL remain MIT.

#### Scenario: License files present
- **WHEN** the consolidation is complete
- **THEN** each package has a LICENSE file matching its original license
