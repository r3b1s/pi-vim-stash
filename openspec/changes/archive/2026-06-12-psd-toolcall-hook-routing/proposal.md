## Why

`@r3b1s/pi-subagents-deterministic` (PSD) currently registers `subagent` and
`get_subagent_result` tools whose names collide with the same-named tools
shipped by `@gotgenes/pi-subagents`. In Pi v0.79.1's tool registry, the first
writer wins and the second registration is silently dropped. Because
pi-subagents is the base package and is loaded before PSD by convention,
pi-subagents' tools win and PSD's deterministic routing layer is never
exercised. Pi also emits scary-looking (but non-fatal) conflict diagnostics
on every session start, which is a poor user experience.

The fix is to stop fighting the registry. Instead of registering a
competing `subagent` tool, PSD should hook Pi's `tool_call` event for
`toolName === "subagent"`, resolve the deterministic model and thinking
level from `model-routing.yml`, and mutate `event.input` to inject those
values before pi-subagents' `subagent` tool actually executes. This gives
us deterministic routing without registering a conflicting tool.

The `subagent_manual` escape hatch stays registered (no collision exists —
pi-subagents does not define that name) and the public `setSpawner()` /
`setResultProvider()` exports are preserved so PTS composition and any
downstream callers continue to compile and link.

## What Changes

- **Stop registering `subagent` and `get_subagent_result` tools** in PSD's
  extension entry point — removes the name collision with
  `@gotgenes/pi-subagents`
- **Add a `pi.on("tool_call", ...)` handler** that fires for
  `toolName === "subagent"`, reads `agent/model-routing.yml` from the pi
  config directory, resolves the role's first model and the resolved
  `thinking` value (per-model override > role default), and mutates
  `event.input.model` and `event.input.thinking` in place
- **Block the call with a clear `reason` string** when the YAML is missing,
  invalid, or the role key is unknown — the call must not proceed with
  silently-degraded routing
- **Always overwrite** any `model` or `thinking` the LLM may have already
  set on the call — the routing config is authoritative
- **Keep `subagent_manual` tool registration** — no name conflict with
  pi-subagents
- **Keep `setSpawner()` and `setResultProvider()` exports** for API
  stability; PSD's deterministic routing no longer uses the spawner
  internally (the hook only mutates `event.input`; the spawn is
  performed by pi-subagents' tool). `setSpawner` remains functional
  for `subagent_manual`. The exports stay so pi-tmux-sessionizer and
  any other consumer keeps compiling.
- **Remove `GetSubagentResultTool` and `SubagentDeterministicTool`**
  classes from `src/tools/`. The `config.ts` model-routing reader stays
  unchanged because the hook reuses it
- **Update tests** to cover the hook path: model injection, thinking
  injection, block-on-error, overwrite semantics, no-op when the LLM did
  not call `subagent`, and a regression test that PSD no longer
  registers the conflicting tools
- **Update READMEs** to remove the "load PSD after pi-subagents" warning
  (no longer relevant) and document the new hook-based architecture

## Capabilities

### New Capabilities

- `toolcall-hook-routing`: PSD uses Pi's `tool_call` event hook to
  intercept calls to `subagent` and inject deterministic `model` and
  `thinking` values resolved from `agent/model-routing.yml` into
  `event.input` before the tool executes. Blocks the call with a clear
  reason on config errors.

### Modified Capabilities

- `deterministic-subagent-tool`: rewrite the requirements from
  "register a tool that overrides pi-subagents' `subagent`" to "hook the
  `tool_call` event for the existing pi-subagents `subagent` tool and
  mutate `event.input`". The semantics for case-insensitive role lookup,
  per-model thinking override, and ordered-list first-model selection all move
  into the hook path.
- `pluggable-spawner`: clarify that `setSpawner()` and the `Spawner`
  type are kept as public exports for API stability but no longer used
  internally by PSD (the hook does not call a spawner). The exports
  continue to accept calls without error.

### Removed Capabilities

- `routing-table-injection`: drop the requirements that were predicated
  on PSD owning a tool with a mutable `description` field. The
  selection guidance that previously lived in PSD's `subagent` tool
  description is no longer feasible; we keep only the model-name and
  thinking-level opacity rules in their spirit by noting they apply to
  the agent-selection guidance in pi-subagents' native tool
  description.
- `non-blocking-result`: PSD no longer registers a `get_subagent_result`
  tool. The non-blocking semantics previously provided by PSD's version
  are not preserved by the upstream tool (pi-subagents honors
  `wait: true` and blocks). This is an explicit user-facing change.

## Impact

- **Modified package**: `packages/pi-subagents-deterministic/`
- **Files removed**: `src/tools/deterministic.ts`,
  `src/tools/get-result.ts` (the tool classes; the
  `setResultProvider` export moves to a tiny standalone file)
- **Files added**: `src/hook.ts` (the `tool_call` handler)
- **Files unchanged**: `src/config.ts` (reused by hook), `src/tools/manual.ts`,
  `src/tools/spawner.ts`, `src/tools/helpers.ts`, `src/index.ts`
  (rewritten to register `subagent_manual` and `tool_call` hook only)
- **Public API surface change**: PSD's package `exports` lose nothing
  visible to TypeScript consumers — `setSpawner` and `setResultProvider`
  remain importable. At runtime they become no-ops for PSD's own code
  paths but PTS and other consumers can still call them.
- **Tool registry change**: only `subagent_manual` is registered. The
  first-writer-wins conflict against pi-subagents' `subagent` and
  `get_subagent_result` is gone.
- **Load order**: irrelevant for tool registration. PSD's hook always
  fires whenever any extension's `subagent` tool is called.
- **Configuration**: still reads `agent/model-routing.yml` from the pi
  config directory at tool-call time — no caching, fresh read per call
- **PTS composition**: `setSpawner` injection by PTS becomes a no-op for
  PSD's own code path. The actual `subagent` call now flows through
  pi-subagents' tool, which calls `SubagentsService.spawn()`. PTS's
  tmux-window observability is no longer triggered by PSD-routed
  spawns; PTS users who want tmux observability must use
  `subagent_manual` (which still routes through `setSpawner`) or run
  without PSD. This is a documented user-facing trade-off.
- **No changes** to pi-subagents source, pi-harness-cfg, or agent
  definitions
- **Scary conflict diagnostics** emitted by Pi v0.79.1 are eliminated
