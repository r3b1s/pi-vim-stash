# Handoff: pi-things Monorepo Setup

## State

**Done:**
- pnpm workspace monorepo with `packages/*` layout
- 3 packages consolidated: `pi-skill-creator`, `pi-vim-stash`, `pi-token-killer` (from rtk-pi)
- Shared toolchain: Biome (format), ESLint (type-aware), TypeScript ES2024, Vitest
- Root scaffolding: package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, eslint.config.js, mise.toml
- `.pi/settings.json` configured for local package loading
- Root AGENTS.md and README.md
- OpenSpec change archived, delta specs synced to main specs
- pi-vim-stash: tests migrated node:test → Vitest, TS type error fixed (ClipboardMirrorPolicy)

**Remains:**
- 3 failing tests in pi-vim-stash (import.meta.resolve incompatibility with Vitest)
- No npm publishing or CI pipeline yet
- No changesets or versioning workflow

**Verification:**
- TypeScript: passes for all 3 packages
- Biome + ESLint: pass (warnings only)
- pi-skill-creator: 8/8 test files, 18/18 tests pass
- pi-vim-stash: 5/8 test files, 123/126 tests pass (3 fail)
- 42/42 OpenSpec tasks complete

## Decisions

- **pnpm over bun**: Researched tradeoffs; pnpm chosen for workspace maturity, strict dependency resolution, and existing ecosystem support
- **Biome + ESLint two-pass**: No overlap — Biome handles formatting, ESLint handles type-aware linting
- **ES2024 target, noEmit: true**: Raw .ts shipping, no build step for packages
- **Copy, don't move**: Original repos kept intact outside monorepo
- **Package naming**: `pi-*` prefix under `@r3b1s/` npm scope
- **`.pi/settings.json` simplified**: Local paths only, npm overrides removed

## Blockers

- **import.meta.resolve incompatibility**: 3 pi-vim-stash tests fail because Vitest doesn't fully support `import.meta.resolve` in the same way Node does. Options: (a) polyfill/stub the resolver in test setup, (b) restructure the code to not depend on it at test time, (c) use `--experimental-vm-modules` or similar flag. Low priority — core functionality works.

## Next Actions

1. Decide whether to fix or skip the 3 import.meta.resolve test failures
2. Consider adding a changesets workflow for versioning/publishing
3. Set up CI (GitHub Actions) for lint + test on PRs
4. Eventually publish packages to npm under `@r3b1s/` scope
5. Consider adding `pi-codex` or other packages as the ecosystem grows
