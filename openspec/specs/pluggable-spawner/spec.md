## MODIFIED Requirements

### Requirement: Spawner interface and setSpawner are preserved exports

PSD SHALL export the `Spawner` interface (a single
`spawn(agentType, prompt, options) => string | Promise<string>` method
matching the shape of `SubagentsService.spawn()`) and a
`setSpawner(spawner: Spawner): void` function. Both are preserved as
public API for downstream consumers (notably pi-tmux-sessionizer).

The union return type accommodates both synchronous spawners
(`SubagentsService`) and asynchronous spawners (PTS tmux spawner).
`SpawnOptions` is the same type used by
`@gotgenes/pi-subagents`' `SubagentsService.spawn()`.

#### Scenario: Spawner type is exported
- **WHEN** a third-party extension imports `{ type Spawner }` from
  `@r3b1s/pi-subagents-deterministic`
- **THEN** the exported type SHALL be a callable interface with the
  `spawn` method signature

#### Scenario: setSpawner accepts a Spawner without error
- **WHEN** a third-party extension imports `{ setSpawner }` from
  `@r3b1s/pi-subagents-deterministic` and calls
  `setSpawner(tmuxSpawner)` at any point after PSD loads
- **THEN** the call SHALL succeed and SHALL NOT throw
- **AND** subsequent calls to `subagent_manual` SHALL use the injected
  spawner (see Requirement "subagent_manual uses custom spawner")

#### Scenario: setSpawner is callable multiple times
- **WHEN** `setSpawner()` is called more than once
- **THEN** the most recent spawner replaces the previous one
- **AND** no error SHALL be thrown

### Requirement: subagent_manual uses the custom spawner when set

When a custom spawner has been registered via `setSpawner()`, the
`subagent_manual` tool SHALL route spawn calls through the custom
spawner instead of `SubagentsService.spawn()`. When no custom spawner
has been set, `subagent_manual` SHALL fall back to
`SubagentsService.spawn()` (when available) or return an error
message (when `SubagentsService` is also unavailable).

#### Scenario: subagent_manual routes through PTS spawner
- **WHEN** PTS has called `setSpawner(tmuxSpawner)` and the LLM calls
  `subagent_manual(prompt="task", model="haiku")`
- **THEN** the call SHALL route through the custom spawner (PTS), not
  `SubagentsService.spawn()`

#### Scenario: subagent_manual falls back to SubagentsService
- **WHEN** no custom spawner has been set and `SubagentsService` is
  available
- **THEN** `subagent_manual` SHALL spawn via
  `SubagentsService.spawn()` with the LLM-provided `model` and
  `thinking` (mapped to `thinkingLevel`)

#### Scenario: subagent_manual returns error when neither is available
- **WHEN** no custom spawner has been set AND `SubagentsService` is
  not available
- **THEN** `subagent_manual` SHALL return an error:
  "No spawn mechanism available. Install @gotgenes/pi-subagents or
  pi-tmux-sessionizer."

### Requirement: The new tool_call hook does not use setSpawner

PSD's `tool_call` hook for the `subagent` tool SHALL NOT call any
spawner directly. The hook only mutates `event.input` to inject
`model` and `thinking`; the actual spawn is performed by
pi-subagents' native `subagent` tool via `SubagentsService.spawn()`.
As a result, a `setSpawner()` call by an external consumer (PTS) is
a no-op for the deterministic routing path.

#### Scenario: Hook does not invoke the custom spawner
- **WHEN** PTS has called `setSpawner(tmuxSpawner)` and the LLM calls
  `subagent` (the deterministic path)
- **THEN** `tmuxSpawner.spawn()` SHALL NOT be called
- **AND** the spawn SHALL be performed by pi-subagents' `subagent`
  tool calling `SubagentsService.spawn()` with the values the hook
  injected into `event.input`

#### Scenario: Hook does not invoke the SubagentsService wrapper
- **WHEN** the LLM calls `subagent` and the hook is active
- **THEN** the hook SHALL NOT call `SubagentsService.spawn()` directly
- **AND** the actual `SubagentsService.spawn()` call SHALL originate
  from pi-subagents' `subagent` tool `execute` method after the hook
  has mutated `event.input`

### Requirement: setSpawner remains callable after the hook is registered

`setSpawner()` SHALL be callable at any time after PSD is loaded,
including after the `tool_call` hook has been registered. The
function SHALL accept the new spawner without error; whether the
new spawner is consulted depends on the calling tool (it is
consulted by `subagent_manual` and ignored by the `subagent` hook).

#### Scenario: Late setSpawner call updates subagent_manual only
- **WHEN** `setSpawner(spawnerA)` is called at PSD load, then
  `setSpawner(spawnerB)` is called after several `subagent` calls
  have been processed
- **THEN** the next `subagent_manual` call SHALL route through
  `spawnerB`
- **AND** the deterministic `subagent` hook SHALL continue to
  inject `event.input.model` and `event.input.thinking` without
  consulting either spawner

## REMOVED Requirements

### Requirement: Default spawner wraps SubagentsService for the subagent tool
**Reason**: The "default spawner wraps SubagentsService" behavior
existed to support the previous PSD-owned `subagent` tool. That tool
no longer exists; the new `subagent` hook does not call any spawner
at all. The `subagent_manual` tool still calls `SubagentsService`
when no custom spawner is set, but that is captured in the
"subagent_manual falls back to SubagentsService" scenario above.
**Migration**: See the modified Requirement "subagent_manual uses
the custom spawner when set" for the new home of the
fallback-to-SubagentsService behavior.

### Requirement: setSpawner overrides default spawner for the subagent tool
**Reason**: There is no longer a PSD-owned `subagent` tool whose
spawn path can be overridden. The `setSpawner` export is preserved
for `subagent_manual` and for downstream API stability, but the
"override the default spawner for the deterministic subagent tool"
behavior is gone by design.
**Migration**: See the modified Requirement "The new tool_call hook
does not use setSpawner" — the hook intentionally ignores
`setSpawner` and routes through pi-subagents' `subagent` tool. Users
who need PTS-style tmux observability for deterministic routing
should use `subagent_manual` (whose `model`/`thinking` are
LLM-supplied and bypass the routing config) or run without PSD.
