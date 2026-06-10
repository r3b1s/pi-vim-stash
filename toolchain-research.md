# Toolchain Research — Deferred Tools

This file documents tools that were evaluated during monorepo setup but deferred. Each entry explains what the tool does, why it was deferred, and when to adopt it.

---

## fallow — Dead Code Analysis

**What it does:** Analyzes TypeScript/JavaScript codebases to find unreachable exports, unused files, and dead code paths. Works with monorepo setups and respects tsconfig project references.

**Why deferred:** Not essential for initial monorepo setup. The codebase is small (3 packages) and dead code is manageable manually. Adding fallow requires integrating its output into CI, which is deferred.

**When to adopt:**
- When the monorepo grows beyond 5 packages
- When CI/CD is set up and dead code detection can be automated
- When onboarding contributors who may leave unused exports

**Research notes:**
- Install: `npx fallow --help`
- Works with ESM and TypeScript out of the box
- Can be added as a mise task: `fallow --ci` for CI mode

---

## prek — Git Hooks

**What it does:** Lightweight git hooks manager. Runs pre-commit and pre-push hooks with support for parallel execution, skip flags, and monorepo-aware filtering.

**Why deferred:** The monorepo has no CI/CD yet. Biome and ESLint can be run manually via `mise run lint`. Git hooks add friction during initial development when iterating quickly.

**When to adopt:**
- When CI/CD is set up and hooks enforce the same checks locally
- When multiple contributors work on the repo
- When the team wants automatic pre-commit formatting/linting

**Research notes:**
- Install: `pnpm add -D prek`
- Config: `prek.config.ts` at repo root
- Supports `--no-verify` skip flag
- Can run Biome format + ESLint on staged files only

---

## rumdl — Markdown Lint

**What it does:** Markdown linter with rules for consistency, line length, heading levels, link validity, and more. Faster and more configurable than markdownlint.

**Why deferred:** Documentation is minimal (README + AGENTS.md + toolchain-research.md). Adding a markdown linter now adds overhead with little benefit. The AGENTS.md and README are hand-maintained and unlikely to have linting issues.

**When to adopt:**
- When the documentation grows (contributing guides, API docs, changelogs)
- When auto-generated docs need consistency enforcement
- When CI/CD is set up and docs quality checks are automated

**Research notes:**
- Install: `npx rumdl --help`
- Config: `.rumdl.toml` or `rumdl.toml`
- Supports `--fix` for auto-correction
- Can be added as a mise task

---

## release-please — Release Automation

**What it does:** Google's automated release tool. Creates release PRs from Conventional Commits, generates changelogs, manages version bumps, and publishes to npm. Supports monorepos with per-package release PRs.

**Why deferred:** The packages are not yet published to npm. Release automation requires: (1) npm publishing setup, (2) GitHub Actions CI, (3) provenance configuration. All three are deferred.

**When to adopt:**
- When packages are ready for npm publishing
- When GitHub Actions CI is set up
- When the team wants automated version bumps and changelogs

**Research notes:**
- Config: `release-please-config.json` + `.release-please-manifest.json`
- Monorepo support: configure `packages` in config with per-package settings
- GitHub Action: `googleapis/release-please-action@v4`
- Requires Conventional Commits (already adopted in AGENTS.md)
- Can generate provenance attestations for npm (`--provenance` flag)
