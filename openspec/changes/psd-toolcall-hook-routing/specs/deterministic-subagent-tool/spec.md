## MODIFIED Requirements

### Requirement: Deterministic routing is provided by a tool_call hook, not by a tool registration

PSD SHALL provide deterministic model and thinking resolution for
subagent calls by hooking Pi's `tool_call` event for
`toolName === "subagent"`. PSD SHALL NOT register a tool named
`subagent` (this removes the first-writer-wins conflict against
pi-subagents' native `subagent` tool). All routing semantics
(case-insensitive role lookup, per-model thinking override,
ordered-list first-model selection, config-error blocking,
LLM-value overwrite) are defined in
`specs/toolcall-hook-routing/spec.md`.

#### Scenario: PSD does not register a competing subagent tool
- **WHEN** PSD's extension factory runs at session start
- **THEN** `pi.registerTool()` SHALL NOT be called with a tool whose
  `name === "subagent"`
- **AND** the only `subagent` tool in the registry SHALL be
  pi-subagents' native one

#### Scenario: Routing still happens for every subagent call
- **WHEN** the LLM calls the `subagent` tool
- **THEN** PSD's hook SHALL intercept the call and inject routing
  values (or block the call on config error)
- **AND** the user SHALL observe deterministic model/thinking
  selection from `model-routing.yml`

#### Scenario: subagent_manual is unaffected
- **WHEN** the LLM calls `subagent_manual`
- **THEN** the hook SHALL NOT intercept the call (per
  `specs/toolcall-hook-routing/spec.md`)
- **AND** the tool SHALL continue to honor the LLM-supplied
  `model` and `thinking` parameters

### Requirement: Existing role-lookup semantics move into the hook

The case-insensitive direct match of `subagent_type` against YAML role
keys, and the per-model thinking override (per-model value wins over
role default), are preserved verbatim in the new hook implementation.
See `specs/toolcall-hook-routing/spec.md` Requirement "Model and
thinking resolved from model-routing.yml" for the authoritative
behavior.

#### Scenario: Role lookup is still case-insensitive
- **WHEN** the LLM calls `subagent(subagent_type: "EXPLORE", ...)` and
  the YAML role key is `explore`
- **THEN** the routing SHALL match `EXPLORE` to `explore` (case
  insensitive)

#### Scenario: Per-model thinking override still wins for first model
- **WHEN** `roles.reviewer.thinking: high` and the first model entry
  is `opus: { thinking: xhigh }`
- **THEN** routing for the first model SHALL use
  `thinking: "xhigh"` (per-model override over role default)

### Requirement: Config-error behavior moves into the hook

The error message formats for missing config file, invalid YAML,
missing role, and empty models list are preserved verbatim in the
new hook. They are now delivered as `ToolCallEventResult` `reason`
strings instead of `textResult` from an `execute` method. See
`specs/toolcall-hook-routing/spec.md` Requirement "Block the call on
config errors" for the authoritative behavior.

#### Scenario: Missing config still blocks the call
- **WHEN** `model-routing.yml` does not exist at the expected path
- **THEN** the hook SHALL return
  `{ block: true, reason: "Model routing config not found at <path>" }`
- **AND** the LLM SHALL receive the reason as a tool result

#### Scenario: Unknown role still blocks the call
- **WHEN** `event.input.subagent_type === "custom-agent"` and no YAML
  role key matches `custom-agent` (case insensitive)
- **THEN** the hook SHALL return
  `{ block: true, reason: "No routing config found for agent type custom-agent. Add a role entry to model-routing.yml." }`

## REMOVED Requirements

### Requirement: Tool description contains agent selection guidance
**Reason**: PSD no longer registers a `subagent` tool whose
`description` field it controls. The agent-selection guidance that
previously lived in that description is no longer feasible.
**Migration**: Pi-subagents' native `subagent` tool already includes
agent-selection guidance in its description (it lists available
agent types and the inheritance of `model` and `thinking`
parameters). PSD does not duplicate or override this. The
`routing-table-injection` capability is removed; see
`specs/routing-table-injection/spec.md`.
