## Why

Pi needs a first-class, extension-driven way to create, port, improve, evaluate, and review Agent Skills without relying on Anthropic/Claude-specific workflows, browser viewers, or manual multi-step harness orchestration. Anthropic's public `skill-creator` provides a strong workflow model, but this project should turn that model into a Pi-native experience centered on the SDK, terminal/TUI review, durable run artifacts, and an extension-aware bundled skill.

## What Changes

- Add a Pi package that bundles both:
  - a primary Pi extension exposed through `/sc` and `sc_*` LLM-callable tools
  - an extension-aware `skill-creator` Agent Skill instruction layer
- Implement a hybrid conversational workflow:
  - conversation remains primary for intent capture, drafting, porting decisions, analysis, and improvement planning
  - a toggleable overlay/review panel appears when structured state, eval progress, or output review is useful
- Add durable project-local run storage under `.pi/skill-creator/runs/` by default, with a configurable path later.
- Add workflow state tracking with visible but non-imprisoning rails:
  - current goal/phase
  - inferred intent after enough evidence
  - side threads/open loops only when explicitly marked by the user or confirmed
  - smart resume of the latest active run plus ability to start/switch runs
- Add a TS SDK-based eval engine as the main implementation path:
  - JSON mode may exist only as a fallback/probe path
  - RPC is intentionally out of scope
- Support v1 workflows for:
  - creating new skills
  - improving existing skills
  - running evals/benchmarks
  - porting/adapting external skills
- Support upstream-style eval execution with Pi-native mechanics:
  - 2-3 realistic eval prompts by default
  - user approval required before running evals
  - parallel candidate/baseline runs
  - identical model/settings/tools across all eval conditions
  - project cwd with outputs isolated in the run directory
  - instructed output locations plus passive tracking, not hard sandbox enforcement by default
- Support upstream-style baselines:
  - new skill: `with_skill` vs `without_skill`
  - improve existing: `with_skill` vs `old_skill`
  - port/adapt: `with_skill` vs source/upstream `old_skill` snapshot when possible
- Preserve upstream schema and artifact names where practical while adding Pi-specific state and diagnostics only where needed.
- Replace browser/HTML review as the primary UX with a terminal/TUI review panel and markdown/JSON fallback artifacts.
- Keep automatic multi-iteration description optimization out of v1; provide one-shot/manual description improvement inside the normal improve flow.
- Require user confirmation before noisy, expensive, or destructive actions such as running eval batches or applying edits to target skill files.

## Capabilities

### New Capabilities
- `skill-creator-workflow`: Defines the `/sc` extension workflow, visible workflow state, run lifecycle, side-thread tracking, durable run storage, skill instruction activation, and safe artifact-writing boundaries.
- `skill-evaluation-engine`: Defines SDK-based skill eval execution, candidate/baseline isolation, snapshots, model/tool configuration, parallel runs, metrics, diagnostics, transcripts, grading/benchmark artifacts, and retention behavior.
- `skill-review-panel`: Defines the terminal/TUI overlay review experience for workflow status, eval progress, candidate/baseline comparison, criteria display, compact metrics, verdict/notes feedback, and review completion.
- `skill-extension-contract`: Defines the contract between the bundled skill, `/sc`, and `sc_*` tools, including tool responsibilities, structured tool results, state mutation rules, and extension-aware skill guidance.

### Modified Capabilities

- None.

## Impact

- Adds a new TypeScript Pi package/extension structure, including package metadata and Pi resource declarations.
- Adds or adapts a bundled `skills/skill-creator/` directory with upstream-derived instruction material and resources.
- Introduces SDK-based eval orchestration code using Pi `AgentSession` events, in-memory/isolated resource loading, tool-call observation, and assistant usage metrics.
- Introduces project-local artifact storage under `.pi/skill-creator/runs/`; these artifacts are not intended to be committed by default.
- Introduces a TUI overlay/review panel using Pi extension UI APIs and `@earendil-works/pi-tui` components.
- Preserves upstream Apache-2.0 license material when upstream content or scripts are adapted.
- Removes or rewrites upstream assumptions about Claude Code, Cowork, browser auto-open HTML review, `.claude/commands`, `claude -p`, and `present_files` handoff behavior.
