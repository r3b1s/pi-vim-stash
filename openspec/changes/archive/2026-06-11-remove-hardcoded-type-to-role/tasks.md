## 1. Config changes

- [x] 1.1 Remove `TYPE_TO_ROLE` map and its export from `src/config.ts`
- [x] 1.2 Change `resolveModelsForType` to match agent type directly against YAML role keys using case-insensitive comparison
- [x] 1.3 Add `console.warn()` when agent type has no matching role, preserving the existing error return to LLM
- [x] 1.4 Update YAML: rename `explorer` → `Explore`, `planner` → `Plan`, `cheap` → `general-purpose`, and rename `effort` → `thinking` in `~/.pi/agent/model-routing.yml`

## 2. License

- [x] 2.1 Change `license` field in `package.json` to `MIT`

## 3. Non-blocking get_subagent_result

- [x] 3.1 Create `src/tools/get-result.ts` with non-blocking `get_subagent_result` tool
- [x] 3.2 Tool accepts `agent_id`, `wait` (ignored), `verbose` (accepted, no effect) parameters
- [x] 3.3 Tool uses `SubagentsService.getRecord()` — never awaits `record.promise`
- [x] 3.4 Format output with agent ID, type, status, tool uses, duration, result/error
- [x] 3.5 Running agents return: "Agent is still running. Call get_subagent_result again to check its status."
- [x] 3.6 Register tool in `src/index.ts` (name collision with pi-subagents' `get_subagent_result`)

## 4. Tests

- [x] 4.1 Remove all TYPE_TO_ROLE tests from `test/config.test.ts`
- [x] 4.2 Add test: agent type matches YAML role case-insensitively
- [x] 4.3 Add test: agent type with no matching role returns error and logs warning
- [x] 4.4 Add test: all existing agent types resolve correctly against renamed YAML keys
- [x] 4.5 Add test: `get_subagent_result` returns immediately for running agents (no blocking)
- [x] 4.6 Add test: `get_subagent_result` returns result for completed agents
- [x] 4.7 Add test: `get_subagent_result` returns error for unknown agent ID
- [x] 4.8 Add test: `get_subagent_result` accepts `wait` parameter but ignores it

## 5. Verification

- [x] 5.1 Verify `pnpm run check` passes (TypeScript)
- [x] 5.2 Verify `pnpm run test` passes — 79/79 ✅
- [x] 5.3 Verify `pnpm run lint` passes (Biome)
