# pi-vim-stash

Single-package repo for `@r3b1s/pi-vim-stash` — Vim-style modal editing with prompt stash for [pi](https://github.com/earendil-works/pi)'s TUI editor. Formerly the `pi-things` monorepo; the other packages were migrated to their own repos.

## Structure

```
pi-vim-stash/
├── src/                    # Extension source (entry point: src/index.ts, see package.json "pi")
├── test/                   # Vitest tests (+ test/harness.ts)
├── scripts/pi-dev          # Isolated pi dev environment launcher
├── scripts/bin/            # npm/npx shims (redirect to pnpm)
├── .pi-dev/                # pi-dev sources config + retros
├── tsconfig.json           # ES2024, Bundler resolution, strict, noEmit
├── biome.json              # Formatting + non-type-aware lint
├── eslint.config.js        # Type-aware lint only (recommendedTypeCheckedOnly)
└── mise.toml               # Tool versions + task runner
```

## Commands

```bash
pnpm install
pnpm run check      # tsc --noEmit
pnpm run lint       # biome check . && eslint src/ test/
pnpm run test       # vitest run
pnpm run format     # biome check --write .
mise run ci         # check + lint + test
```

## Code Style

- **TypeScript**: ES2024 target, `module: "ESNext"`, `moduleResolution: "Bundler"`, strict mode
- **Formatting**: Biome (space indent, double quotes)
- **Linting**: Biome handles non-type-aware rules. ESLint handles type-aware rules only (`recommendedTypeCheckedOnly`). Zero overlap.
- **Tests**: Vitest
- **Path aliases**: `#src/*` and `#test/*` (defined in `tsconfig.json` and `vitest.config.ts`)

### Biome + ESLint conflict workarounds

If Biome and ESLint produce conflicting diagnostics on the same line:
1. Disable the Biome rule in `biome.json` (Biome is the formatter, ESLint owns type-aware lint)
2. Or disable the ESLint rule for that line if it's a non-type-aware rule that Biome covers

## Commit Conventions

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, etc. Releases are cut by release-please from these commit types; tags are component-prefixed (`pi-vim-stash-vX.Y.Z`).

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`): check job (typecheck + lint + test), then release-please on main, then npm publish when a release is created.

### Local Workflow Testing with `act`

Use [`act`](https://github.com/nektos/act) to test GitHub Actions workflows locally before pushing (installed on the local development system).

```bash
act              # full CI workflow (push event)
act pull_request # mimic PR checks
act -j check     # single job
act -n           # dry-run
```

> **Note:** `act` auto-generates a fake `GITHUB_TOKEN` — the `check` job works fine without a real one. Supply `-s GITHUB_TOKEN=$(gh auth token)` only for workflows making authenticated GitHub API calls.

## pi-dev Environment

`scripts/pi-dev` launches pi with an isolated config that loads the extension from this checkout. Sources are listed in `.pi-dev/dev-sources.json` (currently `["."]`). `scripts/pi-dev --clean` resets sessions/trust.
