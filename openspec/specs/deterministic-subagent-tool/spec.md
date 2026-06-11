## ADDED Requirements

### Requirement: Graceful degradation when pi-subagents is not loaded

If `@gotgenes/pi-subagents` is not loaded at extension startup, the extension SHALL log a warning and SHALL NOT register `subagent` or `subagent_manual` tools.

#### Scenario: pi-subagents not loaded

- **WHEN** pi-subagents is not loaded at extension startup
- **THEN** the extension SHALL log a warning and SHALL NOT register `subagent` or `subagent_manual` tools

### Requirement: Tool overrides pi-subagents subagent tool

The extension SHALL register a tool named `subagent` that replaces the `subagent` tool provided by `@gotgenes/pi-subagents` at the LLM interface. The pi-subagents extension's infrastructure (session lifecycle, widgets, notifications, concurrency queue) SHALL continue to operate unchanged.

#### Scenario: Registration succeeds when pi-subagents is loaded

- **WHEN** the extension starts and `@gotgenes/pi-subagents` has already registered its `subagent` tool
- **THEN** the deterministic `subagent` tool replaces it for LLM interactions

#### Scenario: pi-subagents infrastructure runs unchanged

- **WHEN** the deterministic `subagent` tool spawns an agent
- **THEN** the spawned agent SHALL appear in pi-subagents' TUI widget, SHALL respect the concurrency queue, and SHALL emit pi-subagents' lifecycle events (`subagents:started`, `subagents:completed`)

### Requirement: Tool schema excludes model and thinking parameters

The `subagent` tool's parameter schema SHALL NOT include `model` or `thinking` fields. The LLM SHALL not be able to specify these values.

#### Scenario: Tool definition has no model field

- **WHEN** the LLM receives the tool definitions for the session
- **THEN** the `subagent` tool's `parameters` object SHALL NOT contain `model` or `thinking`

#### Scenario: Tool execute receives no model from LLM

- **WHEN** the LLM calls `subagent` with only `subagent_type`, `prompt`, and `description`
- **THEN** the tool's `execute` function SHALL receive parameters without `model` or `thinking` values

### Requirement: Model and thinking resolved from model-routing.yml

When the `subagent` tool executes, it SHALL read `agent/model-routing.yml` from the pi config directory, map the `subagent_type` to a role, and use the first model in that role's ordered model list. It SHALL also apply the role's configured thinking level (with per-model override support). On spawn failure, it SHALL iterate the ordered model list.

#### Scenario: Explorer agent gets cheap model with low thinking

- **WHEN** the LLM calls `subagent(subagent_type: "Explore", ...)`
- **THEN** the tool SHALL map `Explore` to the `explorer` role and use the first model in `model-routing.yml` under `roles.explorer.models` with `roles.explorer.thinking`

#### Scenario: Implementer agent gets high thinking

- **WHEN** the LLM calls `subagent(subagent_type: "implementer", ...)`
- **THEN** the tool SHALL map `implementer` to the `implementer` role and apply `roles.implementer.thinking` as the thinking level

#### Scenario: Unknown agent type requires explicit mapping

- **WHEN** the LLM calls `subagent(subagent_type: "custom-agent", ...)` and `custom-agent` is not in the type-to-role mapping
- **THEN** the tool SHALL return an error: "No routing config found for agent type custom-agent. Add a role entry to model-routing.yml."

### Requirement: Model fallback on spawn failure

When `SubagentsService.spawn()` fails (model unavailable, rate-limited, provider error), the tool SHALL iterate through the role's ordered model list and retry with the next model. If all models in the list fail, the tool SHALL return an error listing all failed models.

#### Scenario: First model fails, second succeeds

- **WHEN** `SubagentsService.spawn()` fails for the first model in a role's list
- **THEN** the tool SHALL retry with the second model and report which model was ultimately used

#### Scenario: All models fail

- **WHEN** `SubagentsService.spawn()` fails for all models in a role's ordered list
- **THEN** the tool SHALL return an error in the format: `"All models failed for role <role>: tried <model1>, <model2>, <model3>."` Per-model failure reasons are NOT included; only model names are listed.

#### Scenario: Role has empty models list

- **WHEN** a role's models list is empty
- **THEN** the tool SHALL return an error: `"No models configured for role: <role>."`

### Requirement: Tool delegates to SubagentsService

The `subagent` tool's `execute` function SHALL call `@gotgenes/pi-subagents`' `SubagentsService.spawn()` with the resolved model and thinking level (mapped to `thinkingLevel`), passing through all other parameters (`subagent_type`, `prompt`, `description`, `run_in_background`, `inherit_context`, `max_turns`, `resume`).

#### Scenario: SubagentsService receives resolved model

- **WHEN** the tool resolves model `deepseek-v4-flash` for an `Explore` agent
- **THEN** `SubagentsService.spawn()` SHALL be called with `options.model` set to the resolved model identifier

#### Scenario: Background-only execution returns agent ID

- **WHEN** the LLM calls `subagent` with `run_in_background: true`
- **THEN** the tool SHALL spawn via `SubagentsService.spawn()` in background mode and return the agent ID for later retrieval via `get_subagent_result`

#### Scenario: Foreground calls also return agent ID (MVP limitation)

- **WHEN** the LLM calls `subagent` without `run_in_background`
- **THEN** the tool SHALL spawn via `SubagentsService.spawn()` and return the agent ID (background-only MVP; foreground streaming deferred)

#### Scenario: Success return contains agent ID

- **WHEN** the tool successfully spawns a subagent
- **THEN** it SHALL return a text result containing the agent ID for retrieval via `get_subagent_result`

#### Scenario: Valid resume parameter resumes existing agent

- **WHEN** the `resume` parameter contains a valid agent ID
- **THEN** the tool SHALL resume the existing agent via `SubagentsService`

#### Scenario: Invalid resume parameter returns error

- **WHEN** the `resume` parameter contains an invalid agent ID
- **THEN** the tool SHALL return an error indicating the agent was not found

#### Scenario: Resume conflicts with prompt parameter

- **WHEN** `resume` is combined with a conflicting `prompt` parameter
- **THEN** the tool SHALL return an error about conflicting parameters

### Requirement: thinking mapped to thinkingLevel internally

The config schema (`model-routing.yml`) uses the key `thinking` for consistency. Internally, when calling `SubagentsService.spawn()`, the resolved thinking value SHALL be passed as `options.thinkingLevel`.

#### Scenario: Tool maps thinking to thinkingLevel

- **WHEN** the tool resolves `thinking: "high"` from model-routing.yml
- **THEN** `SubagentsService.spawn()` SHALL receive `options.thinkingLevel` set to `"high"`

### Requirement: Per-model thinking override

When a model entry in `model-routing.yml` includes its own `thinking` value, that value SHALL override the role-level `thinking` default for that specific model.

#### Scenario: Model has thinking override

- **WHEN** `model-routing.yml` has `roles.reviewer.thinking: high` and a model entry `opus: { thinking: xhigh }`
- **THEN** spawning with `opus` SHALL use `thinkingLevel: "xhigh"` while spawning with other reviewer models SHALL use `thinkingLevel: "high"`

#### Scenario: Model has no thinking override

- **WHEN** `model-routing.yml` has `roles.reviewer.thinking: high` and a model entry is a plain string `gpt-5.5`
- **THEN** spawning with `gpt-5.5` SHALL use the role-level `thinkingLevel: "high"`

### Requirement: YAML parse errors produce clear error messages

If `model-routing.yml` cannot be read or parsed, the tool SHALL return an error message describing the failure rather than throwing an unhandled exception.

#### Scenario: Missing config file

- **WHEN** `model-routing.yml` does not exist at the expected path
- **THEN** the tool SHALL return a text result: "Model routing config not found at <path>"

#### Scenario: Invalid YAML

- **WHEN** `model-routing.yml` contains invalid YAML syntax
- **THEN** the tool SHALL return a text result describing the parse error

#### Scenario: Missing role in config

- **WHEN** `model-routing.yml` is valid but the resolved role key is absent
- **THEN** the tool SHALL return a text result: "No routing config found for role: <role>"

### Requirement: Tool description contains agent selection guidance

The `subagent` tool's `description` field SHALL include an inline mapping of task types to agent types, formatted as a compact reference table. This guidance SHALL be visible to the LLM whenever the tool definition is in context.

#### Scenario: Tool description includes selection table

- **WHEN** the LLM inspects available tools
- **THEN** the `subagent` tool description SHALL contain entries like "Code search / file exploration → Explore" and "Implementation from plan → implementer"

#### Scenario: Agent selection guidance does not include model names

- **WHEN** the LLM reads the tool description
- **THEN** the description SHALL reference agent types (Explore, Plan, etc.) but SHALL NOT list specific model names, provider identifiers, or effort levels
