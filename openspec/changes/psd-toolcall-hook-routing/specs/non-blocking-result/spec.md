## REMOVED Requirements

### Requirement: get_subagent_result is always non-blocking
**Reason**: PSD no longer registers a `get_subagent_result` tool.
The previous implementation provided an always-non-blocking version
that ignored `wait: true`. Removing the registration eliminates the
first-writer-wins conflict against pi-subagents' native
`get_subagent_result` tool, which was the root cause of silent
failures and scary-looking conflict diagnostics in Pi v0.79.1.
**Migration**: Pi-subagents' native `get_subagent_result` tool
honors `wait: true` and blocks until the agent completes. The
default behavior (`wait: false` or omitted) is non-blocking — it
returns the current status without waiting. The LLM can choose to
block explicitly with `wait: true` when desired. The non-blocking
default preserves the most common usage pattern; users who need
always-non-blocking semantics can simply omit `wait` or pass
`wait: false`.

### Requirement: Tool handles all SubagentStatus values
**Reason**: PSD no longer has a `get_subagent_result` tool with
custom status handling. Status formatting and rendering is now the
responsibility of pi-subagents' native tool.
**Migration**: Pi-subagents' native `get_subagent_result` tool
formats output for all `SubagentStatus` values (running, queued,
completed, error, etc.) and exposes `wait` and `verbose`
parameters. No PSD-side handling is required.

### Requirement: Tool delegates to SubagentsService.getRecord()
**Reason**: PSD no longer has a `get_subagent_result` tool that
calls `SubagentsService.getRecord()`. Record lookup is performed by
pi-subagents' native tool internally.
**Migration**: No user-facing change. The LLM still receives
formatted agent records; the call path is now
LLM → pi-subagents' `get_subagent_result` → `SubagentsService.getRecord()`.

### Requirement: verbose parameter is accepted but not supported
**Reason**: PSD no longer has a `get_subagent_result` tool that
defines its own `verbose` parameter. Pi-subagents' native tool
supports `verbose: true` and includes the full conversation
history when set — this is actually a strict improvement over the
previous PSD behavior, which accepted the parameter but ignored
it.
**Migration**: No action required. Users who pass `verbose: true`
now get conversation history in the result instead of silent
ignore. This is a strict enhancement, not a regression.

### Requirement: setResultProvider injection mechanism
**Reason**: The `setResultProvider` API was designed to let PTS
inject its tracker-based result lookup so PSD's
`get_subagent_result` tool could return PTS results via the
first-writer-wins-immune provider-delegation pattern. With PSD no
longer registering `get_subagent_result`, the provider has no
consumer inside PSD. The export is preserved for API stability (per
the change requirements), but it has no effect on PSD's behavior.
**Migration**: PTS users continue to receive correct results
because PTS registers its own `get_subagent_result` tool (which
wins the first-writer-wins race against pi-subagents' native one)
and reads from its in-memory tracker directly. The
`setResultProvider` call by PTS becomes a silent no-op when PSD is
also installed. The export is preserved so existing imports keep
type-checking; downstream code can keep calling `setResultProvider`
without error, but the call has no functional effect.
