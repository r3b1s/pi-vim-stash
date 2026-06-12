## 1. Entry point refactor

- [x] 1.1 Remove `pi.registerTool(SubagentDeterministicTool)` call from `src/index.ts` — eliminates the `subagent` name conflict
- [x] 1.2 Remove `pi.registerTool(GetSubagentResultTool)` call from `src/index.ts` — eliminates the `get_subagent_result` name conflict
- [x] 1.3 Keep `pi.registerTool(SubagentManualTool)` call in `src/index.ts` — no conflict exists
- [x] 1.4 Add `pi.on("tool_call", ...)` registration in `src/index.ts` that wires the new `SubagentCallRouter` hook
- [x] 1.5 Keep the dynamic import of `@gotgenes/pi-subagents` for `subagent_manual`'s spawner fallback
- [x] 1.6 Keep the `configDir` resolution (`PI_CODING_AGENT_DIR` or `~/.pi` default)
- [x] 1.7 Keep the existing public-API re-exports of `setSpawner`, `Spawner` (type), `setResultProvider`, `ResultProvider` (type) in `src/index.ts`

## 2. New tool_call hook implementation

- [x] 2.1 Create `src/hook.ts` with a `SubagentCallRouter` class that owns the hook handler
- [x] 2.2 The hook handler accepts `(event, ctx)` and returns either `void` (allow with mutated input) or `ToolCallEventResult` (block with reason)
- [x] 2.3 The handler short-circuits when `event.toolName !== "subagent"` (return void, no mutation)
- [x] 2.4 The handler reads `agent/model-routing.yml` from the configured config directory using the existing `readModelRouting` from `src/config.ts`
- [x] 2.5 On YAML read or parse failure, return `{ block: true, reason: "Model routing config not found at <path>" }` or the corresponding parse-error message
- [x] 2.6 The handler resolves the model and thinking via the existing `resolveModelsForType` from `src/config.ts`
- [x] 2.7 On unknown agent type, return `{ block: true, reason: "No routing config found for agent type <type>. Add a role entry to model-routing.yml." }` and log a `console.warn`
- [x] 2.8 On empty models list, return `{ block: true, reason: "No models configured for role: <role>." }`
- [x] 2.9 The handler mutates `event.input.model` and `event.input.thinking` in place — always overwrites, even if the LLM set values
- [x] 2.10 On any uncaught error, return `{ block: true, reason: "Internal routing error: <message>" }` to avoid session crashes

## 3. File removals and consolidations

- [x] 3.1 Delete `src/tools/deterministic.ts` — the `SubagentDeterministicTool` class is replaced by the hook
- [x] 3.2 Delete `src/tools/get-result.ts` — the `GetSubagentResultTool` class is gone; `setResultProvider` moves to a tiny standalone file
- [x] 3.3 Create `src/tools/result-provider.ts` (or similar) that re-exports `setResultProvider`, `getResultProvider`, `resetResultProvider`, and the `ResultProvider` interface — kept for API stability, no internal consumer
    - [x] 3.3.1 Update `src/index.ts` re-export paths from `./tools/get-result` to `./tools/result-provider`
- [x] 3.4 Keep `src/tools/spawner.ts` as-is — `Spawner`, `setSpawner`, `getSpawner`, `hasCustomSpawner`, `resetSpawner` exports preserved
- [x] 3.5 Keep `src/tools/manual.ts` and `src/tools/helpers.ts` as-is
- [x] 3.6 Keep `src/config.ts` unchanged — the hook reuses `readModelRouting` and `resolveModelsForType` directly
- [x] 3.7 Update `package.json` description to remove "replacing pi-subagents' subagent tool via name collision" and replace with a hook-based description

## 4. Tests — hook behavior

- [x] 4.1 Add a new test file `test/hook.test.ts` for the `SubagentCallRouter` class
- [x] 4.2 Test: hook does not mutate input when `event.toolName !== "subagent"`
- [x] 4.3 Test: hook does not mutate input when `event.toolName === "subagent_manual"`
- [x] 4.4 Test: hook sets `event.input.model` and `event.input.thinking` from the role's first model and role-level thinking
- [x] 4.5 Test: case-insensitive role match sets model/thinking
- [x] 4.6 Test: per-model thinking override is applied (when first model has override)
- [x] 4.7 Test: hook overwrites LLM-provided `event.input.model` and `event.input.thinking` with config values
- [x] 4.8 Test: hook returns `{ block: true, reason: "Model routing config not found at <path>" }` when YAML is missing
- [x] 4.9 Test: hook returns `{ block: true, reason: "Failed to parse model-routing.yml: <error>" }` when YAML is invalid
- [x] 4.10 Test: hook returns `{ block: true, reason: "No routing config found for agent type <type>. Add a role entry to model-routing.yml." }` for unknown agent type
- [x] 4.11 Test: hook returns `{ block: true, reason: "No models configured for role: <role>." }` for empty models list
- [x] 4.12 Test: hook returns `{ block: true, reason: "Internal routing error: <message>" }` for uncaught errors
- [x] 4.13 Test: hook does not call any spawner — `setSpawner` is a no-op for the hook path
- [x] 4.14 Test: hook re-reads the YAML on every call (edit YAML between calls, observe new values)
- [x] 4.15 Add an integration test: mock `setSpawner`, invoke the hook with a `subagent` call, and assert `setSpawner` is NOT called by the hook path
- [x] 4.16 Test: hook is a no-op when `event.input.subagent_type` is missing — returns without mutating input and without blocking the call

## 5. Tests — regression and removal

- [x] 5.1 Remove the `describe("SubagentDeterministicTool", ...)` block from `test/tools.test.ts` — the class no longer exists
- [x] 5.2 Remove the `describe("GetSubagentResultTool", ...)` block from `test/tools.test.ts` — the class no longer exists
- [x] 5.3 Remove the `describe("ResultProvider", ...)` block from `test/tools.test.ts` (no consumer) or move to a focused `test/result-provider.test.ts` that tests only the API surface (set/get/reset)
- [x] 5.4 Keep the `describe("SubagentManualTool", ...)` block in `test/tools.test.ts` — the class is unchanged
- [x] 5.5 Keep the `describe("Spawner system", ...)` block in `test/tools.test.ts` — the API surface is preserved
- [x] 5.6 Add a new test in `test/hook.test.ts` (or `test/integration.test.ts`) that imports `src/index.ts` default export and asserts it does NOT call `pi.registerTool` with name `"subagent"` or `"get_subagent_result"`
- [x] 5.7 Add a new test in `test/hook.test.ts` that asserts the default export DOES call `pi.registerTool` with name `"subagent_manual"`
- [x] 5.8 Add a new test that asserts the default export registers a `pi.on("tool_call", ...)` handler

## 6. Tests — public API stability

- [x] 6.1 Add a test that `import { setSpawner } from "@r3b1s/pi-subagents-deterministic"` works (function is exported)
- [x] 6.2 Add a test that `import { setResultProvider } from "@r3b1s/pi-subagents-deterministic"` works (function is exported)
- [x] 6.3 Add a test that `import type { Spawner } from "@r3b1s/pi-subagents-deterministic"` works (type is exported)
- [x] 6.4 Add a test that `setSpawner` accepts any `Spawner` without throwing
- [x] 6.5 Add a test that `setResultProvider` accepts any `ResultProvider` without throwing
- [x] 6.6 Add a test that `setSpawner` and `setResultProvider` are no-ops for the deterministic `subagent` path (i.e., the hook does not call them)

## 7. Documentation — README updates

- [x] 7.1 Update `packages/pi-subagents-deterministic/README.md` to remove the "Load Order — must be loaded after pi-subagents" section and warning
- [x] 7.2 Add a new section "Architecture" explaining the tool_call hook approach: PSD intercepts `subagent` calls, mutates input, hands off to pi-subagents
- [x] 7.3 Update the "Configuration" section to note that routing is now enforced by the hook (always overwrites LLM-provided model/thinking)
- [x] 7.4 Add a "Behavior with pi-tmux-sessionizer" section noting the trade-off: PTS's `setSpawner` is a no-op for deterministic `subagent` calls; users who want tmux observability for deterministic routing should use `subagent_manual`
- [x] 7.5 Add a "Behavior with get_subagent_result" section noting that PSD no longer registers that tool; pi-subagents' native tool handles it (default non-blocking; opt-in blocking via `wait: true`)
- [x] 7.6 Update the "Overview" section to reflect: PSD registers only `subagent_manual` (no conflicts); the `subagent` tool is the upstream pi-subagents one
- [x] 7.7 Update any examples in the README to reflect the new architecture (no need to mention "name collision" or "load order")

## 8. CHANGELOG and release metadata

- [x] 8.1 Add a CHANGELOG entry under the next version describing: (a) the fix (no more name collision, no more scary diagnostics), (b) the breaking change (PSD no longer registers `get_subagent_result` — non-blocking default preserved, opt-in blocking via `wait: true`), (c) the API stability promise (setSpawner / setResultProvider / Spawner / ResultProvider exports preserved), (d) the PTS trade-off
- [x] 8.2 Verify the CHANGELOG entry references the `psd-toolcall-hook-routing` change

## 9. Deterministic checks

- [x] 9.1 `pnpm run check` (TypeScript) passes for the PSD package
- [x] 9.2 `pnpm run lint` (Biome) passes for the PSD package
- [x] 9.3 `pnpm run test` (Vitest) passes for the PSD package — including the new hook tests and the existing manual/spawner tests
- [x] 9.4 `pnpm run check` passes at the monorepo root
- [x] 9.5 `pnpm run lint` passes at the monorepo root
- [x] 9.6 `pnpm run test` passes at the monorepo root — including any PTS tests that import PSD's public API (composition.test.ts)
- [x] 9.7 Verify no other monorepo package references `SubagentDeterministicTool` or `GetSubagentResultTool` (search: `grep -r "SubagentDeterministicTool\|GetSubagentResultTool" packages/`)
- [x] 9.8 Verify no test file imports the removed `src/tools/deterministic` or `src/tools/get-result` modules
- [x] 9.9 Verify that pi-subagents' `subagent` tool schema accepts `model` and `thinking` as optional parameters (inspect the tool definition or check the source)
