# Tasks: Finish Toolchain Migration

## Quick Fixes

- [x] **Task 1: Copy Apache-2.0 LICENSE to pi-skill-creator**
  - Copy `~/Local/personal/pi-skill-creator/LICENSE` to `packages/pi-skill-creator/LICENSE`
  - Verify file exists and content is correct

- [x] **Task 2: Delete stale package-lock.json + gitignore**
  - Delete `packages/pi-skill-creator/package-lock.json`
  - Add `**/package-lock.json` to root `.gitignore`

- [x] **Task 3: Fix pnpm PATH priority + update versions**
  - Investigate why mise shim resolves to pnpm 9 instead of 11 (Node LTS bundled pnpm wins)
  - Fix mise config so `pnpm = "11"` takes precedence (may need to adjust node install to not include bundled pnpm, or reorder PATH)
  - Update root package.json `packageManager` field to `pnpm@11.5.2`
  - Update `openspec/specs/monorepo-structure/spec.md`: `node = "22"` → `node = "lts"`, `pnpm = "9"` → `pnpm = "11"`
  - Verify: `pnpm --version` returns 11.x

- [x] **Task 4: Comment out local packages in .pi/settings.json**
  - Comment out the `packages` array entries
  - Add toggle comment: `// Local package paths — uncomment to load dev versions`
  - Preserve the rest of the file structure

## Test Fixes

- [x] **Task 5: Lazy-evaluate import.meta.resolve() in pi-vim-stash**
  - Refactor `src/index.ts:305` — wrap `import.meta.resolve()` + helper source strings in memoized getter functions
  - Update all call sites that reference `CLIPBOARD_HELPER_SOURCE` and `CLIPBOARD_READ_HELPER_SOURCE`
  - Run `pnpm --filter @r3b1s/pi-vim-stash run test` — verify all ~568 tests pass (~123 previously passing + 11 from clipboard-policy-editor suite + ~431 from modal-editor suite + 3 previously failing)
  - Verify clipboard functionality still works correctly at runtime (no initialization order issues)

- [x] **Task 6: Scaffold pi-token-killer test infrastructure**
  - Add `vitest.config.ts` with `#src` and `#test` path aliases (match pattern from other packages)
  - Add `"test": "vitest run"` to `package.json` scripts
  - Add `"vitest": "catalog:"` to devDependencies in package.json
  - Add `"eslint": "catalog:"` and `"typescript-eslint": "catalog:"` to devDependencies in package.json
  - Add `#test/*` path alias to `tsconfig.json`
  - Create empty `test/` directory with a placeholder test to verify infrastructure works
  - Run `pnpm --filter @r3b1s/pi-token-killer run test` — verify vitest runs

- [x] **Task 7: Write initial tests for pi-token-killer**
  - Read `src/index.ts` and `src/rewrite.ts` to understand the token-killer logic
  - Write tests covering:
    - Core rewrite/token-killing functionality
    - Edge cases (empty input, no matches, large input)
    - CLI argument parsing (if applicable)
  - Run `pnpm --filter @r3b1s/pi-token-killer run test` — verify all tests pass
  - Target meaningful coverage of public API, not 100% coverage
  - Mock `execFileSync` via `vi.mock('node:child_process')` so tests don't require the real `rtk` binary

## Lint Cleanup

- [x] **Task 8: Fix Biome lint warnings in pi-skill-creator**
  - Run `biome check --write .` first to auto-fix `noUnusedImports`
  - Fix 14× `noExplicitAny` warnings — replace `any` with proper types (use `unknown` + type guards where needed; read `@earendil-works/pi-coding-agent` type definitions for generics)
  - Fix 1× `noVoidTypeReturn` at `review-ui.ts:115` — investigate call site to determine correct fix
  - Fix 1× `useIterableCallbackReturn` — fix forEach callback to not return a value
  - Run `pnpm -r run check` — must still pass (type fixes can introduce new errors)
  - Run `pnpm run lint` — verify 0 warnings, 0 errors

## Verification

- [x] **Task 9: Full toolchain verification**
  - Run `pnpm -r run check` — must pass
  - Run `pnpm -r run test` — must pass with 0 failures
  - Run `pnpm run lint` — must pass with 0 warnings
  - Verify `pnpm --version` returns 11.x
  - Verify all packages have LICENSE files
  - Verify no stale artifacts (package-lock.json)
  - Verify .pi/settings.json has commented-out local entries
