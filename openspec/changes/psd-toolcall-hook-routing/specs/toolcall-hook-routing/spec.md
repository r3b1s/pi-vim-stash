## ADDED Requirements

### Requirement: Hook intercepts subagent tool calls

PSD SHALL register a `pi.on("tool_call", ...)` handler that fires for
`toolName === "subagent"`. The handler SHALL mutate `event.input` in
place to inject deterministic model and thinking values resolved from
`agent/model-routing.yml` before the tool executes.

#### Scenario: Handler fires only for subagent

- **WHEN** the LLM calls the `subagent` tool
- **THEN** the hook handler SHALL be invoked with the corresponding
  `ToolCallEvent` whose `toolName` is `"subagent"`
- **AND** `event.input` SHALL be a mutable object whose `model` and
  `thinking` properties the handler MAY set

#### Scenario: Handler is a no-op for other tool names

- **WHEN** the LLM calls any tool other than `subagent`
- **THEN** the hook handler SHALL return without mutating `event.input`
- **AND** no other side effects SHALL occur

#### Scenario: Handler is a no-op for subagent_manual

- **WHEN** the LLM calls `subagent_manual`
- **THEN** the hook handler SHALL return without mutating `event.input`
  (the manual tool's `model` and `thinking` are LLM-supplied and bypass
  routing)

### Requirement: Model and thinking resolved from model-routing.yml

When the hook fires, PSD SHALL read `agent/model-routing.yml` from the
pi config directory (resolved via `PI_CODING_AGENT_DIR` or
`~/.pi` default), perform a case-insensitive direct match of the
`subagent_type` value in `event.input` against YAML role keys, and
select the first model in the matched role's ordered model list with
its associated `thinking` level (per-model override > role default).

#### Scenario: Explorer role resolves to first model

- **WHEN** `event.input.subagent_type === "Explore"` and
  `model-routing.yml` has a key `Explore` with models `["cheap-model",
  "fallback-cheap"]` and `thinking: low`
- **THEN** the hook SHALL set `event.input.model = "cheap-model"` and
  `event.input.thinking = "low"`

#### Scenario: Case-insensitive match

- **WHEN** `event.input.subagent_type === "EXPLORE"` and
  `model-routing.yml` has key `explore`
- **THEN** the hook SHALL match `EXPLORE` to `explore` and resolve the
  role's first model and thinking

#### Scenario: Per-model thinking override wins for first model

- **WHEN** `model-routing.yml` has `roles.reviewer.thinking: high` and
  the first model entry is `opus: { thinking: xhigh }`
- **THEN** the hook SHALL set `thinking: "xhigh"` (per-model override
  over role default)

#### Scenario: Config read at call time, no caching

- **WHEN** the hook fires multiple times in one session
- **THEN** the hook SHALL re-read `model-routing.yml` on each call so
  edits are picked up without a session restart
- **AND** no in-process cache of the parsed config SHALL be retained
  between calls

### Requirement: Routing values always overwrite LLM-provided values

When `event.input.model` or `event.input.thinking` are already set by
the LLM (because pi-subagents' `subagent` tool schema exposes them as
optional parameters), the hook SHALL overwrite them with the values
resolved from `model-routing.yml`. The routing config is authoritative.

#### Scenario: LLM-provided model is overwritten

- **WHEN** `event.input.model === "haiku"` (set by the LLM) and the
  resolved routing model is `deepseek-v4-flash`
- **THEN** the hook SHALL set `event.input.model = "deepseek-v4-flash"`

#### Scenario: LLM-provided thinking is overwritten

- **WHEN** `event.input.thinking === "xhigh"` (set by the LLM) and the
  resolved routing thinking is `low`
- **THEN** the hook SHALL set `event.input.thinking = "low"`

#### Scenario: LLM-provided values are not preserved as a bypass path

- **WHEN** the LLM wants to bypass deterministic routing
- **THEN** the LLM SHALL call `subagent_manual` (which accepts explicit
  `model` and `thinking` and does not invoke this hook), not `subagent`
  with extra parameters

### Requirement: Block the call on config errors

If `model-routing.yml` cannot be read, parsed, or does not contain a
matching role key, the hook SHALL return a `ToolCallEventResult` with
`block: true` and a `reason` string describing the failure. The call
SHALL NOT proceed to pi-subagents' `subagent` tool with silently
degraded routing.

#### Scenario: Missing config file blocks the call

- **WHEN** `model-routing.yml` does not exist at
  `<configDir>/agent/model-routing.yml`
- **THEN** the hook SHALL return `{ block: true, reason: "Model routing
  config not found at <path>" }`
- **AND** the `subagent` tool SHALL NOT execute

#### Scenario: Invalid YAML blocks the call

- **WHEN** `model-routing.yml` contains invalid YAML syntax
- **THEN** the hook SHALL return `{ block: true, reason: "Failed to
  parse model-routing.yml: <error>" }`
- **AND** the `subagent` tool SHALL NOT execute

#### Scenario: Unknown agent type blocks the call

- **WHEN** `event.input.subagent_type === "custom-agent"` and no YAML
  role key matches `custom-agent` (case-insensitive)
- **THEN** the hook SHALL return `{ block: true, reason: "No routing
  config found for agent type custom-agent. Add a role entry to model-routing.yml." }`
- **AND** the `subagent` tool SHALL NOT execute

#### Scenario: Empty models list blocks the call

- **WHEN** a matched role has an empty `models` list
- **THEN** the hook SHALL return `{ block: true, reason: "No models
  configured for role: <role>." }`
- **AND** the `subagent` tool SHALL NOT execute

#### Scenario: Block returns a clear user-facing reason

- **WHEN** the hook blocks the call
- **THEN** the `reason` string SHALL be returned to the LLM as a tool
  result
- **AND** the LLM SHALL be able to act on the message (e.g., correct
  the agent type, ask the user to update the config)

### Requirement: Hook does not register a competing subagent tool

PSD SHALL NOT call `pi.registerTool()` with a tool whose `name` is
`"subagent"`. This removes the first-writer-wins conflict against
`@gotgenes/pi-subagents`' `subagent` tool.

#### Scenario: No subagent tool registered by PSD

- **WHEN** PSD's extension factory runs at session start
- **THEN** the registry SHALL contain exactly one tool whose name
  starts with `subagent`: pi-subagents' native `subagent` (and PSD's
  `subagent_manual`)
- **AND** PSD SHALL NOT register a tool named `subagent`

#### Scenario: Pi v0.79.1 conflict diagnostic is not emitted

- **WHEN** both PSD and pi-subagents are installed and both have
  loaded
- **THEN** Pi SHALL NOT emit a tool-registration conflict diagnostic
  for `subagent`
- **AND** Pi SHALL NOT emit a tool-registration conflict diagnostic
  for `get_subagent_result`

### Requirement: Hook is a no-op when subagent_type is absent

If `event.input` does not contain a `subagent_type` value (e.g., a
malformed call), the hook SHALL NOT mutate the input and SHALL NOT
block the call. The downstream tool's own validation handles the
malformed call.

#### Scenario: Missing subagent_type passes through

- **WHEN** `event.input` has no `subagent_type` key
- **THEN** the hook SHALL return without mutating `event.input`
- **AND** the `subagent` tool SHALL execute with the original input
