## Why

The `TYPE_TO_ROLE` map in `config.ts` hardcodes 8 agent-type-to-role translations. Every new agent type (custom agent `.md` file) requires a code change to add a mapping entry. This defeats the purpose of user-defined custom agents — you can create the `.md` file but the routing config silently ignores it until a mapping is manually added to the extension source.

## What Changes

- **Remove `TYPE_TO_ROLE` map** from `config.ts`. Replace with direct case-insensitive match: agent type string → YAML role key.
- **Override `get_subagent_result`**: Register a version that ignores `wait: true` (always non-blocking). Uses pi-subagents' `SubagentsService.getRecord()` for agent state. Prevents the parent orchestrator from getting stuck in a permanent waiting state when subagents hang.
- **License change**: Apache-2.0 → MIT for consistency with other pi-things packages.
- **Unknown agent types**: Log a warning to console + return text error to LLM (same user-visible behavior, simpler implementation).
- **YAML key rename required**: Existing `model-routing.yml` files using the old role names (`explorer`, `planner`, `cheap`) must be updated to use agent type names directly (`Explore`, `Plan`, `general-purpose`).

## Capabilities

### New Capabilities
- `non-blocking-result`: A `get_subagent_result` tool that ignores `wait: true` — always returns immediately, preventing the parent orchestrator from getting stuck.

### Modified Capabilities
- `deterministic-subagent-tool`: Model resolution no longer uses a hardcoded translation table. Agent types match YAML role keys directly (case-insensitive).

## Impact

- `src/config.ts`: Remove `TYPE_TO_ROLE` export, update `resolveModelsForType()` to do direct case-insensitive lookup
- `src/tools/deterministic.ts`: No changes (consumes `resolveModelsForType()`, same interface)
- `src/tools/manual.ts`: No changes (bypasses routing entirely)
- `src/tools/get-result.ts`: **New file** — non-blocking get_subagent_result tool (overrides pi-subagents' version)
- `src/index.ts`: Register the new get_subagent_result tool
- `test/config.test.ts`: Remove TYPE_TO_ROLE tests, update role resolution tests for direct matching
- `test/tools.test.ts`: Update any tests referencing TYPE_TO_ROLE; add get-result tests
- `package.json`: License field → `MIT`
- User's `~/.pi/agent/model-routing.yml`: Manual rename of role keys
