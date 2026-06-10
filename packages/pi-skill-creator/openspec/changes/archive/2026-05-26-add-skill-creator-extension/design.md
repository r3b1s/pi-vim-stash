## Context

This repository is intended to become the Pi-native home for adapting Anthropic's public `skill-creator` workflow. The upstream skill has useful ideas: intent capture, interview/research, skill drafting, realistic eval prompts, baseline comparison, grading, benchmark aggregation, human feedback, and iterative improvement. However, upstream implementation details assume Claude Code/Cowork concepts such as `.claude/commands`, `claude -p`, browser/HTML review, task-notification token capture, and `present_files` handoff. Those assumptions do not fit the desired Pi workflow.

Pi offers better native primitives for this project:

- packages can bundle extensions and skills together
- extensions can register slash commands and LLM-callable tools
- the TypeScript SDK can create sessions, inject resource loaders, subscribe to events, and capture usage/tool events
- interactive Pi sessions can render TUI components and overlays
- JSON event stream mode can exist as a secondary compatibility/probe path

The product direction is extension-first. The bundled skill is not a lowest-common-denominator portable artifact; it is an extension-aware instruction layer that teaches the agent when and why to use the extension's machinery. Portability remains useful as fallback behavior, but should not constrain the quality of the Pi extension.

## Goals / Non-Goals

**Goals:**

- Provide `/sc` as the primary user entry point for creating, porting, improving, evaluating, and reviewing skills.
- Activate the skill-creator instruction layer automatically when `/sc` is invoked.
- Keep conversation as the primary interface for reasoning, drafting, analysis, and decisions.
- Provide a visible, toggleable workflow state panel and a structured review panel when state, eval progress, or eval review benefits from UI.
- Persist durable run artifacts under `.pi/skill-creator/runs/` by default so work can be resumed and audited across sessions.
- Implement the eval engine in TypeScript using the Pi SDK as the mainline approach.
- Preserve upstream artifact names and schema shapes where practical: `evals.json`, `eval_metadata.json`, `grading.json`, `metrics.json`, `timing.json`, `benchmark.json`, `benchmark.md`, `feedback.json`, and `history.json`.
- Add Pi-specific artifacts only where needed: `state.json`, `diagnostics.json`, `summary.md`, `transcript.md`, and active/debug raw event logs.
- Run evals using fair candidate/baseline conditions: same prompt, model, thinking level, tool profile, cwd, and environment; only the skill condition changes.
- Require human confirmation before noisy, expensive, or destructive actions.
- Replace browser-first HTML review with a terminal/TUI review panel plus markdown/JSON fallback files.

**Non-Goals:**

- Do not build an RPC client or RPC-based workflow. RPC is intentionally removed from consideration.
- Do not make the portable skill the primary product surface.
- Do not implement a rigid wizard/state machine that forces users through gates.
- Do not implement automatic multi-iteration skill improvement loops in v1.
- Do not implement Anthropic-style train/test automatic trigger-description optimization in v1.
- Do not hard sandbox eval output directories by default; use instructed output locations and passive tracking first.
- Do not auto-open browsers or create HTML review folders as the primary review workflow.
- Do not require users to invoke separate manual commands for every phase of the workflow.

## Decisions

### Decision: Package both extension and skill, but make the extension primary

The package will expose a Pi extension and a bundled `skill-creator` skill. The extension is the primary product surface, while the skill is an extension-aware instruction layer.

Alternatives considered:

- **Portable skill first**: rejected because it would constrain the extension to lowest-common-denominator behavior.
- **Extension only**: rejected because skill instructions remain valuable for agent reasoning and for fallback/manual use.
- **Equal skill and extension products**: rejected because the extension needs to own durable state, eval execution, and TUI review mechanics.

Rationale: the skill is best at reasoning guidance; the extension is best at state, orchestration primitives, eval execution, persistence, and UI.

### Decision: `/sc` is the main entry point and activates guidance automatically

The slash command will be `/sc`, not `/skill-creator`. LLM-callable tools will use the `sc_` prefix. Invoking `/sc` should create or resume a run, show/toggle relevant state UI, and ensure the skill-creator guidance is active without requiring the user to manually invoke `/skill:skill-creator`.

Alternatives considered:

- **Long names such as `/skill-creator` and `skill_creator_*`**: clear but verbose.
- **Manual skill invocation**: rejected because extension-first workflows should not rely on the model maybe loading the skill.

Rationale: short names reduce friction while automatic guidance activation keeps the extension and instruction layer aligned.

### Decision: Use quiet strong workflow state with rails, not gates

The extension will track workflow state such as current goal, inferred intent, phase/rail position, active iteration, side threads, pending confirmations, and artifact paths. This state is visible and toggleable, but it does not hard-block natural conversation.

Side threads are lightweight open loops. They are created when the user uses explicit markers such as "remember", "park this", "for later", "lock this in", "ensure this", "track this", or when the agent proposes tracking and the user confirms. They are not silently auto-created for every detour.

Alternatives considered:

- **Hidden state only**: rejected because the user wants visible orientation.
- **Rigid phase gates**: rejected because skill creation and porting require flexibility.
- **Fully automatic side-thread creation**: rejected because it risks noisy state accumulation.

Rationale: visible state helps prevent drift, while rails-not-gates keeps the workflow adaptive.

### Decision: Store durable run data in `.pi/skill-creator/runs/`

The default project-local storage root will be `.pi/skill-creator/runs/`, with configurability later. Each run is a reproducible-enough capsule containing state, evals, snapshots, transcripts, metrics, diagnostics, feedback, and reports. These artifacts are not intended to be committed by default.

Alternatives considered:

- **Session-only state**: rejected as too lossy.
- **Root `.skill-creator/` directory**: less aligned with Pi-local project state.
- **Visible root `skill-creator-runs/`**: too noisy.

Rationale: `.pi/skill-creator/runs/` is project-scoped, Pi-associated, resumable, and easy to ignore.

### Decision: Use TS SDK as the primary eval engine

The eval engine will use Pi's TypeScript SDK to create isolated sessions, inject candidate/baseline skills, subscribe to events, capture assistant usage, observe tool execution, and write run artifacts. JSON mode can exist as a secondary fallback/probe path. RPC is out of scope.

Alternatives considered:

- **CLI JSON mode primary**: simpler but less integrated, process-heavy, and less ergonomic in TypeScript.
- **RPC mode**: rejected entirely for this project to avoid protocol/client complexity.

Rationale: SDK is the most direct fit for a TypeScript Pi extension and gives access to the same event information as JSON without line-oriented subprocess parsing.

### Decision: Evaluate output quality, not trigger status as a first-class eval criterion

The engine may record whether the candidate skill's `SKILL.md` was loaded as diagnostic metadata, but v1 evals are not primarily trigger-only evals and do not require special trigger criteria fields.

Alternatives considered:

- **Dedicated trigger evals and trigger fields**: rejected for v1 because the product should focus on whether the skill improves task outcomes.

Rationale: trigger diagnostics are useful for debugging descriptions, but pass/fail should come from task results, expectations, grading, and human review.

### Decision: Preserve upstream-style eval lifecycle

The workflow will collect examples and success criteria early, draft or snapshot the skill, propose 2-3 realistic eval prompts, require user approval, then run candidate and baseline in parallel. While or after runs complete, assertions/expectations can be drafted and grading/benchmarking performed. The user reviews results before deciding whether to improve, rerun, or finish.

Alternatives considered:

- **Formal evals before drafting**: may over-constrain early creativity.
- **Eval only on request**: too weak for a skill-creator product.
- **Automatic improvement loops**: too autonomous for v1.

Rationale: this closely follows upstream while respecting user control.

### Decision: Candidate/baseline fairness and isolation

Before each eval iteration, the engine snapshots the candidate skill and any baseline/source skill into the iteration directory. Eval sessions load only the relevant snapshot or no skill:

- new skill: `with_skill` uses candidate snapshot; `without_skill` uses no skill
- improve existing: `with_skill` uses candidate snapshot; `old_skill` uses old snapshot
- port/adapt: `with_skill` uses adapted candidate; `old_skill` uses source/upstream snapshot when possible

All parallel runs in the batch use the same model, thinking level, tool profile, prompt, cwd, and environment. The model defaults to a cost-first capable model, but the user is asked on first eval run and the preference is remembered.

Alternatives considered:

- **Ambient skill discovery**: rejected because global/project skills would confound results.
- **Different models for candidate and baseline**: rejected because it breaks benchmark fairness.
- **Live skill paths during eval**: rejected because later edits would make results less reproducible.

Rationale: fair comparisons require changing only the skill condition.

### Decision: Instruct output directories and passively track writes

Eval agents will run from the project cwd and receive explicit instructions to save outputs under their assigned run output directory. The engine will passively track tool calls, file writes/edits when observable, output directory contents, and diagnostics. It will not hard sandbox or enforce output paths by default.

Alternatives considered:

- **Hard sandbox/output enforcement**: stronger reproducibility but risks changing output quality by constraining behavior.
- **No tracking**: too weak for metrics and review.

Rationale: instructed output locations match upstream behavior and minimize harness interference.

### Decision: Review through a Pi TUI panel, not a browser viewer

The review panel is context/phase dependent:

- during eval execution: progress/status
- during review: one eval at a time, baseline left and candidate right, criteria centered underneath, compact metrics under each run, verdict and notes feedback
- anytime: workflow dashboard/status where useful

The panel is a review panel, not a full modal app. Chat remains important. It should support compact side-panel behavior and expansion to a larger panel. Keyboard interaction is primary, with left/right navigation and a header such as `Eval N/M: name`.

Alternatives considered:

- **Browser HTML review**: rejected as primary UX.
- **Full modal workbench only**: too heavy and risks displacing conversation.
- **Chat-only review**: too unstructured for candidate/baseline comparisons.

Rationale: TUI review preserves terminal-first SSH-compatible UX while making comparisons and feedback efficient.

### Decision: Keep state mutation controlled by extension tools

`state.json` is machine workflow state and should be mutated only by extension tools. The agent may edit human-facing artifacts such as `evals.json`, `feedback.md`, `summary.md`, and target skill files, but target skill writes require user confirmation. Extension tools write run-dir drafts, snapshots, eval artifacts, state, and reports.

Alternatives considered:

- **Agent edits state directly**: rejected because malformed state could break resume/UI behavior.
- **Extension writes target skill files**: rejected because visible normal `write`/`edit` operations are preferable for actual skill content changes.

Rationale: separate controlled machine state from human/agent-editable artifacts.

### Decision: Use a small phase-oriented tool surface

The v1 tool surface should remain small:

- `sc_run`: create/resume/read/update run state and workflow metadata
- `sc_eval`: snapshot skills, execute candidate/baseline eval batches, collect metrics/diagnostics, and aggregate results
- `sc_review`: open review UI, save feedback, mark review complete, and summarize review state

Tool results return concise human-readable content plus structured details containing paths, ids, metrics, and status. Raw data stays on disk.

Alternatives considered:

- **One broad tool**: too opaque and hard for the model to use reliably.
- **Many narrow tools**: too much choreography and context overhead.

Rationale: few phase tools balance reliability with agent flexibility.

### Decision: Description optimization is one-shot/manual in v1

The agent may propose description improvements based on user feedback, eval/benchmark findings, diagnostics, near misses, and context. Improved candidates may be updated in the run directory, but target skill edits require confirmation. Full train/test multi-iteration description optimization is reserved for later.

Alternatives considered:

- **Full upstream description optimizer in v1**: rejected because trigger evals are not first-class v1 criteria and automatic loops were rejected.
- **No description improvement support**: too weak, because descriptions are central to skills.

Rationale: one-shot description improvement preserves value without introducing a complex autonomous optimizer.

## Risks / Trade-offs

- **Risk: extension-first design reduces portability** → Mitigation: keep the bundled skill useful as an instruction layer and include fallback/manual guidance, but do not let portability constrain the extension.
- **Risk: visible state becomes too rigid** → Mitigation: design phases as rails, not gates; allow hiding/toggling the panel; keep side-thread tracking explicit-marker based.
- **Risk: evals are expensive or noisy** → Mitigation: default to 2-3 eval prompts, require approval before running, use a cost-first capable model, and apply identical settings across conditions.
- **Risk: passive output tracking misses artifacts saved outside the requested directory** → Mitigation: record diagnostics and tool observations; surface missing/extra output warnings in review; consider opt-in soft guards later.
- **Risk: SDK APIs change or expose less than expected** → Mitigation: isolate SDK eval orchestration behind internal interfaces and keep JSON mode as a fallback/probe path.
- **Risk: raw event logs grow too large** → Mitigation: keep raw JSONL primarily while active/debugging; offer pruning at completion; preserve readable transcripts, metrics, diagnostics, outputs, feedback, benchmark, and summary.
- **Risk: TUI complexity delays core workflow** → Mitigation: build terminal/markdown fallback artifacts and implement the review panel incrementally with basic keyboard navigation first.
- **Risk: grading subjective outputs is unreliable** → Mitigation: use objective/verifiable expectations where possible and leave subjective quality to human verdict/notes.
- **Risk: target skill edits happen unexpectedly** → Mitigation: extension writes run-dir artifacts only; target skill path edits require explicit user confirmation and normal edit/write visibility.

## Migration Plan

1. Establish package skeleton and resource layout for extension plus bundled skill.
2. Port/adapt upstream license and core instruction resources into the repository without adding attribution noise inside active prompts.
3. Implement run directory and state foundations before eval execution.
4. Implement SDK eval execution and artifact writing with terminal/report fallback before full TUI polish.
5. Implement review panel after artifact shapes are stable.
6. Add JSON mode fallback/probe only after SDK semantics are understood.
7. Keep implementation modular so `/sc`, tools, eval engine, artifacts, and review UI can be iterated independently.

Rollback strategy is simple during development: the package is additive and project-local. Removing the extension/package and deleting `.pi/skill-creator/runs/` state should return the project to its previous behavior.

## Open Questions

- Exact TypeScript package layout and build/test tooling still need to be chosen during implementation.
- Exact Pi SDK resource-loader strategy for activating the bundled skill guidance from `/sc` needs validation.
- The first-pass TUI component structure should be refined against Pi's overlay APIs during implementation.
- The cost-first model selection heuristic needs implementation-time discovery of available models and pricing metadata.
- The JSON mode fallback/probe scope should be confirmed after the SDK eval path works.
