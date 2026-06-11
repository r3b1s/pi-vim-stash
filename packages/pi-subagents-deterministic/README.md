# @r3b1s/pi-subagents-deterministic

Deterministic subagent tool for Pi — resolves model and thinking level from `model-routing.yml`, removing the LLM from routing decisions.

## Overview

This Pi extension registers two LLM-callable tools:

- **`subagent`** (deterministic) — automatically resolves model and thinking level from `agent/model-routing.yml`. No `model` or `thinking` parameters exposed to the LLM. On spawn failure, iterates the role's ordered model list.
- **`subagent_manual`** (escape hatch) — accepts explicit `model` and `thinking` parameters, bypassing `model-routing.yml`. Use when you need a specific model or thinking level.

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

If `@gotgenes/pi-subagents` is not loaded, this extension logs a warning and does not register its tools. pi-subagents' own `subagent` tool remains available.

## Configuration

Place your routing configuration at `~/.pi/agent/model-routing.yml` (or `$PI_CODING_AGENT_DIR/agent/model-routing.yml`):

```yaml
roles:
  explorer:
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
```

### Role Mapping

| Agent Type | Role Key |
|------------|----------|
| `Explore` | `explorer` |
| `websearch` | `websearch` |
| `Plan` | `planner` |
| `implementer` | `implementer` |
| `reviewer` | `reviewer` |
| `retro` | `retro` |
| `reflect` | `reflect` |
| `general-purpose` | `cheap` |

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
