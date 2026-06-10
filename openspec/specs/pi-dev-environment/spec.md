## Purpose

Defines how the monorepo integrates with Pi for local development, including settings configuration, agent conventions, and documentation standards.

## Requirements

### Requirement: .pi/settings.json loads local packages for development
A `.pi/settings.json` file SHALL exist at the repo root. It SHALL list each package as a local path entry (e.g., `"../packages/pi-skill-creator/"`) and as an npm entry with `"extensions": [], "skills": []` to disable the npm version. This ensures Pi loads extensions from local source during development.

#### Scenario: Pi loads extensions from local source
- **WHEN** `pi` is started from the repo root
- **THEN** extensions from all three packages are loaded from their local `packages/` directories (not from npm)

#### Scenario: npm versions are disabled
- **WHEN** `.pi/settings.json` is loaded
- **THEN** npm entries with empty `extensions` and `skills` arrays prevent double-loading from the registry

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
