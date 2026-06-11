## Context

`pi-subagents-deterministic` currently uses a `TYPE_TO_ROLE` map to translate agent types (e.g., `"Explore"`) to YAML role keys (e.g., `"explorer"`). This map has 9 entries and must be manually updated whenever a new agent type is added. User-defined custom agents (from `.pi/agents/*.md`) can't be routed without editing the extension source.

## Goals / Non-Goals

**Goals:**
- Remove the hardcoded `TYPE_TO_ROLE` map entirely
- Direct case-insensitive match between agent type string and YAML role key
- Unknown agent types: log warning, return error to LLM (same user-visible behavior)
- Override `get_subagent_result` to always be non-blocking (ignore `wait: true`)
- License: MIT (matching other pi-things packages)

**Non-Goals:**
- No YAML schema changes (the user renames keys manually)
- No migration automation for existing YAML files
- No runtime auto-detection of available agent types from the filesystem
- No timeout or abort mechanism for stuck subagents (the non-blocking result tool prevents the parent from blocking, but stuck agents still require external intervention)

## Decisions

### Decision 1: Direct case-insensitive match

`resolveModelsForType("Explore")` → looks up `"explore"` in lowercased YAML keys. No translation table. The user's YAML keys must match agent type names (e.g., `Explore:`, not `explorer:`).

**Rationale:** 1-to-1 is simpler, zero maintenance. Case-insensitivity prevents trivial mismatch errors.

**Alternative considered:** Keep the map but make it configurable via YAML. Rejected — adds complexity without benefit. If YAML keys already match agent names, the map is redundant.

### Decision 2: Unknown types return error

When an agent type has no matching YAML role, `resolveModelsForType()` returns an error message string. The caller in `deterministic.ts` surfaces this to the LLM. Behavior unchanged — only the lookup mechanism changes.

### Decision 3: MIT license

Change `package.json` license from `Apache-2.0` to `MIT`. Matches `pi-vim-stash`, `pi-token-killer`, and `pi-holo-mem`.

### Decision 4: Non-blocking get_subagent_result override

**Chosen**: Register a `get_subagent_result` tool that overrides pi-subagents' version. It accepts the same parameters (`agent_id`, `wait`, `verbose`) but always ignores `wait: true` — never blocks the parent.

Internally, it calls `SubagentsService.getRecord(id)` to get agent state. If the agent is still running, it returns a status message. If completed, it returns the result. The `record.promise` await (the blocking mechanism) is never invoked.

**Rationale**: pi-subagents' `get_subagent_result` with `wait: true` blocks the parent by awaiting `record.promise`. If the subagent hangs (loop, rate limit retry, stuck tool), the parent is stuck forever with no escape. The non-blocking override prevents this by always returning immediately.

**Trade-off**: The override loses rich formatting from pi-subagents' version (display names, token stats, duration). The output uses a simpler format from `SubagentRecord` fields. Verbose mode (full conversation history) is not supported since `SubagentRecord` doesn't expose it.

## Risks / Trade-offs

- **Existing YAML files break silently**: Users with old key names (`explorer`, `planner`, `cheap`) will get "no routing config found" errors until they rename keys. This is acceptable — the only user is r3b1s, and the rename is documented in the proposal.
- **Case sensitivity edge cases**: Lowercasing both sides handles most cases. Unicode case folding is not needed for ASCII agent names.
- **get_subagent_result override loses verbose mode**: The `SubagentRecord` interface doesn't expose conversation history. Users needing full transcripts must use pi-subagents' original tool or access session files directly.
- **Completion notification leak**: The non-blocking get_subagent_result uses SubagentRecord which has no notification field. Completion notifications may persist after result retrieval because the tool cannot call markConsumed() or cancelNudge(). This is a known trade-off; pi-subagents would need to expose notification control in its public API to fix.
- **Case-insensitive collision**: Case-insensitive matching means YAML keys differing only in case collide. The first key in parse order wins. Avoid agent types that differ only in case.
