# @r3b1s/pi-subagents-deterministic

Deterministic subagent tool for Pi — resolves model and thinking level from `model-routing.yml`, removing the LLM from routing decisions.

## Overview

This Pi extension registers three LLM-callable tools:

- **`subagent`** (deterministic) — automatically resolves model and thinking level from `agent/model-routing.yml`. No `model` or `thinking` parameters exposed to the LLM. On spawn failure, iterates the role's ordered model list.
- **`subagent_manual`** (escape hatch) — accepts explicit `model` and `thinking` parameters, bypassing `model-routing.yml`. Use when you need a specific model or thinking level.
- **`get_subagent_result`** (non-blocking) — retrieves the result of a spawned subagent. Always returns immediately; call again if the agent is still running.

The deterministic `subagent` tool intentionally overrides pi-subagents' `subagent` tool via name collision in Pi's tool registry.

## Installation

```bash
pi install npm:@r3b1s/pi-subagents-deterministic
```

### Load Order

This extension **must be loaded after** `@gotgenes/pi-subagents` in your `settings.json` packages array to ensure the name-collision override works correctly:

```json
{
  "packages": [
    "@gotgenes/pi-subagents",
    "@r3b1s/pi-subagents-deterministic"
  ]
}
```

All three tools (`subagent`, `subagent_manual`, `get_subagent_result`) are registered unconditionally.

When neither pi-subagents nor a custom spawner (e.g. pi-tmux-sessionizer) is available, tool calls return a clear error instructing installation.

When pi-tmux-sessionizer is loaded, it injects a `ResultProvider` via `setResultProvider()` from PSD. This ensures `get_subagent_result` delegates to PTS's tracker even when PSD registered the tool first (first-writer-wins registry).

## Configuration

Place your routing configuration at `~/.pi/agent/model-routing.yml` (or `$PI_CODING_AGENT_DIR/agent/model-routing.yml`):

```yaml
roles:
  Explore:
    thinking: low
    models:
      - cheap-model
      - fallback-cheap
  implementer:
    thinking: high
    models:
      - primary-model
      - fallback-model
  reviewer:
    thinking: high
    models:
      - gpt-5.5
      - opus:
          thinking: xhigh
      - deepseek-v4-pro
  general-purpose:
    models:
      - cheap-model
```

### Role Mapping

YAML role keys are matched **case-insensitively** against the `subagent_type` value passed by the LLM. Any agent type name works as a role key — there is no hardcoded translation table. For example, `subagent_type: "Explore"` matches the `Explore`, `explore`, or `EXPLORE` role key.

Common agent types used by the LLM:

| `subagent_type` | Purpose |
|-----------------|---------|
| `Explore` | Code search / file exploration |
| `websearch` | Web research / information gathering |
| `Plan` | Architecture / implementation planning |
| `implementer` | Implementation from plan |
| `reviewer` | Code review / quality checks |
| `retro` | Project retrospective / learning |
| `reflect` | Session reflection / summarization |
| `general-purpose` | General-purpose complex tasks |

Unknown agent types return an explicit error — there is no silent fallback.

## Usage

### Deterministic (preferred)

The LLM calls `subagent` with only task-related parameters:

```json
{
  "subagent_type": "Explore",
  "prompt": "Search for unused imports in src/",
  "description": "Check unused imports"
}
```

Model and thinking level are resolved from `model-routing.yml` automatically.

### Manual override

When the LLM needs a specific model or thinking level:

```json
{
  "subagent_type": "reviewer",
  "prompt": "Review the implementation plan",
  "description": "Review plan",
  "model": "opus",
  "thinking": "xhigh"
}
```

## Composition with pi-tmux-sessionizer

Install both packages for best observability:

```bash
pi install npm:@r3b1s/pi-subagents-deterministic
pi install npm:@r3b1s/pi-tmux-sessionizer
```

When both are installed, PTS detects PSD during initialization and injects a custom tmux-based spawner via `setSpawner()`. The routing is:

- **spawning route**: PSD's `subagent` tool resolves model/thinking from `model-routing.yml`, then delegates the actual spawn to PTS's tmux spawner. Each subagent runs in a dedicated tmux window with full TUI.
- **result retrieval**: PSD's `get_subagent_result` always handles the `get_subagent_result` tool (first-writer-wins). PTS injects a `ResultProvider` via `setResultProvider()` so PSD's tool delegates to PTS's in-memory tracker. When no provider is set, PSD falls back to its SubagentsService-based lookup.
- **spawn fallback**: When PTS is installed but tmux is unavailable on the system, PSD's `subagent` tool returns a clear error instructing tmux installation. No dangling config or silent degradation.

### Standalone mode

Without PSD, PTS registers its own `subagent` tool (standalone mode) — no model-routing.yml resolution, direct tmux spawning.

## Dependencies

- **`@gotgenes/pi-subagents`** (peer, >=15.0.0) — SubagentsService for all subagent lifecycle management
- **`js-yaml`** — YAML config parsing at tool-call time

## Development

```bash
# TypeScript check
pnpm run check

# Tests
pnpm run test

# Lint
pnpm run lint

# Format
pnpm run format
```
