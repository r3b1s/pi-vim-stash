## Context

Three independent Pi extension repositories exist at `~/Local/personal`:

- **pi-skill-creator** (Apache-2.0): Pi-native skill creator extension with OpenSpec specs, bundled skills, Vitest tests, `src/` structure
- **pi-vim-stash** (MIT): Vim-style modal editing + prompt stash, flat `.ts` files, Biome + ESLint + node:test
- **rtk-pi** (MIT): RTK CLI proxy extension, 2 source files, no tests, no build tooling

These repos have inconsistent tooling (different TypeScript targets, different test runners, different lint setups) and no shared configuration. The goal is to consolidate into a pnpm monorepo following patterns from `gotgenes/pi-packages`, establishing a foundation for future CI/CD and npm publishing.

## Goals / Non-Goals

**Goals:**

- Consolidate three repos into a single pnpm workspace monorepo
- Standardize toolchain: TypeScript ES2024, Biome + ESLint, Vitest, mise (full)
- Establish patterns for adding future packages (extensible structure)
- Configure `.pi/settings.json` for local development with Pi
- Create AGENTS.md conventions for monorepo navigation
- Document deferred tools in `toolchain-research.md` for future adoption

**Non-Goals:**

- CI/CD pipelines (GitHub Actions, release-please) — deferred
- npm publishing automation — deferred
- Splitting pi-vim-stash's `index.ts` — relocate first, refactor later
- Adding tests to rtk-pi — no test harness now
- Agentic workflow (slash commands, multi-session lifecycle) — Level 0 only
- Moving original repos — copies only, originals left intact

## Decisions

### D1: pnpm workspaces with catalogs

**Decision**: Use pnpm 9+ workspaces with `catalog:` for centralized dependency versions.

**Why**: pnpm is the standard for JS monorepos (used by gotgenes, Vercel, etc.). The `catalog:` feature prevents version drift across packages — one place to update `typescript` version instead of editing 3 package.json files. `linkWorkspacePackages: false` (gotgenes pattern) forces packages to be self-contained and testable against published siblings.

**Alternatives considered**:
- Bun workspaces: Faster installs but diverges from Pi ecosystem (Pi is Node.js-based), missing `--provenance` for npm publishing, and Bun as a runtime doesn't help since extensions run under Pi's jiti
- npm workspaces: Simpler but no catalog feature, weaker isolation

### D2: mise for full dev environment management

**Decision**: Use mise for tool versions (node, pnpm), environment (.env, PATH), and task runner.

**Why**: mise replaces nvm/volta/asdf + direnv + just/Makefile in one binary. The task runner provides parallel execution, dependency graphs, source-aware reruns, and watch mode. `jdx/mise-action@v3` in CI replaces multiple `actions/setup-*` steps. Auto-activation on `cd` ensures consistent environments.

**Alternatives considered**:
- Minimal mise (gotgenes pattern — PATH injection only): Less to learn but leaves tool version management to CI actions and tasks to pnpm scripts (sequential, no parallelism)
- just/Makefile for tasks: Separate tool, no integration with tool versions

### D3: Biome + ESLint split (zero-overlap)

**Decision**: Biome handles formatting + non-type-aware lint. ESLint handles type-aware lint only (`recommendedTypeCheckedOnly`).

**Why**: This is the proven gotgenes pattern. Biome is ~35x faster than Prettier and handles formatting + basic lint in one tool. ESLint's type-aware rules (`no-floating-promises`, `no-unnecessary-condition`, etc.) require the TypeScript type checker, which Biome can't do. Using `TypeCheckedOnly` ESLint configs guarantees zero overlap.

**Alternatives considered**:
- ESLint only: Slower, more config files, but simpler toolchain
- Biome only: Can't do type-aware linting — dealbreaker for TypeScript monorepos

### D4: Vitest as unified test runner

**Decision**: Standardize on Vitest for all packages. Migrate pi-vim-stash from `node:test`.

**Why**: Vitest provides smart watch mode (module-graph-aware, only reruns affected tests), `--typecheck` flag (can replace separate `tsc --noEmit`), Jest-compatible assertions, module mocking with hoisting, and coverage with thresholds. pi-skill-creator already uses it. The migration from `node:test` is straightforward (assert → expect, t.mock → vi.mock).

**Alternatives considered**:
- node:test: Zero dependencies but weaker mocking, no smart watch, no integrated typecheck, no coverage thresholds

### D5: ES2024 target uniformly

**Decision**: All packages target ES2024 in tsconfig.base.json with `noEmit: true`.

**Why**: Since extensions ship raw `.ts` (loaded by Pi's jiti), `target` only affects type definitions, not output. ES2024 unlocks typed access to `Promise.withResolvers()`, `Object.groupBy()`, `Map.groupBy()`, `Array.fromAsync()`, and Set methods. All packages declare `engines: { node: ">=22" }` and Node 22+ supports all ES2024 features natively.

**Alternatives considered**:
- ES2022 (pi-skill-creator's current): Misses ES2023/2024 APIs
- ES2023 (pi-vim-stash's current): Misses ES2024 APIs

### D6: Copy repos, don't move

**Decision**: Copy source files from original repos into `packages/`. Leave original repos intact.

**Why**: Preserves the originals as working references. The monorepo is a new home, not a replacement. If anything goes wrong during migration, the originals are untouched.

### D7: Per-package AGENTS.md redirect stubs

**Decision**: Each package gets a 4-line AGENTS.md that warns if Pi is started from a subdirectory and redirects to the root.

**Why**: Pi discovers `.pi/` and `AGENTS.md` from the working directory. Starting Pi from a package subdirectory means no settings, no prompts, no skills. The stub is a cheap guardrail (gotgenes uses the same pattern across all 7 packages).

### D8: toolchain-research.md as temporary reference

**Decision**: Create a `toolchain-research.md` in the repo root documenting deferred tools (fallow, prek, rumdl, release-please) with research findings.

**Why**: The exploration produced detailed research on these tools. Capturing it in the repo preserves the research for future adoption decisions. The file is temporary — it should be removed once the tools are either adopted or permanently deferred.

## Risks / Trade-offs

**[Risk] pi-vim-stash test migration introduces bugs** → Mitigation: The 9 test files use simple `assert.*` patterns. Migration is mechanical (assert → expect). Run tests before and after to verify behavior is preserved.

**[Risk] Divergence from gotgenes patterns** → Mitigation: We're following gotgenes closely (Biome+ESLint split, per-package AGENTS stubs, .pi/settings.json pattern, .gitignore template). Divergences are documented (full mise instead of minimal mise).

**[Risk] toolchain-research.md goes stale** → Mitigation: It's explicitly temporary. Remove it once tools are adopted or permanently deferred.

**[Risk] Flat pi-vim-stash source files need restructuring** → Mitigation: Move to `src/` first, don't split `index.ts`. The `pi.extensions` field in package.json just needs the path updated.

**[Trade-off] Full mise adds complexity** → Accepted: mise's task runner provides parallel execution and source-aware reruns that pnpm scripts can't. The single-binary story (one tool for everything) reduces cognitive load long-term.

**[Trade-off] No CI/CD in this change** → Accepted: Getting the structure right is more important than automating releases. The patterns are established for future CI adoption.
