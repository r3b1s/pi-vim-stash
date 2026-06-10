## ADDED Requirements

### Requirement: pnpm workspace configuration
The monorepo SHALL use pnpm 9+ workspaces with `packages/*` layout. The root `package.json` SHALL be `"private": true` with `"packageManager"` field specifying the pnpm version. `pnpm-workspace.yaml` SHALL define `packages: ["packages/*"]` with `linkWorkspacePackages: false` and a `catalog:` section for centralized dependency versions.

#### Scenario: Workspace resolves packages
- **WHEN** `pnpm install` is run from the repo root
- **THEN** all packages under `packages/` are linked as workspace packages and dependencies resolve from the catalog

#### Scenario: Cross-package imports use registry
- **WHEN** package A imports package B
- **THEN** the import resolves from the npm registry (not workspace symlink) because `linkWorkspacePackages` is false

### Requirement: Three packages copied into packages/
The three source repositories (`pi-skill-creator`, `pi-vim-stash`, `rtk-pi`) SHALL be copied into `packages/pi-skill-creator/`, `packages/pi-vim-stash/`, and `packages/rtk-pi/` respectively. Original repositories SHALL NOT be modified or deleted.

#### Scenario: pi-skill-creator copied with structure preserved
- **WHEN** the copy is complete
- **THEN** `packages/pi-skill-creator/` contains `src/`, `skills/`, `third_party/`, `openspec/`, and all source files from the original repo

#### Scenario: pi-vim-stash restructured to src/
- **WHEN** pi-vim-stash is copied
- **THEN** flat `.ts` files (`index.ts`, `stash.ts`, `motions.ts`, etc.) are moved into `packages/pi-vim-stash/src/` and `test/` files are moved to `packages/pi-vim-stash/test/`

#### Scenario: rtk-pi copied with source moved to src/
- **WHEN** rtk-pi is copied
- **THEN** `index.ts` and `rewrite.ts` are in `packages/rtk-pi/src/` and `rtk.md` is preserved

#### Scenario: Original repos untouched
- **WHEN** the consolidation is complete
- **THEN** the original repos at `~/Local/personal/pi-skill-creator/`, `~/Local/personal/pi-vim-stash/`, and `~/Local/personal/rtk-pi/` are unchanged

### Requirement: Package names scoped to @r3b1s
All packages SHALL use the `@r3b1s/pi-*` npm scope. Each `package.json` SHALL have `"name": "@r3b1s/pi-<name>"` and `"publishConfig": { "access": "public" }`.

#### Scenario: Package names resolve correctly
- **WHEN** `pnpm install` completes
- **THEN** workspace packages are accessible as `@r3b1s/pi-skill-creator`, `@r3b1s/pi-vim-stash`, and `@r3b1s/rtk-pi`

### Requirement: mise manages tool versions
`mise.toml` at the repo root SHALL declare `node = "22"` and `pnpm = "9"` under `[tools]`. Running `mise install` SHALL provision these tools.

#### Scenario: mise install provisions environment
- **WHEN** `mise install` is run from the repo root
- **THEN** Node.js 22 and pnpm 9 are installed and available on PATH

#### Scenario: mise tasks provide dev commands
- **WHEN** `mise run ci` is executed
- **THEN** typecheck, lint, and test tasks run in parallel

### Requirement: Per-package AGENTS.md redirect stubs
Each package directory SHALL contain an `AGENTS.md` file that warns if Pi is started from a subdirectory and redirects to the repo root.

#### Scenario: Agent started from package subdirectory
- **WHEN** Pi is started from `packages/pi-vim-stash/`
- **THEN** the AGENTS.md instructs the agent to launch from the repo root instead

### Requirement: Licenses preserved
Each package SHALL retain its original license. `pi-skill-creator` SHALL remain Apache-2.0. `pi-vim-stash` and `rtk-pi` SHALL remain MIT.

#### Scenario: License files present
- **WHEN** the consolidation is complete
- **THEN** each package has a LICENSE file matching its original license
