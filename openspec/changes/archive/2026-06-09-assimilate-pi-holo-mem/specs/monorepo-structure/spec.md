## MODIFIED Requirements

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
