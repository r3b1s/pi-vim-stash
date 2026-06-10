## Purpose

Define SDK-based skill eval execution, candidate/baseline isolation, snapshots, model/tool configuration, parallel runs, metrics, diagnostics, transcripts, grading/benchmark artifacts, and retention behavior for the Pi skill-creator extension.

## Requirements

### Requirement: SDK-first eval execution
The system SHALL implement skill eval execution primarily through the Pi TypeScript SDK.

#### Scenario: Eval batch starts
- **WHEN** the user approves an eval batch
- **THEN** the system uses SDK-created agent sessions to execute candidate and baseline runs

#### Scenario: SDK event capture
- **WHEN** an eval session emits agent, message, turn, or tool events
- **THEN** the system captures the events needed to produce transcripts, metrics, diagnostics, timing, and usage artifacts

#### Scenario: JSON fallback is secondary
- **WHEN** SDK execution is unavailable or a compatibility probe is needed
- **THEN** JSON mode MAY be used as a fallback/probe path without becoming the primary eval implementation

#### Scenario: RPC excluded
- **WHEN** choosing eval execution or integration mechanisms
- **THEN** the system SHALL NOT implement an RPC-based client or workflow path

### Requirement: Output-quality evals
The system SHALL evaluate skill behavior primarily through output-quality evals rather than first-class trigger-only evals.

#### Scenario: Eval has task prompt
- **WHEN** an eval case is run
- **THEN** candidate and baseline agents execute the same user task prompt and produce comparable outputs

#### Scenario: Skill load is diagnostic
- **WHEN** a run loads or does not load the tested skill's `SKILL.md`
- **THEN** the system MAY record this in diagnostics without treating it as the primary pass/fail criterion

### Requirement: Upstream-compatible eval set shape
The system SHALL preserve upstream-style `evals.json` fields where practical.

#### Scenario: Eval set is written
- **WHEN** the system creates or updates an eval set
- **THEN** it includes upstream-compatible fields such as `skill_name`, `evals`, `id`, `prompt`, `expected_output`, `files`, and expectations/assertions where applicable

#### Scenario: Pi-specific metadata is needed
- **WHEN** Pi-specific metadata is required for run orchestration or diagnostics
- **THEN** it SHALL be added without removing or renaming upstream-compatible fields unnecessarily

### Requirement: Eval prompt proposal and approval
The system SHALL propose a small default eval set and require user approval before execution.

#### Scenario: First eval set generated
- **WHEN** a draft or snapshot is ready for evaluation
- **THEN** the system proposes 2-3 realistic eval prompts based on user intent, examples, edge cases, and success criteria

#### Scenario: User has not approved prompts
- **WHEN** eval prompts have not been approved
- **THEN** the system SHALL NOT start the eval batch

#### Scenario: User edits prompts
- **WHEN** the user changes proposed eval prompts
- **THEN** the system runs the approved edited prompts rather than the original suggestions

### Requirement: Eval timing within workflow
The system SHALL collect examples and success criteria early, but formalize and run evals after a first draft or snapshot exists.

#### Scenario: Early discovery
- **WHEN** the workflow is still capturing intent or exploring a source skill
- **THEN** the system asks about examples, edge cases, and success criteria without requiring a formal eval set yet

#### Scenario: Draft exists
- **WHEN** a candidate draft or skill snapshot exists
- **THEN** the system can formalize eval prompts and seek approval to run them

#### Scenario: Assertions drafted during or after runs
- **WHEN** eval runs are executing or have completed
- **THEN** the system may draft objective expectations/assertions and use them for grading when appropriate

### Requirement: Parallel candidate and baseline runs
The system SHALL run all candidate and baseline eval conditions concurrently by default once an eval batch is approved.

#### Scenario: Multiple eval cases approved
- **WHEN** an approved eval batch contains multiple eval cases
- **THEN** the system launches the corresponding `with_skill` and baseline runs in parallel unless configured otherwise

#### Scenario: Candidate and baseline pair exists
- **WHEN** an eval case has both candidate and baseline conditions
- **THEN** both conditions are scheduled as part of the same batch rather than waiting for one condition to finish first

### Requirement: Fair model and settings selection
The system SHALL use identical model and thinking settings across all runs in an eval batch.

#### Scenario: User selects eval model
- **WHEN** the user chooses a model for an eval batch
- **THEN** every candidate and baseline run in that batch uses that same model

#### Scenario: No model preference exists
- **WHEN** no eval model preference has been recorded
- **THEN** the system asks the user to choose a model, recommends a cost-first capable model by default, and records the preference for future evals

#### Scenario: Thinking level selected
- **WHEN** the user selects a thinking or reasoning level for an eval batch
- **THEN** every candidate and baseline run in that batch uses that same thinking or reasoning level

#### Scenario: Fairness violation avoided
- **WHEN** candidate and baseline runs are configured
- **THEN** the system SHALL NOT assign different models, providers, or thinking levels to different conditions within the same eval batch

### Requirement: Configurable tool profile with fair application
The system SHALL apply the same tool profile to all candidate and baseline runs in an eval batch.

#### Scenario: Default tool profile
- **WHEN** no special tool needs are inferred or configured
- **THEN** eval runs use the normal Pi coding tool profile

#### Scenario: Broader tools are inferred as useful
- **WHEN** the skill, eval prompts, or user context suggest broader tools such as custom tools or MCP tools are needed
- **THEN** the system proposes adding those tools before the eval batch starts

#### Scenario: Tool profile finalized
- **WHEN** a tool profile is selected for the eval batch
- **THEN** candidate and baseline runs use the identical tool profile

### Requirement: Project cwd with isolated outputs
The system SHALL run eval agents from the project cwd while instructing them to save outputs under isolated run directories.

#### Scenario: Eval run starts
- **WHEN** an eval run begins
- **THEN** its working directory is the project cwd

#### Scenario: Output directory assigned
- **WHEN** an eval run begins
- **THEN** it receives an explicit output directory under `.pi/skill-creator/runs/<run-id>/iteration-N/<eval-name>/<condition>/outputs/`

#### Scenario: Output directory checked
- **WHEN** an eval run completes
- **THEN** the system checks the assigned output directory and records diagnostics about created, missing, or unexpected outputs

### Requirement: Passive output and tool tracking
The system SHALL instruct agents where to write outputs and passively track tool usage without hard sandbox enforcement by default.

#### Scenario: Agent writes outputs as instructed
- **WHEN** an eval agent creates files in its assigned output directory
- **THEN** the system records those outputs for review and metrics

#### Scenario: Agent writes outside assigned output directory
- **WHEN** observable tool calls indicate writes outside the assigned output directory
- **THEN** the system records a diagnostic warning rather than failing solely due to the write

#### Scenario: No hard enforcement by default
- **WHEN** an eval run executes under default settings
- **THEN** the system SHALL NOT hard sandbox or block writes purely to enforce the output directory

### Requirement: Candidate and baseline skill isolation
The system SHALL isolate skill availability so the only intended difference between conditions is the skill condition.

#### Scenario: Candidate condition
- **WHEN** running `with_skill`
- **THEN** the eval session loads only the candidate skill snapshot required for that condition unless the user explicitly configured additional skills

#### Scenario: New-skill baseline
- **WHEN** running `without_skill` for a create-new workflow
- **THEN** the eval session runs with no candidate or baseline skill loaded

#### Scenario: Existing-skill baseline
- **WHEN** running `old_skill` for improve-existing or port/adapt workflows
- **THEN** the eval session loads only the old/source skill snapshot required for that condition unless the user explicitly configured additional skills

#### Scenario: Ambient skills excluded
- **WHEN** an eval session is created for a benchmark condition
- **THEN** ambient global or project skill discovery SHALL be disabled or filtered so unrelated skills do not confound the comparison

### Requirement: Immutable eval snapshots
The system SHALL snapshot candidate and baseline skills into the iteration directory before running evals.

#### Scenario: Candidate eval starts
- **WHEN** an eval iteration is created
- **THEN** the system copies the candidate skill into `iteration-N/skill-snapshots/with_skill/`

#### Scenario: Baseline skill exists
- **WHEN** an improve-existing or port/adapt baseline skill exists
- **THEN** the system copies it into `iteration-N/skill-snapshots/old_skill/`

#### Scenario: No-skill baseline
- **WHEN** the baseline is `without_skill`
- **THEN** the system records baseline metadata without creating a fake skill snapshot

### Requirement: Upstream-style run directory layout
The system SHALL use an upstream-like iteration and eval directory layout.

#### Scenario: Iteration created
- **WHEN** iteration 1 is created for a run
- **THEN** the system writes artifacts under `.pi/skill-creator/runs/<run-id>/iteration-1/`

#### Scenario: Eval case created
- **WHEN** an eval case is materialized for an iteration
- **THEN** the system creates a descriptive eval directory under the iteration directory

#### Scenario: Condition directories created
- **WHEN** condition runs are scheduled for an eval case
- **THEN** the system uses condition directory names `with_skill`, `without_skill`, and/or `old_skill` as applicable

### Requirement: Run completion artifacts
The system SHALL consider an individual eval run complete only after the agent stops and required run artifacts are written.

#### Scenario: Agent stops normally
- **WHEN** an eval agent finishes execution
- **THEN** the system writes or finalizes `transcript.md`, active/debug `transcript.jsonl` when retained, `metrics.json`, `diagnostics.json`, and `timing.json`

#### Scenario: Output directory missing or empty
- **WHEN** an eval agent stops but expected outputs are missing
- **THEN** the system records the condition in diagnostics and still completes the run artifact set

#### Scenario: Grading separate from execution completion
- **WHEN** an individual eval run completes
- **THEN** grading does not have to be complete for the run to be considered execution-complete

### Requirement: Transcript storage
The system SHALL produce readable transcripts and optionally retain raw SDK event logs while active.

#### Scenario: Run transcript written
- **WHEN** an eval run completes
- **THEN** the system writes a readable `transcript.md` for review and future agent context

#### Scenario: Raw event log retained during active run
- **WHEN** a run is active or debugging retention is enabled
- **THEN** the system may retain `transcript.jsonl` or equivalent raw event data for that run

#### Scenario: Raw event pruning offered
- **WHEN** a run is completed
- **THEN** the system offers or supports pruning bulky raw event logs while preserving readable transcripts, outputs, metrics, diagnostics, feedback, benchmark, and summary artifacts

### Requirement: Metrics and diagnostics
The system SHALL record metrics and diagnostics for each eval run.

#### Scenario: Tool metrics captured
- **WHEN** tool events occur during an eval run
- **THEN** the system records tool call counts, tool errors, output size, transcript size, files created or observed, and related execution metrics where possible

#### Scenario: Usage metrics captured
- **WHEN** assistant message usage is available from the SDK
- **THEN** the system records token usage and cost information for the run

#### Scenario: Skill-load diagnostic captured
- **WHEN** the run reads a candidate or baseline `SKILL.md`
- **THEN** the system records the loaded skill path as diagnostic metadata

### Requirement: Timing data
The system SHALL record wall-clock timing for each eval run.

#### Scenario: Eval run starts and ends
- **WHEN** an eval run starts and later completes
- **THEN** the system records executor duration in `timing.json`

#### Scenario: Grading duration exists
- **WHEN** grading is performed for a run
- **THEN** the system records grader duration separately where available

### Requirement: Grading artifacts
The system SHALL support upstream-style `grading.json` artifacts after eval execution.

#### Scenario: Expectations exist
- **WHEN** objective expectations/assertions exist for an eval run
- **THEN** the system grades the run and writes `grading.json` with expectation entries containing `text`, `passed`, and `evidence`

#### Scenario: Qualitative-only eval
- **WHEN** an eval is subjective or has no formal expectations
- **THEN** the system does not force artificial assertions and marks the run as qualitative-review oriented

### Requirement: Benchmark aggregation
The system SHALL aggregate eval results into upstream-style benchmark artifacts.

#### Scenario: Iteration results available
- **WHEN** candidate and baseline runs for an iteration are complete and grading/metrics are available
- **THEN** the system writes `benchmark.json` and `benchmark.md` under the iteration directory

#### Scenario: Per-condition comparison
- **WHEN** benchmark artifacts are generated
- **THEN** they include pass rates where available, timing, token/cost data where available, and candidate-vs-baseline deltas

### Requirement: Evals artifact locations
The system SHALL keep a working eval set at the run root, freeze evals per iteration, and optionally export reusable evals to the skill directory.

#### Scenario: Working eval set updated
- **WHEN** eval prompts are proposed, edited, or approved for the run
- **THEN** the system writes the working eval set to `.pi/skill-creator/runs/<run-id>/evals.json`

#### Scenario: Iteration starts
- **WHEN** an eval iteration begins
- **THEN** the system copies the approved eval set to `iteration-N/evals.json`

#### Scenario: User wants reusable eval suite
- **WHEN** the user chooses to export evals for reuse with the skill
- **THEN** the system may write or help write `evals/evals.json` under the target skill directory after confirmation

### Requirement: Feedback artifacts
The system SHALL store both human-editable and structured feedback artifacts.

#### Scenario: Review feedback saved
- **WHEN** the user records eval feedback through the review panel or fallback editor
- **THEN** the system writes human-facing `feedback.md` and structured/cache `feedback.json` for the iteration

#### Scenario: Terminal fallback used
- **WHEN** the TUI is unavailable or the user chooses editor-based feedback
- **THEN** the system supports editing `feedback.md` and deriving or updating structured feedback data from it

### Requirement: No automatic multi-iteration loop in v1
The system SHALL NOT automatically run repeated improve/eval loops in v1.

#### Scenario: Review completes
- **WHEN** the user submits review feedback
- **THEN** the system summarizes findings and waits for the user to choose improve, rerun, or finish

#### Scenario: User chooses rerun
- **WHEN** the user explicitly chooses to run another iteration
- **THEN** the system creates a new `iteration-N+1` directory and runs the approved eval process for that iteration

### Requirement: One-shot description improvement support
The system SHALL support one-shot/manual description improvement as part of the normal improve flow.

#### Scenario: Description improvement proposed
- **WHEN** feedback, benchmark results, diagnostics, near misses, or context indicate description issues
- **THEN** the agent may propose an improved description and save a candidate in the run directory

#### Scenario: Target description edit
- **WHEN** the improved description is ready to apply to the target skill
- **THEN** the system requires user confirmation before editing the target `SKILL.md`
