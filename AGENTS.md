# pi-things — Monorepo

This is a pnpm workspace monorepo containing Pi extension packages.

## Structure

```
pi-things/
├── packages/
│   ├── pi-skill-creator/   # @r3b1s/pi-skill-creator (Apache-2.0)
│   ├── pi-vim-stash/       # @r3b1s/pi-vim-stash (MIT)
│   ├── pi-token-killer/    # @r3b1s/pi-token-killer (MIT)
│   └── pi-holo-mem/        # @r3b1s/pi-holo-mem (MIT)
├── .pi/settings.json       # Local dev: loads packages from ./packages/
├── pnpm-workspace.yaml     # Workspace config + shared dependency catalog
├── tsconfig.base.json      # Shared TypeScript config (ES2024, Bundler)
├── biome.json              # Formatting + non-type-aware lint
├── eslint.config.js        # Type-aware lint only (recommendedTypeCheckedOnly)
├── mise.toml               # Tool versions + task runner
└── scripts/bin/            # npm/npx shims (redirect to pnpm)
```

## Commands

```bash
# Install dependencies (after mise install)
pnpm install

# Type checking
pnpm run check              # All packages
pnpm --filter @r3b1s/pi-vim-stash run check   # Single package

# Linting (Biome + ESLint)
pnpm run lint

# Tests
pnpm run test               # All packages
pnpm --filter @r3b1s/pi-skill-creator run test  # Single package

# Format
pnpm run format

# Full CI (parallel: check + lint + test)
mise run ci
```

## Code Style

- **TypeScript**: ES2024 target, `module: "ESNext"`, `moduleResolution: "Bundler"`, strict mode
- **Formatting**: Biome (space indent, double quotes)
- **Linting**: Biome handles non-type-aware rules. ESLint handles type-aware rules only (`recommendedTypeCheckedOnly`). Zero overlap.
- **Tests**: Vitest (all packages)
- **Path aliases**: `#src/*` and `#test/*` (defined in each package's `tsconfig.json` and `vitest.config.ts`)

### Biome + ESLint conflict workarounds

If Biome and ESLint produce conflicting diagnostics on the same line:
1. Disable the Biome rule in `biome.json` (Biome is the formatter, ESLint owns type-aware lint)
2. Or disable the ESLint rule for that line if it's a non-type-aware rule that Biome covers

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(scope): description
fix(scope): description
chore(scope): description
```

Scope is typically the package name (`pi-vim-stash`, `pi-token-killer`, etc.) or `repo` for monorepo-level changes.

## CI/CD

GitHub Actions is the mandated CI platform. All CI workflows live in `.github/workflows/`.

### Local Workflow Testing with `act`

Use [`act`](https://github.com/nektos/act) to test GitHub Actions workflows locally before pushing. It is installed on the local development system.

```bash
# Run the full CI workflow (default event: push)
act

# Run the CI workflow with pull_request event (mimics PR checks)
act pull_request

# Run a specific job (e.g., just the `check` job)
act -j check

# Dry-run: list what would execute without actually running
act -n

# Rebuild the act runner image (useful after workflow changes)
act --rebuild

# Watch mode — re-run on file changes
act --watch

# Supply a real GitHub token only if the workflow makes authenticated
# API calls (e.g., creating releases, accessing private repos)
act -s GITHUB_TOKEN=$(gh auth token)
```

> **Note:** `act` auto-generates a fake `GITHUB_TOKEN` by default — the standard CI jobs in this repo (`check`, lint, test) work fine without a real one. You only need `-s GITHUB_TOKEN=$(gh auth token)` for workflows that make authenticated GitHub API calls or access private repositories.

### Adding a New Workflow

1. Create `.github/workflows/<name>.yml`
2. Test locally with `act` before committing
3. Verify it runs correctly on push/PR after merge

## Package-Level Openspec

Each package may have its own `openspec/` directory. `cd` into the package dir to work with package-level specs. Running from repo root sees monorepo specs; running from a package dir sees that package's specs.
