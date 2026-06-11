## Why

Pi subagent spawning currently requires the orchestrator LLM to remember to read a routing skill file and a YAML config file, then manually pass `model` and `thinking` parameters — a multi-step chain that fails often. The model either skips the skill load, hallucinates wrong model names, or inherits the parent model regardless of task requirements. The result is non-deterministic, spotty behavior that undermines the entire model-routing architecture described in `det-agents-pi.md`.

This change introduces a deterministic `subagent` tool that resolves model and thinking level from config automatically, removing the LLM from the routing decision entirely. The existing `@gotgenes/pi-subagents` extension provides all the infrastructure (session lifecycle, concurrency, widgets, notifications); this package owns only the LLM-facing tool contract.

## What Changes

- **New Pi extension `@r3b1s/pi-subagents-deterministic`** — published as a pi package in this monorepo
- Registers a deterministic `subagent` tool that **replaces** pi-subagents' `subagent` tool at the LLM level via name collision
- Also registers `subagent_manual` as an always-visible escape hatch with full `model`/`thinking` parameters
- Both tools are always visible to the LLM (no toggling, no slash commands)
- Deterministic tool parameters exclude `model` and `thinking` — they are resolved from `agent/model-routing.yml` in extension code
- Agent selection guidance (which agent type for which task) is embedded in the tool description for always-visible routing
- Unknown agent types require explicit mapping in `model-routing.yml`; no silent fallback to a default role
- `thinking` param maps to `thinkingLevel` when calling `SubagentsService`
- Model fallback on spawn failure: iterates the role's ordered model list, retrying with next model
- Background-only MVP (no foreground streaming); `get_subagent_result` retrieves results
- Depends on `@gotgenes/pi-subagents` for all subagent lifecycle infrastructure; calls `SubagentsService` internally
- Depends on `js-yaml` for YAML parsing at runtime
- Reads `agent/model-routing.yml` at tool-call time for fresh config (no caching)
- Adds `subagent_type` → `role` mapping for all custom agent types defined in the user's agent definitions

## Capabilities

### New Capabilities
- `deterministic-subagent-tool`: Replaces the LLM-facing `subagent` tool with one that auto-resolves model and thinking from `model-routing.yml`. No `model` or `thinking` parameters exposed to the LLM. Iterates role's model list on spawn failure. Background-only MVP.
- `escape-hatch-tool`: `subagent_manual` tool always registered and visible alongside the deterministic tool. Accepts full `model` and `thinking` parameters, bypasses `model-routing.yml` entirely. Mirrors the deterministic tool's other parameters.
- `routing-table-injection`: Tool description contains inline agent-selection mapping (task type → agent type). Routing config values (model lists, effort levels) remain in code only.

### Modified Capabilities
_(none — this is a new package with no existing specs)_

## Impact

- **New package**: `packages/pi-subagents-deterministic/` in the pi-things monorepo
- **Dependency**: `@gotgenes/pi-subagents` (peer dependency for `SubagentsService` access)
- **Load order**: This extension must be loaded after `@gotgenes/pi-subagents` in the user's `settings.json` packages array to ensure the name-collision override works correctly. If pi-subagents is not loaded, this extension logs a warning and does not register its tools.
- **Config read**: `agent/model-routing.yml` from the pi config directory (same file used by the delegation skill)
- **No changes** to pi-subagents source, pi-harness-cfg, or existing agent definitions
- **Tool name collision**: intentionally overrides pi-subagents' `subagent` tool at the LLM interface; pi-subagents' infrastructure (lifecycle, notifications, widgets) continues to run unchanged
- **Both tools always visible**: `subagent` (deterministic) and `subagent_manual` (escape hatch) coexist without toggle commands or `setActiveTools`
