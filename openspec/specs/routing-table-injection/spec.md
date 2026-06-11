## ADDED Requirements

### Requirement: Tool description contains agent selection mapping

The `subagent` tool's `description` field SHALL include a compact reference table mapping task types to agent types. This guidance SHALL be formatted as a simple list readable by the LLM at tool-selection time.

#### Scenario: Selection table appears in tool description

- **WHEN** the LLM receives the tool definition for `subagent`
- **THEN** the `description` field SHALL contain entries covering the standard agent types (Explore, websearch, Plan, implementer, reviewer, retro, reflect, general-purpose)

#### Scenario: Each entry maps a task category to an agent type

- **WHEN** the LLM reads the selection guidance
- **THEN** each entry SHALL follow the pattern: task description → agent type name (e.g., "Code search / file exploration → Explore")

### Requirement: Selection guidance excludes model names and effort levels

The tool description SHALL reference agent types only. It SHALL NOT expose model names, provider identifiers, effort levels, or any values from `model-routing.yml`. Model and effort resolution SHALL remain opaque to the LLM.

#### Scenario: No model names in tool description

- **WHEN** the LLM reads the `subagent` tool description
- **THEN** no specific model identifiers (e.g., "gpt-5.5", "deepseek-v4-flash", "opus") SHALL appear in the description text

#### Scenario: No effort levels in tool description

- **WHEN** the LLM reads the `subagent` tool description
- **THEN** no thinking effort levels (e.g., "high", "low", "xhigh") SHALL appear in the description text

### Requirement: Tool description is the primary agent-selection mechanism

The extension SHALL NOT inject routing information into the session context via `before_agent_start` or modify the system prompt. The tool description SHALL be the sole mechanism for agent-selection guidance.

#### Scenario: No session context injection

- **WHEN** a new session starts
- **THEN** the extension SHALL NOT inject any routing messages or modify the system prompt via `before_agent_start`

#### Scenario: Agent type selection guidance always visible at call time

- **WHEN** the LLM considers calling the `subagent` tool (the tool definition is in context)
- **THEN** the selection guidance SHALL be present in the tool's `description` field without requiring the LLM to load a separate skill file
