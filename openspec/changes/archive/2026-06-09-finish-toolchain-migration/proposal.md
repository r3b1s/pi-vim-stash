# Proposal: Finish Toolchain Migration

## Summary

Complete the remaining migration items uncovered during the pi-things monorepo consolidation. The structural work (pnpm workspace, shared tsconfig/biome/eslint, package layout) is done, but 7 tail items remain — 3 of which block `pnpm -r run test` from passing cleanly.

## Motivation

The monorepo scaffolding was implemented in a previous session, but several package-level issues were deferred or discovered after the fact. Until these are resolved:
- Tests are broken (3 failures in pi-vim-stash)
- pi-token-killer has zero test infrastructure
- Spec compliance is incomplete (missing LICENSE, stale artifacts, config drift)

Getting all packages to a clean, green state is a prerequisite for any future feature work.

## In Scope

1. **pi-vim-stash test failures** — 3 tests fail because `import.meta.resolve()` at module top-level is incompatible with Vitest's SSR transform
2. **pi-skill-creator missing LICENSE** — Apache-2.0 LICENSE file not copied from original repo
3. **pi-token-killer test infrastructure** — no test dir, no vitest.config.ts, no test script, no tests
4. **Stale package-lock.json** — npm artifact in pi-skill-creator (pnpm monorepo)
5. **.pi/settings.json dev workflow** — local packages entries should be commented out so stable npm versions are used during development
6. **Spec + toolchain version alignment** — mise.toml declares pnpm=11 but Node-bundled pnpm 9 wins on PATH; fix PATH priority and update packageManager field to pnpm@11.5.2. Update spec to reflect node=lts, pnpm=11.
7. **Biome lint warnings** — 17 warnings in pi-skill-creator (mostly `noExplicitAny`); fix all properly

## Out of Scope

- CI pipeline setup (Level 1 workflow — separate change)
- Adopting deferred tools (fallow, prek, rumdl, release-please)
- Multi-session issue lifecycle or retro conventions (Level 3 workflow)
- Changes to original standalone repositories

## Affected Packages

| Package | Items |
|---------|-------|
| pi-vim-stash | #1 (test failures) |
| pi-skill-creator | #2 (LICENSE), #4 (package-lock.json), #7 (lint warnings) |
| pi-token-killer | #3 (test infrastructure + tests) |
| Root | #5 (.pi/settings.json), #6 (spec update + PATH fix + packageManager) |

## Success Criteria

- `pnpm -r run check` passes (already green — must stay green)
- `pnpm -r run test` passes with 0 failures
- `pnpm run lint` passes with 0 warnings
- monorepo-structure spec updated to match mise.toml versions
- pnpm 11 actually active (PATH fixed so mise-managed pnpm takes precedence over Node-bundled pnpm 9)
- All packages spec-compliant (LICENSE files, no stale artifacts)

## Risks

- Lazy-evaluating `import.meta.resolve()` in pi-vim-stash changes the module initialization order — need to verify clipboard functionality still works correctly at runtime
- Writing initial tests for pi-token-killer requires understanding the rewrite/token-killer logic from the source code
- Fixing PATH priority for pnpm could affect other projects if mise global settings are modified
