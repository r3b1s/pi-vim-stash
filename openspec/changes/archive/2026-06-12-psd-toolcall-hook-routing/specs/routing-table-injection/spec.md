## REMOVED Requirements

### Requirement: Tool description contains agent selection mapping
**Reason**: PSD no longer registers a `subagent` tool whose
`description` field it controls. The previous implementation put a
compact task → agent-type reference table into PSD's tool
description; under the new hook-based architecture, the LLM sees
pi-subagents' native `subagent` tool description, which is not
modifiable from an extension.
**Migration**: Pi-subagents' native `subagent` tool already provides
agent-selection guidance in its description: it lists all available
agent types, gives short per-type usage hints ("Use Explore for
codebase searches and code understanding", etc.), and documents
that `model` and `thinking` can be supplied per call. PSD does not
duplicate this; the routing-table-injection capability is retired.

### Requirement: Selection guidance excludes model names and effort levels
**Reason**: This requirement was predicated on PSD owning the
`subagent` tool description. With PSD no longer owning that tool,
the rule no longer applies to PSD's behavior. The rule's spirit
("model and thinking values stay opaque to the LLM in normal
operation") is preserved in a stronger form: the new
`tool_call` hook always overwrites whatever `model` and `thinking`
the LLM passes, so the LLM's perception of which model is used is
governed entirely by `model-routing.yml` even when the LLM
attempts to specify one.
**Migration**: See
`specs/toolcall-hook-routing/spec.md` Requirement "Routing values
always overwrite LLM-provided values".

### Requirement: Tool description is the primary agent-selection mechanism
**Reason**: The previous spec required PSD to NOT inject routing
information via `before_agent_start` or modify the system prompt.
Under the new architecture, PSD does not own a tool description
field, so this constraint is moot. There is currently no
replacement mechanism: PSD does not inject any routing
information into the session context.
**Migration**: No replacement. The agent-selection guidance lives
in pi-subagents' native `subagent` tool description. If the user
wants additional guidance in the system prompt, that is a separate
extension responsibility and is out of scope for this change.
