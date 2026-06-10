# Design: Finish Toolchain Migration

## Approach

Each item is a small, self-contained fix. No cross-dependencies between most items except #1 (test fix) which should be validated before #3 (new tests) to confirm the test infrastructure pattern is correct.

## Item 1: pi-vim-stash — Lazy-evaluate `import.meta.resolve()`

### Problem

```typescript
// src/index.ts:305 — runs at module import time
const PI_CODING_AGENT_MODULE_URL = import.meta.resolve(
  "@earendil-works/pi-coding-agent",
);
```

This value is interpolated into two inline JS source strings (`CLIPBOARD_HELPER_SOURCE`, `CLIPBOARD_READ_HELPER_SOURCE`) that are executed as child processes via `spawnSync(process.execPath, ["--input-type=module", "-e", SOURCE])`.

Vitest's SSR transform rewrites modules and `import.meta.resolve` is not available in that context, so any test that transitively imports `src/index.ts` crashes.

### Solution

Wrap the resolve + string construction in a memoized getter function. The module URL and helper source strings are only computed on first call — tests that never exercise clipboard functionality never trigger `import.meta.resolve()`.

Share a single lazy-evaluated module URL so `import.meta.resolve()` is called at most once, regardless of which helper is used first:

```typescript
// Before (module top-level):
const PI_CODING_AGENT_MODULE_URL = import.meta.resolve("@earendil-works/pi-coding-agent");
const CLIPBOARD_HELPER_SOURCE = `import { copyToClipboard } from ${JSON.stringify(PI_CODING_AGENT_MODULE_URL)}; ...`;
const CLIPBOARD_READ_HELPER_SOURCE = `import { createRequire } from "node:module"; ...`;

// After (single shared lazy URL + lazy helper sources):
let _moduleUrl: string | undefined;
function getModuleUrl(): string {
  if (!_moduleUrl) _moduleUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  return _moduleUrl;
}

let _clipboardHelperSource: string | undefined;
let _clipboardReadHelperSource: string | undefined;

function getClipboardHelperSource(): string {
  if (!_clipboardHelperSource) {
    _clipboardHelperSource = `import { copyToClipboard } from ${JSON.stringify(getModuleUrl())}; ...`;
  }
  return _clipboardHelperSource;
}

function getClipboardReadHelperSource(): string {
  if (!_clipboardReadHelperSource) {
    _clipboardReadHelperSource = `import { createRequire } from "node:module"; ...`;
  }
  return _clipboardReadHelperSource;
}
```

Both `getClipboardHelperSource()` and `getClipboardReadHelperSource()` call `getModuleUrl()` instead of resolving independently.

Update all call sites that reference `CLIPBOARD_HELPER_SOURCE` and `CLIPBOARD_READ_HELPER_SOURCE` to call the getter functions instead.

### Risk

Changes initialization order. Need to verify:
- No code path reads these constants at import time (they should only be read inside functions that spawn child processes)
- Clipboard functionality still works correctly when actually invoked

## Item 2: pi-skill-creator — Copy LICENSE

Copy `~/Local/personal/pi-skill-creator/LICENSE` to `packages/pi-skill-creator/LICENSE`. No transformation needed — preserve the original Apache-2.0 license text verbatim.

## Item 3: pi-token-killer — Test infrastructure + initial tests

### Scaffold

1. Add `vitest.config.ts` matching the pattern from pi-skill-creator and pi-vim-stash (with `#src` and `#test` path aliases)
2. Add `"test": "vitest run"` script to `package.json`
3. Add `"vitest": "catalog:"` to devDependencies in `package.json`
4. Add `"eslint": "catalog:"` and `"typescript-eslint": "catalog:"` to devDependencies in `package.json`
5. Add `#test/*` path alias to `tsconfig.json`
6. Create `test/` directory

### Initial tests

Read `src/index.ts` and `src/rewrite.ts` to understand the token-killer logic, then write tests covering:
- Core rewrite/token-killing functionality
- Edge cases (empty input, no matches, large input)
- CLI argument parsing (if applicable)

Target: meaningful coverage of the public API surface. Not 100% coverage — just enough to catch regressions and document expected behavior.

**Testing note:** Mock `execFileSync` via `vi.mock('node:child_process')` so tests don't require the real `rtk` binary on PATH. Test the logic around the rtk call, not rtk itself.

## Item 4: Stale package-lock.json

1. Delete `packages/pi-skill-creator/package-lock.json`
2. Add `**/package-lock.json` to root `.gitignore` (prevents any future npm artifacts from being committed in any package)

## Item 5: .pi/settings.json — Comment out local entries

Comment out the local `packages` entries with a toggle comment:

```jsonc
{
  // Local package paths — uncomment to load dev versions instead of stable npm versions
  // "packages": [
  //   "../packages/pi-skill-creator/",
  //   "../packages/pi-vim-stash/",
  //   "../packages/pi-token-killer/"
  // ]
}
```

This preserves the stable npm-published versions as the active extensions while keeping the local paths easy to re-enable for integration testing.

## Item 6: Spec + toolchain version alignment

1. Fix PATH priority so mise-managed pnpm 11 takes precedence over Node-bundled pnpm 9
2. Update root `package.json` `packageManager` field to `pnpm@11.5.2` (matching actual mise-installed version)
3. Update `openspec/specs/monorepo-structure/spec.md`:
   - Change `node = "22"` → `node = "lts"`
   - Change `pnpm = "9"` → `pnpm = "11"`
   - Update the mise scenario text accordingly

## Item 7: Fix Biome lint warnings

Run `pnpm run lint` to enumerate all 17 warnings, then fix per category:

- **14× `noExplicitAny`**: Replace `any` with proper types. Use `unknown` + type guards where the exact type is unknowable. For types from `@earendil-works/pi-coding-agent` peer dep, read the API types to determine correct generics.
- **1× `noUnusedImports`**: Auto-fix via `biome check --write`
- **1× `noVoidTypeReturn`** (at `review-ui.ts:115`): Investigate call site — if `this.done()` returns something meaningful, change function signature; otherwise split into `this.done(undefined); return;`
- **1× `useIterableCallbackReturn`**: Fix the forEach callback to not return a value (or switch to for...of)

After all fixes:
- Run `pnpm -r run check` — verify no type errors introduced
- Run `pnpm run lint` — verify 0 warnings, 0 errors
