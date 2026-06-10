# pi-things

A pnpm workspace monorepo for Pi extension packages.

## Packages

| Package | npm name | Description |
|---------|----------|-------------|
| [`packages/pi-skill-creator`](packages/pi-skill-creator/) | `@r3b1s/pi-skill-creator` | Pi-native skill creator extension and bundled skill workflow |
| [`packages/pi-vim-stash`](packages/pi-vim-stash/) | `@r3b1s/pi-vim-stash` | Vim-style modal editing with prompt stash for pi's TUI editor |
| [`packages/pi-token-killer`](packages/pi-token-killer/) | `@r3b1s/pi-token-killer` | RTK (Rust Token Killer) extension — routes eligible bash commands through rtk |

## Development Setup

### Prerequisites

- [mise](https://mise.jdx.dev/) — tool version manager + task runner

### Install

```bash
# Install tools (node 22, pnpm 9)
mise install

# Install dependencies
pnpm install
```

### Available Commands

```bash
# Type checking (all packages)
pnpm run check

# Linting (Biome + ESLint)
pnpm run lint

# Tests (all packages)
pnpm run test

# Format code
pnpm run format

# Full CI (parallel: check + lint + test)
mise run ci

# Clean build artifacts
pnpm run clean
```

### Per-Package Commands

```bash
# Type check a single package
pnpm --filter @r3b1s/pi-vim-stash run check

# Run tests for a single package
pnpm --filter @r3b1s/pi-skill-creator run test
```

## Toolchain

| Tool | Purpose |
|------|---------|
| pnpm 9 | Package manager + workspaces |
| TypeScript (ES2024) | Type checking |
| Biome | Formatting + non-type-aware lint |
| ESLint | Type-aware lint only |
| Vitest | Test runner |
| mise | Tool versions + task runner |

See [`toolchain-research.md`](toolchain-research.md) for deferred tools (fallow, prek, rumdl, release-please).

## License

Each package retains its own license:
- `pi-skill-creator`: Apache-2.0
- `pi-vim-stash`: MIT
- `pi-token-killer`: MIT
