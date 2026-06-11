## ADDED Requirements

### Requirement: get_subagent_result is always non-blocking

The extension SHALL register a `get_subagent_result` tool that overrides pi-subagents' version. The tool SHALL accept `agent_id`, `wait`, and `verbose` parameters but SHALL always ignore `wait: true` — it SHALL return immediately regardless of the agent's running status.

#### Scenario: Running agent returns status immediately

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123", wait: true)` and the agent is still running
- **THEN** the tool SHALL return immediately with a status message: "Agent is still running. Call get_subagent_result again to check its status." It SHALL NOT block.

#### Scenario: Queued agent returns status immediately

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123")` and the agent is queued
- **THEN** the tool SHALL return a non-terminal status message, same as for running agents

#### Scenario: Steered agent returns status immediately

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123")` and the agent has been steered
- **THEN** the tool SHALL return a non-terminal status message, same as for running agents

#### Scenario: Completed agent returns result

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123")` and the agent has completed
- **THEN** the tool SHALL return the agent's result text, status, tool use count, and duration

#### Scenario: Aborted agent returns terminal status

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123")` and the agent was aborted
- **THEN** the tool SHALL return the agent's status, available result/error, tool use count, and duration

#### Scenario: Stopped agent returns terminal status

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123")` and the agent was stopped
- **THEN** the tool SHALL return the agent's status, available result/error, tool use count, and duration

#### Scenario: Failed agent returns error

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123")` and the agent has errored
- **THEN** the tool SHALL return the agent's error message

#### Scenario: Unknown agent ID returns error

- **WHEN** the LLM calls `get_subagent_result(agent_id: "nonexistent")`
- **THEN** the tool SHALL return: "Agent not found: nonexistent. It may have been cleaned up."

### Requirement: Tool delegates to SubagentsService.getRecord()

The `get_subagent_result` tool SHALL use `SubagentsService.getRecord()` to retrieve agent state. It SHALL NOT access pi-subagents' internal `Subagent` type or `SubagentManager`.

#### Scenario: Uses SubagentsService public API

- **WHEN** the tool executes
- **THEN** it SHALL call `SubagentsService.getRecord(agent_id)` and format the returned `SubagentRecord`

### Requirement: verbose parameter is accepted but not supported

The tool SHALL accept a `verbose` parameter for API compatibility with pi-subagents' version, but SHALL NOT include full conversation history in the output (SubagentRecord does not expose it). The verbose parameter SHALL have no effect on output.

#### Scenario: verbose parameter accepted silently

- **WHEN** the LLM calls `get_subagent_result(agent_id: "abc123", verbose: true)`
- **THEN** the tool SHALL return normally without conversation history, and SHALL NOT throw an error
