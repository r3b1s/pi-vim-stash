## 1. Package and Repository Foundation

- [x] 1.1 Create TypeScript package scaffold with `package.json`, Pi package metadata, source directories, and build/test scripts.
- [x] 1.2 Declare Pi resources so the package loads the extension and bundled skill together.
- [x] 1.3 Add project-local ignore rules or documentation for `.pi/skill-creator/runs/` artifacts.
- [x] 1.4 Add upstream Apache-2.0 license material and repository-level attribution documentation for adapted Anthropic content.
- [x] 1.5 Define shared TypeScript types for run ids, workflow intents, phases, side threads, iterations, eval cases, conditions, metrics, diagnostics, and tool result details.
- [x] 1.6 Add a configuration module for default run root `.pi/skill-creator/runs/` with a path override hook for future configurability.

## 2. Bundled Skill and Instruction Layer

- [x] 2.1 Create `skills/skill-creator/` with directory name and frontmatter name aligned as `skill-creator`.
- [x] 2.2 Adapt upstream `SKILL.md` into an extension-aware Pi instruction layer that references `/sc`, `sc_run`, `sc_eval`, and `sc_review`.
- [x] 2.3 Remove or rewrite active-instruction references to Claude Code, Cowork, browser auto-open review, `.claude/commands`, `claude -p`, `present_files`, and `/skill-test` warnings.
- [x] 2.4 Add fallback/manual guidance for using the skill when extension tools are unavailable without making fallback behavior the mainline path.
- [x] 2.5 Copy/adapt bundled reference resources such as schemas and grader/analyzer/comparator prompts into the skill resources.
- [x] 2.6 Ensure the skill describes high-level workflow guidance and canonical tool patterns without brittle step-by-step choreography.
- [x] 2.7 Validate skill frontmatter and resource layout against Pi skill loading rules.

## 3. `/sc` Command and Workflow Activation

- [x] 3.1 Register `/sc` as the primary extension command.
- [x] 3.2 Implement `/sc` behavior for creating a new run when no active run exists.
- [x] 3.3 Implement `/sc` behavior for resuming the latest active run by default when one exists.
- [x] 3.4 Implement `/sc` choices for continuing, starting a new run, or switching to another run.
- [x] 3.5 Ensure `/sc` activates or injects the bundled skill-creator instruction layer automatically.
- [x] 3.6 Implement `/sc` behavior for showing, hiding, or focusing the workflow state panel without accidentally creating unrelated runs.
- [x] 3.7 Add command argument parsing only where necessary while keeping `/sc` usable as the default guided entry point.

## 4. Run Directory and State Management

- [x] 4.1 Implement run directory creation under `.pi/skill-creator/runs/<run-id>/`.
- [x] 4.2 Implement `state.json` read/write with extension-only mutation APIs.
- [x] 4.3 Implement upstream-style `history.json` creation and update support separate from `state.json`.
- [x] 4.4 Implement `summary.md` creation and update support for human-readable run findings and decisions.
- [x] 4.5 Implement smart discovery of latest active run and prior run listing.
- [x] 4.6 Implement workflow intent labeling after sufficient evidence, including ambiguous-intent confirmation support.
- [x] 4.7 Implement visible workflow rails data: current goal, phase/rail position, next suggested actions, active iteration, and artifact paths.
- [x] 4.8 Implement side-thread state with explicit-marker creation and user-confirmed creation for ambiguous detours.
- [x] 4.9 Implement state transitions for active, reviewing, completed, parked, or errored run states.
- [x] 4.10 Add schema validation or defensive parsing for `state.json` and `history.json`.

## 5. `sc_*` Tool Surface

- [x] 5.1 Register LLM-callable tools with the `sc_` prefix.
- [x] 5.2 Implement `sc_run` for creating, resuming, reading, and updating workflow run state.
- [x] 5.3 Implement `sc_eval` as the eval orchestration entry point for snapshots, batch execution, metrics, diagnostics, grading hooks, and aggregation.
- [x] 5.4 Implement `sc_review` for opening review UI, saving feedback, marking review complete, and reporting review status.
- [x] 5.5 Ensure all `sc_*` tools return concise text summaries plus structured details with ids, paths, status, and metrics.
- [x] 5.6 Ensure `sc_*` tools return paths/summaries for large artifacts instead of dumping raw transcripts or outputs into conversation context.
- [x] 5.7 Enforce the contract that `state.json` is mutated only by extension tools.
- [x] 5.8 Add tests or fixtures for tool parameter validation and result detail shapes.

## 6. Eval Set and Artifact Schemas

- [x] 6.1 Implement upstream-compatible `evals.json` read/write support with Pi-safe extensions where needed.
- [x] 6.2 Implement run-root working eval set storage at `<run>/evals.json`.
- [x] 6.3 Implement per-iteration frozen eval set snapshots at `<run>/iteration-N/evals.json`.
- [x] 6.4 Implement optional export support for reusable `evals/evals.json` under the target skill directory after confirmation.
- [x] 6.5 Implement per-eval `eval_metadata.json` generation with descriptive eval names and assertions/expectations.
- [x] 6.6 Implement `feedback.md` and `feedback.json` read/write support for each iteration.
- [x] 6.7 Implement `benchmark.json` and `benchmark.md` write support using upstream-compatible names and fields where practical.
- [x] 6.8 Implement `metrics.json`, `diagnostics.json`, `timing.json`, `transcript.md`, and active/debug `transcript.jsonl` artifact writers for each condition run.

## 7. Skill Snapshot and Baseline Handling

- [x] 7.1 Implement candidate skill snapshotting into `iteration-N/skill-snapshots/with_skill/` before eval execution.
- [x] 7.2 Implement old/source skill snapshotting into `iteration-N/skill-snapshots/old_skill/` for improve and port/adapt workflows.
- [x] 7.3 Implement metadata handling for `without_skill` baselines where no baseline skill snapshot exists.
- [x] 7.4 Implement upstream-style condition directory naming: `with_skill`, `without_skill`, and `old_skill`.
- [x] 7.5 Implement create-new baseline behavior as candidate snapshot versus no skill.
- [x] 7.6 Implement improve-existing baseline behavior as candidate snapshot versus old skill snapshot.
- [x] 7.7 Implement port/adapt baseline behavior as candidate snapshot versus source/upstream old skill snapshot when possible.
- [x] 7.8 Implement diagnostics for degraded port/adapt baseline cases where the source skill cannot run cleanly in Pi.

## 8. SDK Eval Engine

- [x] 8.1 Build an SDK eval runner that creates isolated sessions for each eval condition.
- [x] 8.2 Configure candidate sessions to load only the candidate skill snapshot unless explicitly configured otherwise.
- [x] 8.3 Configure new-skill baseline sessions to run with no candidate or baseline skill loaded.
- [x] 8.4 Configure old-skill baseline sessions to load only the old/source skill snapshot unless explicitly configured otherwise.
- [x] 8.5 Disable or filter ambient global/project skill discovery during eval sessions to avoid confounds.
- [x] 8.6 Run eval sessions from the project cwd while instructing agents to save outputs to their assigned output directories.
- [x] 8.7 Capture SDK message, turn, assistant usage, and tool execution events needed for transcripts, metrics, diagnostics, and timing.
- [x] 8.8 Record skill-load diagnostics when a run reads a candidate or baseline `SKILL.md`.
- [x] 8.9 Implement output directory checks and diagnostics after each eval run stops.
- [x] 8.10 Treat run execution as complete after agent stop, output check, metrics write, diagnostics write, transcript write, and timing write.
- [x] 8.11 Keep grading separate from individual run execution completion.
- [x] 8.12 Implement raw event retention while active/debugging and pruning support after completion.

## 9. Eval Batch Configuration and Execution

- [x] 9.1 Implement proposed eval prompt generation support for 2-3 realistic prompts by default.
- [x] 9.2 Require user approval or edits before starting an eval batch.
- [x] 9.3 Implement first-run model selection prompt with a cost-first capable recommendation.
- [x] 9.4 Persist the selected eval model preference for future eval batches.
- [x] 9.5 Implement thinking/reasoning level selection alongside model selection and apply it uniformly to all runs.
- [x] 9.6 Implement tool profile selection with normal Pi coding tools as default.
- [x] 9.7 Infer when broader custom or MCP tools may be needed and propose adding them before the batch starts.
- [x] 9.8 Apply identical model, thinking level, tool profile, cwd, and environment to all candidate and baseline runs in a batch.
- [x] 9.9 Launch all candidate and baseline condition runs concurrently by default after approval.
- [x] 9.10 Add configurable concurrency controls only after the default parallel behavior works.

## 10. Grading and Benchmark Aggregation

- [x] 10.1 Implement assertion/expectation grading that writes `grading.json` with `text`, `passed`, and `evidence` fields.
- [x] 10.2 Support qualitative-only evals without forcing artificial assertions.
- [x] 10.3 Integrate or adapt the bundled grader reference prompt for subjective or non-programmatic grading cases.
- [x] 10.4 Prefer programmatic checks where expectations can be objectively verified.
- [x] 10.5 Aggregate per-condition grading, timing, usage, tool metrics, and diagnostics into `benchmark.json`.
- [x] 10.6 Generate human-readable `benchmark.md` for terminal/headless review.
- [x] 10.7 Update `history.json` with iteration/version progression and benchmark outcome metadata where applicable.
- [x] 10.8 Add analyzer-pass support or placeholder integration for surfacing flaky evals, non-discriminating assertions, and time/token tradeoffs.

## 11. TUI Workflow and Review Panel

- [x] 11.1 Implement a toggleable workflow state panel showing current goal, intent, phase/rail position, side threads, and suggested next actions.
- [x] 11.2 Implement eval progress display for running batches.
- [x] 11.3 Implement review panel layout with one eval displayed at a time.
- [x] 11.4 Render baseline output on the left and candidate output on the right.
- [x] 11.5 Render criteria/assertions centered beneath the comparison area.
- [x] 11.6 Show expectation text, pass/fail status, and evidence when grading is available.
- [x] 11.7 Show a qualitative empty state when no formal criteria exist.
- [x] 11.8 Render final answer or run summary plus produced file list and inline previews where practical in each output box.
- [x] 11.9 Provide transcript and detailed metrics access behind toggles or secondary actions.
- [x] 11.10 Show compact per-run metrics under each output box.
- [x] 11.11 Implement keyboard-first eval navigation with left/right movement and `Eval N/M: name` header context.
- [x] 11.12 Implement per-eval verdict selection: candidate better, baseline better, tie, unclear.
- [x] 11.13 Implement per-eval freeform notes entry and persistence.
- [x] 11.14 Implement review actions for save feedback, submit/mark complete, and close/hide.
- [x] 11.15 Ensure improve/rerun/done decisions happen in chat after review summary rather than as mandatory panel buttons.

## 12. Terminal and Headless Fallbacks

- [x] 12.1 Implement markdown/text summaries for workflow state when TUI is unavailable.
- [x] 12.2 Implement editor-based or file-based feedback fallback using `feedback.md`.
- [x] 12.3 Implement parsing or summarization from `feedback.md` into structured `feedback.json` where practical.
- [x] 12.4 Ensure review can be resumed from persisted artifacts even when the original interactive session is gone.
- [x] 12.5 Implement or document JSON mode fallback/probe separately from the primary SDK path.

## 13. Improvement and Description Revision Flow

- [x] 13.1 Implement post-review summary that reports findings and asks the user to choose improve, rerun, or finish.
- [x] 13.2 Implement one-shot/manual description improvement suggestions using user feedback, benchmark results, diagnostics, near misses, and context.
- [x] 13.3 Allow improved candidates or drafts to be saved in the run directory without target-file confirmation.
- [x] 13.4 Require user confirmation before applying description or skill-content changes to target skill files.
- [x] 13.5 Ensure target skill file edits are performed through normal edit/write tools rather than hidden extension writes.
- [x] 13.6 Support explicit user-initiated next iterations by creating `iteration-N+1/` directories and rerunning the approved eval process.
- [x] 13.7 Exclude automatic multi-iteration improve loops from v1 behavior.
- [x] 13.8 Exclude full train/test automatic trigger-description optimizer from v1 behavior while leaving schemas extensible.

## 14. Validation, Testing, and Documentation

- [x] 14.1 Add unit tests for run state creation, mutation, resume, side-thread handling, and history updates.
- [x] 14.2 Add unit tests for artifact path generation and upstream-style directory naming.
- [x] 14.3 Add unit tests for eval schema read/write and compatibility fields.
- [x] 14.4 Add integration tests or fixtures for SDK eval session configuration and skill isolation.
- [x] 14.5 Add tests for model/thinking/tool profile fairness across candidate and baseline runs.
- [x] 14.6 Add tests for metric, diagnostic, timing, transcript, and benchmark artifact generation.
- [x] 14.7 Add TUI component tests or manual QA checklist for review panel navigation, feedback persistence, and compact/expanded modes.
- [x] 14.8 Document `/sc` usage, main workflow, storage location, confirmation boundaries, and review fallback behavior.
- [x] 14.9 Document package installation/loading for local development.
- [x] 14.10 Document which upstream behaviors were preserved, rewritten, or intentionally omitted.
- [x] 14.11 Run OpenSpec validation/status checks and fix any malformed specs or task formatting before implementation.
