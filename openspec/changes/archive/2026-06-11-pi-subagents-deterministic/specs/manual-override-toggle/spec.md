## ADDED Requirements

### Requirement: subagent_manual tool is always registered and visible

The extension SHALL register a `subagent_manual` tool that is always visible to the LLM, alongside the deterministic `subagent` tool. No toggle commands or `setActiveTools()` are used to hide or show either tool.

#### Scenario: subagent_manual appears in tool list

- **WHEN** the LLM receives the tool definitions for the session
- **THEN** `subagent_manual` SHALL be present in the available tools

#### Scenario: Both tools coexist

- **WHEN** the LLM receives the tool definitions for the session
- **THEN** both `subagent` (deterministic) and `subagent_manual` (escape hatch) SHALL be visible

### Requirement: subagent_manual accepts model and thinking parameters

The `subagent_manual` tool's parameter schema SHALL include optional `model` (string) and `thinking` (string) parameters in addition to the base subagent parameters.

#### Scenario: Manual tool includes model parameter

- **WHEN** the LLM inspects the `subagent_manual` tool definition
- **THEN** its parameter schema SHALL contain an optional `model` field

#### Scenario: Manual tool includes thinking parameter

- **WHEN** the LLM inspects the `subagent_manual` tool definition
- **THEN** its parameter schema SHALL contain an optional `thinking` field

### Requirement: subagent_manual requires model or thinking

When called without explicit overrides, `subagent_manual` SHALL return an error directing the LLM to use the deterministic tool.

#### Scenario: subagent_manual called without model and without thinking

- **WHEN** the LLM calls `subagent_manual` without providing `model` and without providing `thinking`
- **THEN** the tool SHALL return an error: `"subagent_manual requires at least model or thinking. Use subagent for automatic routing."`

### Requirement: subagent_manual bypasses model-routing.yml

The `subagent_manual` tool's `execute` function SHALL pass the LLM-provided `model` and `thinking` values directly to `SubagentsService.spawn()` without reading or consulting `model-routing.yml`.

#### Scenario: Manual tool uses LLM-provided model

- **WHEN** the LLM calls `subagent_manual(subagent_type: "Explore", model: "opus", ...)`
- **THEN** `SubagentsService.spawn()` SHALL be called with `options.model` set to `"opus"`

#### Scenario: Manual tool uses LLM-provided thinking

- **WHEN** the LLM calls `subagent_manual(subagent_type: "reviewer", model: "gpt-5.5", thinking: "high", ...)`
- **THEN** `SubagentsService.spawn()` SHALL be called with both the specified model and thinking mapped to `options.thinkingLevel`

### Requirement: subagent_manual mirrors deterministic tool's other parameters

The `subagent_manual` tool SHALL accept the same non-model/thinking parameters as the deterministic `subagent` tool: `subagent_type`, `prompt`, `description` (required); `run_in_background`, `inherit_context`, `max_turns`, `resume` (optional).

#### Scenario: Manual tool accepts base parameters

- **WHEN** the LLM calls `subagent_manual` with `run_in_background`, `inherit_context`, `max_turns`, or `resume`
- **THEN** those parameters SHALL be passed through to `SubagentsService.spawn()` with the same semantics as the deterministic tool

### Requirement: Both subagent and subagent_manual coexist without toggling

Both tools SHALL be registered at extension start and remain visible for the entire session. No slash commands, hooks, or session-state logic SHALL hide or swap between the two tools.

#### Scenario: No toggle commands exist

- **WHEN** the user types `/model-override` or `/model-default`
- **THEN** no matching slash command SHALL be registered; the command SHALL be unrecognized

#### Scenario: Tools persist across session boundaries

- **WHEN** the user creates a new session or switches sessions
- **THEN** both `subagent` and `subagent_manual` SHALL remain registered and visible, with no reset or state change
