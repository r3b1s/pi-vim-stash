## Purpose

Defines how the monorepo integrates with Pi for local development, including settings configuration, agent conventions, and documentation standards.

## MODIFIED Requirements

### Requirement: .pi/settings.json loads local packages for development

**Previous behavior**: A `.pi/settings.json` file SHALL exist at the repo root listing each package as a local path entry.

**New behavior**: Local packages are loaded through `scripts/pi-dev`, which reads `.pi-dev/dev-sources.json` and generates an isolated config workspace. The `.pi/` directory is fully gitignored and no longer tracks package paths.

#### Scenario: Dev packages loaded via scripts/pi-dev
- **WHEN** `scripts/pi-dev` is invoked
- **THEN** local packages listed in `.pi-dev/dev-sources.json` SHALL be loaded into the dev pi environment through the merged `.pi-dev/settings.json`

#### Scenario: .pi/settings.json no longer loads packages
- **WHEN** `pi` is started from the repo root without `scripts/pi-dev`
- **THEN** local packages are NOT automatically loaded — use `scripts/pi-dev` for the development environment

### Requirement: .pi/ directory fully gitignored

The `.pi/` directory SHALL be fully gitignored via `**/.pi/**`. Existing tracked files (prompts, skills, retros, settings.json) are removed from git tracking.

#### Scenario: Existing tracked files removed from git
- **WHEN** the change is implemented
- **THEN** all `.pi/` files are removed from git tracking via `git rm --cached`

#### Scenario: No new .pi/ files tracked
- **WHEN** any new file is created under `.pi/`
- **THEN** it SHALL be ignored by git

## ADDED Requirements

### Requirement: Retros migrated to .pi-dev/retros/

Existing retrospectives SHALL be moved from `.pi/retros/` to `.pi-dev/retros/` and remain tracked there.

#### Scenario: Retros exist in new location
- **WHEN** the change is implemented
- **THEN** `.pi-dev/retros/` contains the retrospective files previously in `.pi/retros/`

### Requirement: Root AGENTS.md defines monorepo conventions
A root `AGENTS.md` SHALL document: monorepo structure (pnpm workspace, `packages/*` layout), how to run commands (`pnpm -r run check/test/lint`, `mise run ci`), code style (TypeScript ES2024, Biome + ESLint split, conflict workarounds), and commit conventions (Conventional Commits).

#### Scenario: Agent understands monorepo structure
- **WHEN** Pi reads the root AGENTS.md
- **THEN** it knows to use `pnpm -r` or `pnpm --filter` for commands and understands the Biome/ESLint split

#### Scenario: AGENTS.md scoped to Level 0
- **WHEN** AGENTS.md is reviewed
- **THEN** it does NOT contain multi-session issue lifecycle, retro file format, pre-completion reviewer, or session naming conventions (those are Level 3 workflow concerns)

### Requirement: Package openspec directories preserved
Each package's `openspec/` directory (if present) SHALL be preserved in the monorepo package directory. The root `openspec/` directory SHALL contain monorepo-level change tracking.

#### Scenario: pi-skill-creator openspec preserved
- **WHEN** pi-skill-creator is copied to the monorepo
- **THEN** `packages/pi-skill-creator/openspec/` contains its specs and config

#### Scenario: Root openspec tracks monorepo changes
- **WHEN** monorepo-level changes are proposed
- **THEN** they are tracked in the root `openspec/` directory

### Requirement: toolchain-research.md documents deferred tools
A `toolchain-research.md` file SHALL exist at the repo root documenting research findings for deferred tools: fallow (dead code analysis), prek (git hooks), rumdl (markdown lint), and release-please (release automation). Each tool entry SHALL include what it does, why it's deferred, and when to adopt it.

#### Scenario: Research preserved for future reference
- **WHEN** a contributor considers adopting fallow or release-please
- **THEN** `toolchain-research.md` provides the research context needed to make that decision

#### Scenario: File is temporary
- **WHEN** deferred tools are either adopted or permanently decided against
- **THEN** `toolchain-research.md` should be removed

### Requirement: No commits generated during implementation
The implementation of this change SHALL NOT generate any git commits. All file creation and restructuring is done as working tree changes only.

#### Scenario: Working tree has changes but no commits
- **WHEN** implementation is complete
- **THEN** `git log` shows no new commits and `git status` shows uncommitted changes
