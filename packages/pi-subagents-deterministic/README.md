# @r3b1s/pi-subagents-deterministic

Deterministic subagent routing for Pi — resolves model and thinking level from `model-routing.yml` and injects them into pi-subagents' `subagent` tool calls via Pi's `tool_call` hook.

## Overview

This Pi extension registers one LLM-callable tool:

- **`subagent_manual`** (escape hatch) — accepts explicit `model` and `thinking` parameters, bypassing `model-routing.yml`. Use when you need a specific model or thinking level.

The `subagent` tool is **not** registered by PSD. Instead, PSD hooks Pi's `tool_call` event for `toolName === "subagent"` and injects deterministic `model` and `thinking` values into `event.input` before pi-subagents' native `subagent` tool executes. This means:

- No tool-registration conflicts with pi-subagents (first-writer-wins is irrelevant).
- Every `subagent` call is automatically routed according to `model-routing.yml` — the LLM cannot override the model or thinking level through the `subagent` tool.
- The `subagent_manual` escape hatch remains available for explicit override.

PSD also exports `setSpawner()` and `setResultProvider()` for API stability with downstream consumers such as pi-tmux-sessionizer.

## Architecture

PSD intercepts `subagent` tool calls using Pi's `tool_call` event hook:

1. When the LLM calls `subagent`, Pi fires a `tool_call` event before the registered tool executes.
2. PSD's hook handler catches events where `event.toolName === "subagent"`.
3. The handler reads `agent/model-routing.yml` from the Pi config directory (`~/.pi/` or `$PI_CODING_AGENT_DIR`).
4. It resolves the first model and the thinking level for the requested `subagent_type` from the YAML (case-insensitive role matching).
5. It mutates `event.input.model` and `event.input.thinking` with the resolved values — always overwriting any values the LLM may have set.
6. The call then proceeds to pi-subagents' native `subagent` tool, which accepts `model` and `thinking` as optional parameters and forwards them to `SubagentsService.spawn()`.

The hook blocks the call with a clear error reason if:
- The YAML file is missing or unparseable.
- The requested agent type has no matching role in the config.
- The matching role has an empty models list.

## Installation

```bash
pi install npm:@r3b1s/pi-subagents-deterministic
```

PSD can be loaded **before or after** `@gotgenes/pi-subagents` — the hook fires regardless of load order.

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

> **Note:** The hook always overwrites `model` and `thinking` on the `subagent` tool call with the resolved config values. Even if the LLM provides these parameters in its call, the routing config is authoritative.

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

The LLM calls `subagent` (pi-subagents' native tool) with only task-related parameters:

```json
{
  "subagent_type": "Explore",
  "prompt": "Search for unused imports in src/",
  "description": "Check unused imports"
}
```

Model and thinking level are resolved from `model-routing.yml` automatically by the hook — no explicit `model` or `thinking` parameters needed.

### Manual override

When the LLM needs to bypass the routing config, it calls `subagent_manual`:

```json
{
  "subagent_type": "reviewer",
  "prompt": "Review the implementation plan",
  "description": "Review plan",
  "model": "opus",
  "thinking": "xhigh"
}
```

`subagent_manual` is the only tool PSD registers. It accepts explicit `model` and `thinking` parameters and does not go through the hook.

## Behavior with pi-tmux-sessionizer

When both PSD and pi-tmux-sessionizer (PTS) are installed, PTS calls `setSpawner()` to inject a tmux-based spawner. However, the deterministic `subagent` path does **not** use PSD's spawner — the hook only mutates `event.input` and lets pi-subagents' tool perform the actual spawn via `SubagentsService.spawn()`. As a result:

- **`setSpawner` is a no-op for deterministic `subagent` calls.** The hook does not call spawners; it only injects routing values.
- `subagent_manual` still routes through PTS's spawner when one is set, preserving tmux observability for manual override calls.
- Users who want tmux observability for deterministic routing should use `subagent_manual` with the desired model and thinking level explicitly specified.

## Behavior with `get_subagent_result`

PSD no longer registers a `get_subagent_result` tool. pi-subagents' native `get_subagent_result` tool handles result retrieval for all `subagent` and `subagent_manual` calls.

- **Default behavior**: Non-blocking — the tool returns immediately with `{ done: false }` if the agent is still running.
- **Opt-in blocking**: Pass `wait: true` to block until the agent completes and return the result.

This is a change from previous PSD versions, which always returned immediately without a `wait` option. The default non-blocking behavior is preserved; the LLM can opt in to blocking when needed.

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
