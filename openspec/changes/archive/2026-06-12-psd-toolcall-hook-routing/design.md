## Context

`@r3b1s/pi-subagents-deterministic` (PSD) wraps
`@gotgenes/pi-subagents` with a deterministic `subagent` tool that
resolves model and thinking level from
`agent/model-routing.yml`. The original design relied on
name-collision in Pi's tool registry: PSD registered a tool named
`subagent` that would replace pi-subagents' same-named tool at the
LLM interface. In Pi v0.79.1 the tool registry uses first-writer-wins,
so pi-subagents' tool always wins and PSD's deterministic routing is
silently dropped. Pi also emits scary-looking (but non-fatal)
conflict diagnostics on every session start, which is a poor user
experience.

Two issues compound the problem:

1. The `subagent` registration is silently ignored, so the entire
   deterministic-routing story does not work in practice.
2. The same conflict exists for `get_subagent_result`, so PSD's
   non-blocking result formatting is also silently ignored.

The fix moves PSD from "register a competing tool" to "hook the
tool-call lifecycle and inject the routing values into the input
before the existing tool runs". This eliminates the registration
conflict, restores deterministic routing, and keeps PSD's public
`Spawner` / `setSpawner` / `setResultProvider` exports stable for
downstream consumers (notably pi-tmux-sessionizer).

`pi-subagents`' `subagent` tool already accepts optional `model` and
`thinking` parameters — its schema permits them — so the hook can
inject them into `event.input` without re-validation. The pi-subagents
tool then forwards those values to `SubagentsService.spawn()` and the
downstream call path is unchanged.

## Goals / Non-Goals

**Goals:**

- Eliminate the first-writer-wins tool-registration conflict between
  PSD and pi-subagents for both `subagent` and `get_subagent_result`
- Restore deterministic routing: every call to `subagent` is
  intercepted and `event.input.model` / `event.input.thinking` are
  set from `model-routing.yml` before the tool runs
- Keep `subagent_manual` registered (no conflict exists — pi-subagents
  does not define that name)
- Preserve the public `Spawner` interface, `setSpawner()` function,
  and `setResultProvider()` function exports for API stability
- Block the call on config errors (missing YAML, invalid YAML, unknown
  role, empty models list) with a clear `reason` string
- Always overwrite any `model` / `thinking` the LLM may have set on
  the call — the routing config is authoritative
- Fresh config read on every hook invocation (no caching)
- Update tests and READMEs to reflect the new architecture

**Non-Goals:**

- Re-introducing the name-collision registration approach
- Modifying pi-subagents source or its tool definition
- Restoring the always-non-blocking `get_subagent_result` semantics
  (PSD no longer registers that tool — pi-subagents' native tool
  honors `wait: true` and the default non-blocking behavior is
  preserved)
- Routing `subagent` calls through a custom spawner (the hook only
  mutates `event.input`; the actual spawn is performed by
  pi-subagents' tool via `SubagentsService.spawn()`)
- A `before_agent_start` injection to replicate the previous
  agent-selection guidance in the system prompt (out of scope;
  pi-subagents' native tool description already provides selection
  guidance)
- A "soft" mode where the LLM-provided `model` / `thinking` win over
  the routing config (the user explicitly wants deterministic
  routing — overwrite is the chosen semantics)

## Decisions

### Decision 1: Hook-based injection rather than a new tool registration

**Chosen**: Register a `pi.on("tool_call", ...)` handler that
intercepts calls for `toolName === "subagent"`. The handler reads
`agent/model-routing.yml`, resolves the model and thinking, and
mutates `event.input.model` and `event.input.thinking` in place.
The call then proceeds to pi-subagents' `subagent` tool, which
accepts those values as optional parameters.

**Why**: Pi's tool registry uses first-writer-wins. Any
registration by PSD of a tool named `subagent` will be silently
overwritten by pi-subagents (which loads first). The `tool_call`
event is the only place where an extension can patch the input
before the registered tool runs, so it is the correct
interception point.

**Type basis**: `CustomToolCallEvent` is the relevant event type
(pi-subagents' `subagent` is a custom tool). The event's `input`
is `Record<string, unknown>` and is mutable. The hook handler
receives the event and may either return `void` (allowing
execution with the mutated input) or return a
`ToolCallEventResult` with `block: true` and a `reason` string
(halting execution with the reason surfaced to the LLM).

**Alternatives considered**:

- Re-registration with a different tool name (e.g., `subagent_v2`)
  and `setActiveTools` to hide pi-subagents' tool. Rejected: the
  name mismatch is fragile, and `setActiveTools` is a
  full-replacement that would accidentally hide unrelated tools
  (`read`, `bash`, `edit`).
- `pi.on("tool_call", ...)` with a `result` field that fully
  replaces the tool's output. Rejected: we do not want to
  bypass pi-subagents' tool — we want to inject into its
  input and let it run normally.
- Modifying pi-subagents' `subagent` tool description via
  reflection or monkey-patching. Rejected: brittle, fragile
  across versions, and not a supported Pi extension pattern.

### Decision 2: Always overwrite LLM-provided model and thinking

**Chosen**: When `event.input.model` or `event.input.thinking` are
already set on the call, the hook overwrites them with the values
resolved from `model-routing.yml`. The routing config is
authoritative.

**Why**: The original PSD design had `model` and `thinking`
absent from the tool schema, so the LLM could not set them. Under
the new architecture, the LLM sees pi-subagents' tool schema,
which exposes them as optional. To preserve the deterministic
philosophy (the LLM cannot escape the routing table via the
`subagent` tool), the hook must overwrite. The `subagent_manual`
escape hatch is the LLM's legitimate way to override.

**Alternatives considered**:

- Respect LLM-provided values if present ("soft mode").
  Rejected: the original design philosophy was strict
  determinism; the user explicitly wants config-wins behavior.
- Block the call if the LLM provided `model` or `thinking` on
  `subagent` (force the LLM to use `subagent_manual` for
  overrides). Rejected: too aggressive — the LLM may have set
  them by default in some sessions, and a blocking error is
  worse than a silent overwrite that respects the config.

### Decision 3: Block on config errors with a clear reason

**Chosen**: When the YAML is missing, invalid, or the role key
is unknown, the hook returns
`{ block: true, reason: "..." }`. The call does not proceed to
pi-subagents' tool.

**Why**: The previous tool's `execute` method returned a
`textResult` with the error. Under the new architecture, the
hook must surface the error to the LLM in a way that prevents
the tool from running with silently-degraded routing. The
`block` + `reason` mechanism is the correct tool-call
interception point for "stop and tell the LLM why".

**Error message format preserved from the previous spec**:
- Missing file: `"Model routing config not found at <path>"`
- Invalid YAML: `"Failed to parse model-routing.yml: <error>"`
- Unknown role: `"No routing config found for agent type <type>. Add a role entry to model-routing.yml."`
- Empty models list: `"No models configured for role: <role>."`

### Decision 4: Keep `setSpawner` and `setResultProvider` as no-op-stable exports

**Chosen**: The `Spawner` interface, the `setSpawner()` function,
and the `setResultProvider()` function remain exported from
PSD's public entry point. The `setSpawner` call continues to
store the latest spawner for use by `subagent_manual`. The
`setResultProvider` call continues to store the latest provider
but has no consumer inside PSD (PSD no longer registers
`get_subagent_result`).

**Why**: PTS and any other consumer that imports these functions
will keep type-checking and runtime-linking. The
`setResultProvider` is vestigial (no internal consumer) but
removing the export would be a breaking change to the public
API surface and would require coordinated updates in PTS.

**Behavioral contract**:
- `setSpawner(spawner)` — stores the spawner; subsequent
  `subagent_manual` calls use it. Always succeeds.
- `setResultProvider(provider)` — stores the provider; has no
  effect on PSD's own behavior. Always succeeds.
- `getSpawner()` / `hasCustomSpawner()` — internal helpers;
  behavior preserved.
- `getResultProvider()` / `resetResultProvider()` — internal
  helpers; behavior preserved for tests.

### Decision 5: Drop model-fallback iteration in the hook

**Chosen**: The new hook resolves the FIRST model in the role's
ordered list and injects it. The hook does not iterate on
spawn failure. Spawn failure handling now belongs to
pi-subagents' own retry semantics.

**Why**: The previous PSD tool's `execute` method could iterate
internally because it owned the call. Under the new
architecture, the hook fires once, mutates the input, and
hands control to pi-subagents' tool. Iterating inside the hook
would require either blocking the call (waiting on retries) or
calling `SubagentsService.spawn()` directly from the hook (which
the user explicitly does not want — the hook should not call
spawners).

**Migration**: Users who want ordered-list model fallback
configure multiple models in `model-routing.yml`'s ordered
`models` list and rely on pi-subagents' own retry semantics to
fall through. If PSD-level fallback is critical, list multiple
model entries under one role and document the desired behavior
in the README.

### Decision 6: Load order is no longer relevant

**Chosen**: PSD's extension can be loaded before or after
pi-subagents. The hook fires whenever a `subagent` tool call is
made, regardless of which extension registered the tool. The
first-writer-wins conflict for `subagent` and
`get_subagent_result` is gone because PSD does not register
those tools.

**Why**: This is a direct consequence of Decision 1. Removing
the tool registrations eliminates the conflict, so the previous
"load PSD after pi-subagents" warning in the README can be
removed.

### Decision 7: Fresh config read on every hook call

**Chosen**: The hook re-reads `agent/model-routing.yml` on
every invocation. No in-process cache.

**Why**: This matches the previous tool's behavior. Tool calls
are gated by LLM response time (seconds), so one `readFileSync`
per call is negligible. No file watchers, no cache invalidation
— simplest correct behavior. Edits to the YAML are picked up
without a session restart.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **pi-subagents' tool schema changes** — a future version may rename `model` to `model_id` or remove `thinking` | The hook's mutate would silently fail to inject. Mitigation: add a regression test that verifies the hook sets the keys pi-subagents currently accepts (`model`, `thinking`). Document the coupling in the README. |
| **Hook fires before another extension's hook** that may also mutate `event.input` | Per Pi's `tool_call` docs, "Later `tool_call` handlers see earlier mutations. No re-validation is performed after mutation." So if another extension mutates `event.input.model` to a different value, our overwrite still wins — we are last. Risk: if the other extension is registered after us, their value wins. Mitigation: document the assumption that PSD's hook is registered last; the deterministic-routing philosophy implies it should win. |
| **`model-routing.yml` malformed at runtime** blocks every subagent call | The user is forced to fix the config or remove PSD. This is intentional — the alternative is silently-degraded routing. The error message includes the path and a clear hint. |
| **PTS composition loss for deterministic path** — when both PSD and PTS are installed, `setSpawner` is a no-op for the deterministic `subagent` calls (which now go through pi-subagents, not PTS) | Documented user-facing trade-off. Users who need PTS-style tmux observability for deterministic routing should either: (a) use `subagent_manual` (which still routes through PTS's spawner), or (b) run without PSD. |
| **Loss of always-non-blocking `get_subagent_result`** — the LLM can now opt-in to blocking via `wait: true` | Documented user-facing trade-off. The default behavior (omit `wait` or pass `false`) is still non-blocking, which covers the common case. Users who want strictly-non-blocking can add a note in their system prompt: "always pass `wait: false` to `get_subagent_result`". |
| **Regression on aggressive test of unknown agent types** — pi-subagents' tool may reject an unknown `subagent_type` at execution time, after the hook has already approved it | The hook blocks on unknown agent type with a clear reason. The pi-subagents tool never runs in that case. No regression. |
| **Hook throws an unhandled exception** | The handler wraps the YAML read and the role resolution in try/catch. On any uncaught error it returns `{ block: true, reason: "Internal routing error: <message>" }` to avoid crashing the session. |
| **PSD is loaded but pi-subagents is not** — there is no `subagent` tool to intercept, so the hook never fires | This is a degraded state: the LLM has no `subagent` tool at all. Document pi-subagents as a hard runtime requirement (the existing `peerDependency` in `package.json` is sufficient at install time; at runtime, log a warning at extension load if the dynamic import fails). |

## Migration Plan

**For users currently running PSD + pi-subagents** (with the
broken first-writer-wins behavior):

1. Update PSD to the new version.
2. No config change required — `model-routing.yml` schema is
   unchanged.
3. No load-order change required — PSD can be loaded before or
   after pi-subagents.
4. The deterministic routing will now actually work.
5. (Optional) If the user relied on the always-non-blocking
   `get_subagent_result` behavior, they can either accept
   pi-subagents' default non-blocking behavior (omit `wait`) or
   add a project-level note in their system prompt.

**For users currently running PSD + pi-subagents + PTS**:

1. Update PSD to the new version.
2. PTS's `setSpawner` and `setResultProvider` calls become
   no-ops for the deterministic `subagent` path (the hook
   injects model/thinking but does not route through PTS).
3. PTS's own `get_subagent_result` tool continues to handle
   result retrieval for both `subagent` and `subagent_manual`
   calls (whichever spawned the agent).
4. Users who want PTS-style tmux observability for deterministic
   routing should call `subagent_manual` instead of `subagent`.

**Rollback**:

- The change is isolated to PSD. Reverting PSD to the previous
  version restores the old name-collision behavior. No changes
  to pi-subagents or PTS.
- If the new hook is found to have a bug that silently drops
  routing values, the `block: true` + `reason` mechanism
  surfaces the failure to the LLM as a clear error rather than
  silently routing to the wrong model.

## Open Questions

- **Should PSD log a startup warning when pi-subagents is not
  detected?** The dynamic import in the entry point already
  attempts to load `@gotgenes/pi-subagents` to wire
  `getResultTool` and `subagent_manual`'s spawner. If it fails,
  `subagent_manual` falls back to a no-spawner error. The
  current proposal keeps this behavior; a startup warning is
  nice-to-have but not required. Defer to implementation.
- **Should the hook support a "manual override" escape hatch via
  a magic input key (e.g., `_psd_skip_routing: true`)?** This
  would let the LLM bypass the hook for a single call without
  going through `subagent_manual`. Out of scope for this change
  — the user explicitly identified `subagent_manual` as the
  escape hatch.
- **How should the README document the loss of PTS observability
  for deterministic routing?** Plan: add a "Composition with
  pi-tmux-sessionizer" section that explains the new behavior
  and recommends `subagent_manual` for tmux-observable
  deterministic-style calls.
