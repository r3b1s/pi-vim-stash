## Context

Pi subagent spawning currently exposes `model` and `thinking` parameters to the orchestrator LLM via `pi-subagents`' `subagent` tool. The LLM must either remember routing rules from the delegation skill, read `model-routing.yml` on its own, or guess — producing non-deterministic behavior. The user wants the routing table (`~/.pi/agent/model-routing.yml`) to always win, with LLM overrides available through an always-visible `subagent_manual` escape hatch.

This extension wraps `@gotgenes/pi-subagents`' `SubagentsService` with a deterministic `subagent` tool that resolves `model` and `thinking` from config before calling `svc?.spawn()`. The original pi-subagents `subagent` tool is overridden via name collision. A `subagent_manual` escape hatch is always available for LLM-directed model/thinking selection.

The existing pi-subagents infrastructure (session lifecycle, concurrency queue, widgets, notifications) continues to run unchanged. This extension owns only the LLM-facing tool contract.

`get_subagent_result` is provided by `@gotgenes/pi-subagents` and does not need to be reimplemented by this extension.

## Goals / Non-Goals

**Goals:**
- Deterministic model/thinking resolution from `model-routing.yml` — no LLM involvement in routing decisions
- Always-visible agent-selection guidance in tool description (task → agent type mapping)
- Always-visible `subagent_manual` escape hatch for LLM-directed model/thinking overrides
- Zero changes to pi-subagents source or pi-harness-cfg
- Fresh config read every tool call (no stale cache on config edits)
- Model fallback on spawn failure (iterate ordered list)
- Background-only MVP execution

**Non-Goals:**
- Replacing pi-subagents' lifecycle, concurrency, or widgets
- Foreground streaming (background-only MVP; `get_subagent_result` retrieves results)
- Toggle commands, `setActiveTools`, or tool swapping between modes
- A "soft" mode that lets the LLM override only when it explicitly provides a model (the user explicitly rejected this hybrid approach)

## Decisions

### Decision 1: Tool name `subagent` — override pi-subagents by name collision

**Chosen**: Register tool named `subagent` that replaces pi-subagents' registration via name collision. Pi's tool system supports overriding by name — when two extensions register tools with the same name, the later registration wins. Escape hatch: `subagent_manual` (has model/thinking params). Both always visible.

The name-collision override relies on this extension registering AFTER pi-subagents. This requires the extension to be listed after pi-subagents in the user's settings.json packages array, or for the extension to verify at startup that its `subagent` registration is the active one.

**Alternative considered**: Register tool with a different name (`dispatch`) and use `setActiveTools()` to hide pi-subagents' `subagent`. Rejected: `setActiveTools` is a full replacement that would accidentally disable non-subagent tools (read, bash, edit), and the name-collision approach is simpler with fewer failure modes.

### Decision 2: Both tools always visible — no toggle commands

**Chosen**: Register both `subagent` (deterministic) and `subagent_manual` (escape hatch). Both always visible to the LLM. The LLM selects based on its task: use `subagent` for normal routing, use `subagent_manual` when it explicitly needs a specific model or thinking level. No slash commands for toggling. No `setActiveTools()`.

**Rejected**: Toggle commands via `setActiveTools()` — `setActiveTools` is a full replacement that would accidentally disable non-subagent tools like read/bash/edit. Tool call hook to block — adds complexity for no gain. Single toggle command — ambiguous current state.

**Rationale**: Simple, stateless, no toggle confusion. The LLM can always reach for the escape hatch if deterministic routing is wrong for the task.

### Decision 3: `model-routing.yml` read at tool-call time (no caching)

Reads the file on every `subagent` invocation. Trade-off: tiny fs overhead vs. stale config risk. Given tool calls are gated by LLM response time (seconds), one `readFileSync` is negligible. No file watchers, no cache invalidation — simplest correct behavior.

**Alternative considered**: Watch file and cache parsed config. Rejected: complexity for negligible perf gain, and file watchers are fragile across symlinks and config dir changes.

### Decision 4: Role mapping — `subagent_type` → role key, error on unknown

The `model-routing.yml` `roles` section uses keys like `explorer`, `implementer`, `reviewer`. The agent type registry has types like `Explore`, `implementer`, `Reviewer`. A hardcoded `TYPE_TO_ROLE` map translates agent type strings (e.g., `Explore`, `Plan`) to role keys (e.g., `explorer`, `planner`).

**Unknown agent types REQUIRE explicit mapping.** If the agent type is not found in the `TYPE_TO_ROLE` map, the tool returns an error: `"No routing config found for agent type X. Add a role entry to model-routing.yml."` No silent fallback to a cheap/default role.

The mapping is defined inline as a hardcoded dictionary — no separate mapping config needed.

**Rejected alternatives**:
- Silent fallback to `cheap` role: hides misconfiguration, wastes tokens on wrong model.
- Dedicated `agent_type: Explore → role: explorer` mapping section in `model-routing.yml`: over-engineering; the hardcoded `TYPE_TO_ROLE` map is cleaner.

### Decision 5: Model fallback in execute()

When spawn fails (e.g., model unavailable, rate-limited, provider error), the tool iterates the role's ordered model list. It retries with the next model. Max retries = list length. If all models fail, it returns an error in the format: `"All models failed for role <role>: tried <model1>, <model2>, <model3>."` Per-model failure reasons are NOT included — only model names are listed.

This preserves the ordered-list fallback from the det-agents architecture: the first model is the preferred choice; subsequent models are fallbacks for resilience. The result reports which model was ultimately used.

**Rejected alternative**: Fail immediately on first error. Rejected: undermines the value of ordered model lists for availability.

### Decision 6: thinking parameter handling

The tool's parameter schema uses `thinking` (for LLM familiarity), but maps to `thinkingLevel` when calling `SubagentsService.spawn()`. The config schema (`model-routing.yml`) uses the `thinking` key consistently at both role level and per-model level.

**Resolution order**: Role-level `thinking` is the default for that role. Per-model `thinking` (when a model entry is an object with a `thinking` key) overrides the role-level default for that specific model. The tool passes the final resolved value as `thinkingLevel` to `SubagentsService`.

**Alternative considered**: Use `thinkingLevel` in the tool schema. Rejected: LLMs are more familiar with `thinking` as a parameter name from OpenAI/Anthropic conventions.

### Decision 7: Tool parameters = pi-subagents `subagent` minus `model` and `thinking`

The deterministic `subagent` exposes: `subagent_type`, `prompt`, `description`, `max_turns`, `run_in_background`, `resume`, `inherit_context`. Identical semantics to pi-subagents' `subagent` tool — we pass through to `svc?.spawn()` after injecting resolved `model` and `thinking`. The `subagent_manual` tool exposes the same parameters plus optional `model` and `thinking`.

The tool description embeds agent-selection guidance (which agent type for which task) as condensed inline text. No skill loading required — always visible.

**Alternative considered**: Expose a `role` parameter instead of `subagent_type` and map internally. Rejected: breaks compatibility with custom agents defined as `.pi/agents/*.md` that don't have role entries.

### Decision 8: Extension loads as a normal pi extension, not a hook-modifying pi-subagents

Registers via `pi.extensions` in `package.json`. Uses `SubagentsService` via dynamic import (same pattern as docs recommend for cross-extension access). Does not use `tool_call` hooks — the user explicitly rejected mutation-based approaches.

**Alternative considered**: `tool_call` hook that strips `model`/`thinking` from subagent tool calls. Rejected by user: fragile, and the hook fires for all tool calls.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| **pi-subagents loads after us** → name collision doesn't override | List this extension AFTER `@gotgenes/pi-subagents` in `settings.json` packages array to ensure load order. Extension SHOULD verify at startup that its `subagent` registration is active. Worst case: both tools briefly visible — harmless since deterministic tool is self-sufficient |
| **`model-routing.yml` missing or unparseable** | Return error message describing the failure. Tool still works in `subagent_manual` mode |
| **Unknown agent type has no role mapping** | Return explicit error: `"No routing config found for agent type X. Add a role entry to model-routing.yml."` No silent fallback |
| **All models in a role's list fail** | Return error listing all failed models so the user can debug. Manual tool remains available as escape hatch |
| **`SubagentsService` not available** (pi-subagents not installed or not loaded yet) | Log warning at extension startup; do not register `subagent` or `subagent_manual` tools. Graceful degradation — pi-subagents' own `subagent` tool remains available. |
| **Custom agents defined after session start** not recognized in role mapping | Acceptable: custom agents require explicit role mapping. Error message guides user to add the entry |
| **Token cost of tool description** (agent-selection guidance always in context) | Keep mapping compact — 3-5 word per type entry. ~200-400 tokens for all default + custom agents |
| **Background-only UX regression** — returns agent ID immediately, no streaming | Mitigation: `get_subagent_result` works for retrieval. Future: add `spawnAndWait` to SubagentsService for foreground streaming |
| **Two subagent tools visible** — LLM may confuse when to use which | Mitigation: clear tool descriptions. Deterministic tool: "Auto-resolves model from config." Manual tool: "Use only when you need a specific model or thinking level." |

## model-routing.yml Schema

The config file now uses a per-model `thinking` override format:

```yaml
roles:
  explorer:
    thinking: low
    models:
      - cheap-model
      - fallback-cheap
  implementer:
    thinking: high
    models:
      - primary-model
      - fallback-model
  reviewer:
    thinking: high
    models:
      - gpt-5.5
      - opus:
          thinking: xhigh
      - deepseek-v4-pro
```

**Rules:**
- `roles.<key>.thinking`: default thinking level for all models in that role. Optional; if omitted, no thinking level is passed (provider default).
- `roles.<key>.models`: ordered list. First entry is the preferred model; subsequent entries are fallbacks. Each entry is either a plain string (model identifier) or a mapping where the key is the model identifier and the value is an optional object with a `thinking` override.
- **Per-model `thinking`**: when a model entry is an object with a `thinking` key, that value overrides the role-level `thinking` for that specific model.
- **Resolution**: Look up `roles[roleKey]`. Use role-level `thinking` as default. For the selected model, check for per-model override. Pass final `thinking` as `thinkingLevel` to `SubagentsService.spawn()`.

## Open Questions

- **Should `subagent_manual` support the same model fallback iteration?** Could be useful for one-shot overrides without toggling. Defer to post-MVP polish.
- **Should the deterministic `subagent` support a `model` param that overrides the routing table?** User explicitly wanted opt-in-only via the separate manual tool, not soft override. Defer.
