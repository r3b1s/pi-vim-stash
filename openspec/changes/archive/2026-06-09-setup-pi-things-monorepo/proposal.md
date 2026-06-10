## Why

Three Pi extension repositories (`pi-skill-creator`, `pi-vim-stash`, `rtk-pi`) exist as independent projects with inconsistent tooling, no shared configuration, and no path to unified CI/CD or npm publishing. Consolidating them into a pnpm monorepo establishes a single source of truth for development conventions, shared dependencies, and future release automation — following proven patterns from the `gotgenes/pi-packages` reference repository.

## What Changes

- Create a pnpm workspace monorepo structure under `pi-things/` with `packages/*` layout
- Copy `pi-skill-creator`, `pi-vim-stash`, and `rtk-pi` into `packages/` (originals left intact)
- Restructure `pi-vim-stash` flat `.ts` files into `src/` directory
- Standardize TypeScript to ES2024 target across all packages with shared `tsconfig.base.json`
- Adopt full mise toolchain: tool version management (node, pnpm), environment, task runner
- Configure Biome (formatting + non-type-aware lint) + ESLint (type-aware lint only) at root
- Configure Vitest as unified test runner (replacing `node:test` in `pi-vim-stash`)
- Set up pnpm `catalog:` for centralized dependency version management
- Configure `.pi/settings.json` for local package development
- Create root `AGENTS.md` with Level 0 monorepo conventions
- Create per-package `AGENTS.md` redirect stubs
- Adopt comprehensive `.gitignore` from reference repository
- Create `toolchain-research.md` documenting deferred tools (fallow, prek, rumdl, release-please)
- Scope npm package names under `@r3b1s/pi-*`

## Capabilities

### New Capabilities

- `monorepo-structure`: pnpm workspace layout with packages/*, shared configs, mise toolchain
- `shared-toolchain`: Root-level Biome, ESLint, TypeScript, Vitest configuration inherited by all packages
- `pi-dev-environment`: `.pi/settings.json` loading local packages for development, AGENTS.md conventions

### Modified Capabilities

(none — no existing specs to modify)

## Impact

- **Source repos**: Copied, not moved. Original repos remain untouched.
- **Package names**: `pi-skill-creator` → `@r3b1s/pi-skill-creator`, `pi-vim-stash` → `@r3b1s/pi-vim-stash`, `rtk-pi` → `@r3b1s/rtk-pi`
- **pi-vim-stash tests**: Migrating from `node:test` to Vitest (9 test files)
- **pi-skill-creator**: Already uses Vitest, minimal changes
- **rtk-pi**: No tests, no build — minimal restructuring
- **Licenses**: Preserved as-is (Apache-2.0 for pi-skill-creator, MIT for others)
- **Dependencies**: Shared dev dependencies managed via pnpm catalog (typescript, vitest, @types/node, biome, eslint, etc.)
- **CI/CD**: Not included in this change (deferred). Toolchain-research.md documents release-please and other deferred tools.
- **npm publishing**: Not automated in this change. Package.json files configured with `publishConfig: { "access": "public" }` for future use.
