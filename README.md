![pi-things-banner.png](https://raw.githubusercontent.com/r3b1s/media-assets/refs/heads/main/pi-things/pi-things-banner.png)

A pnpm workspace monorepo for conveniently developing [Pi](https://pi.dev/) extensions. Credit to [@gotgenes](https://github.com/gotgenes) for inspiring the toolchain and monorepo shape with [their own monorepo](https://github.com/gotgenes/pi-packages/).

## Extensions

| Package | npm name | Description |
|---------|----------|-------------|
| [`packages/pi-subagents-deterministic`](packages/pi-subagents-deterministic/) | `@r3b1s/pi-subagents-deterministic` | Deterministic subagent routing with pluggable spawner interface. Requires [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) |
| [`packages/pi-tmux-sessionizer`](packages/pi-tmux-sessionizer/) | `@r3b1s/pi-tmux-sessionizer` | Spawn subagents as real `pi` processes in detached tmux windows — full TUI observability, external control, and session file result extraction. Requires [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) |
| [`packages/pi-skill-creator`](packages/pi-skill-creator/) | `@r3b1s/pi-skill-creator` | Pi-native skill creator extension and bundled skill workflow |
| [`packages/pi-vim-stash`](packages/pi-vim-stash/) | `@r3b1s/pi-vim-stash` | Vim-style modal editing with prompt stash for pi's TUI editor. Fusion of [pi-vim](https://github.com/lajarre/pi-vim) and [pi-stash](https://github.com/maxpetretta/pi-stash) — credit to [@lajarre](https://github.com/lajarre) and [@maxpetretta](https://github.com/maxpetretta) |
| [`packages/pi-token-killer`](packages/pi-token-killer/) | `@r3b1s/pi-token-killer` | [RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer) extension — routes eligible bash commands through `rtk` |
| [`packages/pi-holo-mem`](packages/pi-holo-mem/) | `@r3b1s/pi-holo-mem` | Holographic memory — structured fact storage with compositional reasoning via HRR algebra. Implements the verbatim python code for the Holographic memory plugin from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent). |

### Installation

Install any package using the Pi CLI:

```bash
# Tmux-based subagent spawning with full TUI observability
pi install npm:@r3b1s/pi-tmux-sessionizer

# Holographic memory for agents
pi install npm:@r3b1s/pi-holo-mem

# Skill creation, improvement, and review
pi install npm:@r3b1s/pi-skill-creator

# Token-optimized CLI proxy (60-90% savings)
pi install npm:@r3b1s/pi-token-killer

# Vim-style modal editing with prompt stash
pi install npm:@r3b1s/pi-vim-stash
```

> **Note:** `pi-holo-mem` requires Python 3 with `venv` and `pip` installed. The extension automatically creates and manages its own Python virtual environment on first use.
> **Note:** `pi-tmux-sessionizer` requires `tmux` on your system. Install with `apt install tmux` (Debian/Ubuntu), `brew install tmux` (macOS), or `dnf install tmux` (Fedora).

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

# Build a single package (produces dist/ with compiled JS + declarations)
pnpm --filter @r3b1s/pi-tmux-sessionizer run build
```

## Toolchain

| Tool | Purpose |
|------|---------|
| pnpm 11 | Package manager + workspaces |
| TypeScript (ES2024) | Type checking |
| Biome | Formatting + non-type-aware lint |
| ESLint | Type-aware lint only |
| Vitest | Test runner |
| mise | Tool versions + task runner |
| release-please | Automated versioning and changelog generation from conventional commits |

See [`toolchain-research.md`](toolchain-research.md) for deferred tools (fallow, prek, rumdl).

## License

Each package retains its own license:
- `pi-holo-mem`: MIT
- `pi-skill-creator`: Apache-2.0
- `pi-tmux-sessionizer`: MIT
- `pi-vim-stash`: MIT
- `pi-token-killer`: MIT
