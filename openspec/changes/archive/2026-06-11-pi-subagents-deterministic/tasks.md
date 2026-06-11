## 1. Package scaffolding

- [x] 1.1 Create `packages/pi-subagents-deterministic/` with `package.json`, `tsconfig.json`, `vitest.config.ts`
- [x] 1.2 Add `@gotgenes/pi-subagents` as peer dependency, `js-yaml` as runtime dependency, and `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` as dev dependencies
- [x] 1.2a Document in README (task 7.4-7.5)
- [x] 1.3 Add package to pnpm workspace catalog and `pnpm-workspace.yaml`
- [x] 1.4 Configure package.json `pi.extensions` pointing to `./src/index.ts`
- [x] 1.5 Add build, test, check, lint scripts matching monorepo conventions

## 2. Config reader

- [x] 2.1 Implement `readModelRouting()` — reads `agent/model-routing.yml` from pi config directory
- [x] 2.2 Implement YAML parsing with error handling (missing file, invalid syntax)
- [x] 2.3 Implement `resolveModelsForType(agentType, routing)` — maps agent type to role, returns model list with per-model thinking levels
- [x] 2.4 Hardcode `TYPE_TO_ROLE` mapping: Explore→explorer, websearch→websearch, Plan→planner, implementer→implementer, reviewer→reviewer, retro→retro, reflect→reflect, general-purpose→cheap
- [x] 2.5 Unknown agent types return error: "No routing config found for agent type X. Add a role entry to model-routing.yml."

## 3. Deterministic subagent tool

- [x] 3.0 `get_subagent_result` is provided by `@gotgenes/pi-subagents`; do not reimplement it in this extension

- [x] 3.1 Implement `SubagentDeterministicTool` class with `toToolDefinition()` and `execute()`
- [x] 3.2 Define parameter schema: `subagent_type`, `prompt`, `description` (required); `run_in_background`, `inherit_context`, `max_turns`, `resume` (optional). Exclude `model` and `thinking`. Internally map resolved `thinking` to `thinkingLevel` when calling `SubagentsService.spawn()`.
- [x] 3.3 Build tool description with inline agent-selection guidance table
- [x] 3.4 `execute()` reads model-routing.yml, resolves model/thinking, calls `SubagentsService.spawn()`; on failure, iterates role's model list (max retries = list length); returns error listing all failed models if none succeed
- [x] 3.5 Background-only execution: spawn via `SubagentsService.spawn()`, return agent ID; `get_subagent_result` for retrieval (no foreground streaming in MVP)
- [x] 3.6 Handle resume (`params.resume`) by checking/getting existing agent
- [x] 3.7 Return clear error messages for config parse failures, missing roles, service errors
- [x] 3.8 Implement `renderCall` and `renderResult` for TUI display (simple delegate to pi-subagents patterns)

## 4. subagent_manual escape hatch tool

- [x] 4.1 Implement `SubagentManualTool` class — same base parameters plus optional `model` and `thinking`
- [x] 4.2 `execute()` passes LLM-provided model/thinking directly to `SubagentsService.spawn()`, bypasses config
- [x] 4.3 Tool registered with extension as always-visible alongside `subagent` (no `setActiveTools`) — both tools coexist

## 5. Extension entry point

- [x] 5.1 Export default function `(pi: ExtensionAPI) => void`
- [x] 5.2 Resolve pi config directory for model-routing.yml path resolution
- [x] 5.3 Access `SubagentsService` via dynamic import: `const { getSubagentsService } = await import("@gotgenes/pi-subagents")`
- [x] 5.4 Register deterministic `subagent` tool (name collision with pi-subagents)
- [x] 5.5 Register `subagent_manual` tool (always visible, not hidden)
- [x] 5.6 Handle graceful degradation when pi-subagents is not loaded: log warning at startup; do not register `subagent` or `subagent_manual` tools

## 6. Tests

- [x] 6.1 Unit tests for `readModelRouting()` — valid YAML with new per-model thinking format, missing file, invalid YAML, empty file
- [x] 6.2 Unit tests for `resolveModelsForType()` — known types, unknown types (verify error returned, not fallback), missing roles in config
- [x] 6.3 Unit tests for `TYPE_TO_ROLE` mapping completeness — all default agent names covered
- [x] 6.4 Unit tests for tool parameter schema — verify model/thinking absent from deterministic, present in manual
- [x] 6.5 Unit tests for tool description — verify selection guidance present, model names absent
- [x] 6.6 Unit test: model fallback iteration — first model fails, second succeeds; all models fail → error with format `"All models failed for role <role>: tried <model1>, <model2>, <model3>."`
- [x] 6.6a Unit test: empty models list for a role returns error `"No models configured for role: <role>."`
- [x] 6.6b Unit test: subagent_manual called without model and without thinking returns error `"subagent_manual requires at least model or thinking. Use subagent for automatic routing."`
- [x] 6.7 Unit test: thinking → thinkingLevel mapping when calling SubagentsService.spawn()
- [x] 6.8 Unit test: per-model thinking override (model has thinking → use it; no override → use role default)
- [x] 6.9 Unit test: unknown agent type returns explicit error (not silent fallback)
- [x] 6.10 Unit test: js-yaml correctly parses new model-routing.yml format with per-model thinking overrides
- [x] 6.11 Integration test: deterministic tool calls SubagentsService with correct model/thinking
- [x] 6.12 Integration test: manual tool passes LLM-provided model/thinking to SubagentsService
- [x] 6.13 Integration test: both `subagent` and `subagent_manual` are registered and visible in tool list
- [x] 6.14 Integration test: model fallback with SubagentsService (mock spawn failures)
- [x] 6.15 Verify `pnpm run check` passes (TypeScript)
- [x] 6.16 Verify `pnpm run lint` passes (Biome + ESLint)
- [x] 6.17 Verify `pnpm run test` passes

## 7. Monorepo integration

- [x] 7.1 Add package to root `pnpm-workspace.yaml` workspace packages
- [x] 7.2 Verify `pnpm install` resolves all dependencies including pi-subagents peer dep and js-yaml runtime dep
- [x] 7.3 Add package to CI pipeline (check + lint + test)
- [x] 7.4 Document installation in README.md: `pi install npm:@r3b1s/pi-subagents-deterministic`
- [x] 7.5 Note dependency on `@gotgenes/pi-subagents` in README
