## MODIFIED Requirements

### Requirement: Model and thinking resolved from model-routing.yml

When the `subagent` tool executes, it SHALL read `agent/model-routing.yml` from the pi config directory and perform a case-insensitive direct match of the `subagent_type` against YAML role keys. It SHALL use the first model in the matched role's ordered model list and apply the role's configured thinking level (with per-model override support). On spawn failure, it SHALL iterate the ordered model list. No translation table (TYPE_TO_ROLE) SHALL exist.

#### Scenario: Explorer agent gets cheap model with low thinking

- **WHEN** the LLM calls `subagent(subagent_type: "Explore", ...)`
- **THEN** the tool SHALL case-insensitively match `Explore` against YAML role keys and use the first model under the matched key with the role's configured `thinking`

#### Scenario: Implementer agent gets high thinking

- **WHEN** the LLM calls `subagent(subagent_type: "implementer", ...)`
- **THEN** the tool SHALL case-insensitively match `implementer` against YAML role keys and apply the matched role's `thinking` level

#### Scenario: Case-insensitive match

- **WHEN** the LLM calls `subagent(subagent_type: "EXPLORE", ...)` and YAML has key `explore`
- **THEN** the tool SHALL match `EXPLORE` to `explore` via case-insensitive comparison

#### Scenario: Unknown agent type returns error

- **WHEN** the LLM calls `subagent(subagent_type: "custom-agent", ...)` and no YAML role key matches `custom-agent` (case-insensitive)
- **THEN** the tool SHALL log a warning to console and return an error: "No routing config found for role: custom-agent"

### Requirement: Tool delegates to SubagentsService

The `subagent` tool's `execute` function SHALL call `@gotgenes/pi-subagents`' `SubagentsService.spawn()` with the resolved model and thinking level (mapped to `thinkingLevel`), passing through all other parameters (`subagent_type`, `prompt`, `description`, `run_in_background`, `inherit_context`, `max_turns`). The `resume` parameter SHALL NOT be accepted. When `runInBackground` is false (foreground), the tool SHALL set `options.foreground = true` (mapping `run_in_background: false` → `foreground: true`). When `runInBackground` is undefined (implicit background), the tool SHALL NOT set `foreground` (letting pi-subagents default to background).

#### Scenario: SubagentsService receives resolved model

- **WHEN** the tool resolves model `deepseek-v4-flash` for an agent
- **THEN** `SubagentsService.spawn()` SHALL be called with `options.model` set to `"deepseek-v4-flash"` and `options.foreground` SHALL NOT be set (implicit background)

#### Scenario: Background-only execution returns agent ID

- **WHEN** the LLM calls `subagent` without `run_in_background`
- **THEN** the tool SHALL spawn via `SubagentsService.spawn()` without setting `foreground` and return the agent ID for later retrieval via `get_subagent_result`

#### Scenario: Explicit foreground spawn

- **WHEN** the LLM calls `subagent` with `run_in_background: false`
- **THEN** the tool SHALL spawn via `SubagentsService.spawn()` with `options.foreground = true`

#### Scenario: Explicit background spawn

- **WHEN** the LLM calls `subagent` with `run_in_background: true`
- **THEN** the tool SHALL spawn via `SubagentsService.spawn()` without setting `foreground`

#### Scenario: Success return contains agent ID

- **WHEN** the tool successfully spawns a subagent
- **THEN** it SHALL return a text result containing the agent ID for retrieval via `get_subagent_result`

#### Scenario: resume parameter not accepted

- **WHEN** the LLM calls `subagent` with `resume` parameter
- **THEN** the tool SHALL ignore the `resume` value (SubagentsService has no resume API)
