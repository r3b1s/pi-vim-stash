## Purpose

Defines the shared development toolchain across all monorepo packages: TypeScript configuration, linting (Biome + ESLint), testing (Vitest), dependency management (pnpm catalog), and consistent scripts.

## Requirements

### Requirement: Shared TypeScript base configuration
A root `tsconfig.base.json` SHALL define `target: "ES2024"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `strict: true`, `noEmit: true`. Each package SHALL have its own `tsconfig.json` extending `../../tsconfig.base.json` with package-specific `paths` aliases (`#src/*`, `#test/*`).

#### Scenario: Type checking passes across all packages
- **WHEN** `pnpm -r run check` is executed
- **THEN** all packages pass TypeScript type checking with ES2024 target

#### Scenario: ES2024 APIs available for type checking
- **WHEN** a package uses `Promise.withResolvers()`, `Object.groupBy()`, or `Set.prototype.union()`
- **THEN** TypeScript type-checks these without errors

### Requirement: Biome handles formatting and non-type-aware lint
A root `biome.json` SHALL configure Biome for formatting (space indent, double quotes) and recommended lint rules. Biome SHALL ignore `dist/`, `node_modules/`, `.pi/`, and `coverage/` directories.

#### Scenario: Biome formats consistently
- **WHEN** `biome check --write .` is run from the root
- **THEN** all `.ts` and `.json` files are formatted with space indent and double quotes

#### Scenario: Biome lints without type information
- **WHEN** `biome check .` is run
- **THEN** non-type-aware lint rules (unused variables, debugger statements, suspicious patterns) are enforced

### Requirement: ESLint handles type-aware lint only
A root `eslint.config.js` SHALL configure ESLint with `typescript-eslint` `recommendedTypeCheckedOnly` and `stylisticTypeCheckedOnly` rule sets. ESLint SHALL NOT overlap with Biome on non-type-aware rules. ESLint SHALL be scoped to `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts`.

#### Scenario: Type-aware rules enforced
- **WHEN** code uses a deprecated API, an unnecessary condition, or misused spread
- **THEN** ESLint reports the violation

#### Scenario: No overlap with Biome
- **WHEN** both Biome and ESLint run on the same file
- **THEN** no rule produces conflicting diagnostics

### Requirement: Vitest is the unified test runner
All packages SHALL use Vitest for testing. Each package SHALL have a `vitest.config.ts` with `#src` and `#test` path aliases. The root `package.json` or mise tasks SHALL provide `test` commands that run Vitest across all packages.

#### Scenario: Tests run across all packages
- **WHEN** `pnpm -r run test` or `mise run test` is executed
- **THEN** Vitest runs tests in all packages that have test files

#### Scenario: pi-vim-stash migrated from node:test
- **WHEN** pi-vim-stash tests are run
- **THEN** they execute under Vitest (not node:test) with equivalent assertions

### Requirement: pnpm catalog centralizes shared dependencies
`pnpm-workspace.yaml` SHALL contain a `catalog:` section with shared dependency versions for `typescript`, `vitest`, `@types/node`, `@biomejs/biome`, `eslint`, `typescript-eslint`, and other cross-package dev dependencies. Package `package.json` files SHALL reference these via `"catalog:"` protocol.

#### Scenario: Version update is centralized
- **WHEN** the `typescript` version is updated in the catalog
- **THEN** all packages pick up the new version on next `pnpm install` without editing individual `package.json` files

### Requirement: Consistent lint and format scripts
Each package SHALL have `check`, `lint`, and `test` scripts. The root SHALL have `lint` (Biome + ESLint), `format` (Biome format), and `check` (typecheck all) scripts.

#### Scenario: Per-package scripts work
- **WHEN** `pnpm --filter @r3b1s/pi-vim-stash run check` is executed
- **THEN** TypeScript type checking runs for that package only

#### Scenario: Root scripts orchestrate all packages
- **WHEN** `pnpm run lint` is executed from root
- **THEN** Biome and ESLint run across all packages

### Requirement: .gitignore template adopted
The repo SHALL use a comprehensive `.gitignore` covering `dist/`, `node_modules/`, `.pi/npm/`, `coverage/`, `.fallow/`, OS files, editor files, `*.tgz`, `.env`, and pnpm store.

#### Scenario: Ignored files not tracked
- **WHEN** `pnpm install` creates `node_modules/` and `.pi/npm/`
- **THEN** these directories are not tracked by git
