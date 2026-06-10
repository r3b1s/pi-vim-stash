## ADDED Requirements

### Requirement: `/sc` workflow entry point
The system SHALL provide `/sc` as the primary user-facing command for the skill-creator extension.

#### Scenario: Start new workflow when no active run exists
- **WHEN** the user invokes `/sc` in a project with no active skill-creator run
- **THEN** the system creates or prepares a new workflow context under the configured run storage root and starts broad conversational intent discovery

#### Scenario: Resume active workflow by default
- **WHEN** the user invokes `/sc` in a project with a latest active run
- **THEN** the system offers to continue the latest active run by default while also exposing options to start a new run or switch runs

#### Scenario: Use short command name
- **WHEN** the extension registers its primary command
- **THEN** the command name SHALL be `/sc`, not `/skill-creator`

### Requirement: Automatic instruction-layer activation
The system SHALL activate the bundled skill-creator instruction layer when `/sc` starts or resumes a workflow.

#### Scenario: User invokes `/sc` without manually loading a skill
- **WHEN** the user invokes `/sc` without using `/skill:skill-creator`
- **THEN** the system ensures the agent has skill-creator workflow guidance available for the current workflow

#### Scenario: Instruction layer is extension-aware
- **WHEN** the instruction layer is active
- **THEN** it SHALL describe the extension-first workflow, `/sc` command, `sc_*` tools, run artifacts, eval/review flow, and fallback behavior when extension capabilities are unavailable

### Requirement: Hybrid conversational workflow
The system SHALL keep conversation primary while using structured UI and tools when they improve workflow clarity or reliability.

#### Scenario: Intent capture and drafting stay conversational
- **WHEN** the user is explaining the skill to create, port, improve, or evaluate
- **THEN** the agent conducts intent capture, examples, success criteria, porting decisions, and improvement reasoning through conversation rather than forcing a rigid wizard

#### Scenario: Structured UI appears when useful
- **WHEN** workflow state, eval progress, or output review benefits from structure
- **THEN** the system MAY show a toggleable overlay or review panel without replacing the conversational workflow

### Requirement: Visible workflow state with rails not gates
The system SHALL track visible workflow state as orientation rails without making phases hard gates.

#### Scenario: Display current workflow orientation
- **WHEN** a skill-creator run is active
- **THEN** the system exposes current goal, inferred intent when available, phase or rail position, next suggested actions, and important artifact paths

#### Scenario: Allow flexible movement across phases
- **WHEN** the user shifts from the current phase to a related concern
- **THEN** the system allows the conversation to continue and updates or annotates state without blocking the user solely because the phase changed

#### Scenario: Toggle state visibility
- **WHEN** the user wants less UI
- **THEN** the system allows the workflow state display or overlay to be hidden and later shown again

### Requirement: Intent labeling after sufficient evidence
The system SHALL start broad and label the workflow intent only after sufficient evidence is available.

#### Scenario: User states intent clearly
- **WHEN** the user clearly says they are creating, improving, evaluating, or porting a skill
- **THEN** the system records the corresponding intent label for the run

#### Scenario: Intent is ambiguous
- **WHEN** the available conversation and artifacts do not clearly identify the intent
- **THEN** the system continues broad discovery or asks for confirmation before labeling the run

#### Scenario: Intent changes as understanding improves
- **WHEN** new evidence shows the workflow is better classified differently
- **THEN** the system updates the intent label while preserving prior context and artifacts

### Requirement: Supported v1 workflow intentions
The system SHALL support create-new, improve-existing, run-evals/benchmark, and port/adapt-external-skill workflows in v1.

#### Scenario: Create-new workflow
- **WHEN** the user wants a new skill from scratch
- **THEN** the system supports intent capture, drafting, eval prompt proposal, candidate-vs-no-skill evaluation, review, and optional improvement

#### Scenario: Improve-existing workflow
- **WHEN** the user wants to improve an existing skill
- **THEN** the system supports source inspection, snapshotting, candidate drafting, candidate-vs-old-skill evaluation, review, and optional improvement

#### Scenario: Eval-only workflow
- **WHEN** the user wants to run evals or benchmark a skill without changing it
- **THEN** the system supports creating or selecting eval prompts, running candidate and baseline conditions, and reviewing results without requiring target skill edits

#### Scenario: Port-adapt workflow
- **WHEN** the user wants to port or adapt an external skill
- **THEN** the system asks or records whether the adaptation should be close-fork or Pi-native rewrite and supports source-snapshot baseline evaluation when possible

### Requirement: Confirmation before noisy or destructive actions
The system SHALL require user confirmation before running noisy/expensive operations or writing to target skill paths.

#### Scenario: Eval prompt approval
- **WHEN** the system has generated proposed eval prompts
- **THEN** it SHALL show the prompts to the user and require approval or edits before running the eval batch

#### Scenario: Target skill write confirmation
- **WHEN** a candidate draft or improvement is ready to apply to the target skill path
- **THEN** the system SHALL ask for user confirmation before the agent writes or edits target skill files

#### Scenario: Run-dir drafts do not require target-write confirmation
- **WHEN** the system writes candidate drafts, snapshots, reports, metrics, diagnostics, or state inside the run directory
- **THEN** it MAY write those artifacts as part of the workflow without treating them as target skill edits

### Requirement: Durable run directory
The system SHALL store durable skill-creator run data under `.pi/skill-creator/runs/` by default.

#### Scenario: Default run root
- **WHEN** a run is created without custom configuration
- **THEN** the system stores the run under `.pi/skill-creator/runs/<run-id>/`

#### Scenario: Run data is project-local
- **WHEN** the user resumes work in the same project later
- **THEN** the system can discover prior runs from the project-local run directory

#### Scenario: Run data is not intended for commit by default
- **WHEN** the system creates run artifacts
- **THEN** the artifacts SHALL be located in the `.pi` project-local area so they can be ignored as local tool state

### Requirement: Configurable run directory
The system SHALL allow the run storage root to be configurable after the default location is implemented.

#### Scenario: Custom run root configured
- **WHEN** configuration specifies a custom skill-creator runs directory
- **THEN** new runs SHALL be created under that configured directory instead of the default

### Requirement: Smart resume and run switching
The system SHALL support smart resume of the latest active run and explicit creation or switching of runs.

#### Scenario: Latest active run exists
- **WHEN** the user invokes `/sc` and a latest active run exists
- **THEN** the system presents continuing that run as the default action

#### Scenario: User chooses new run
- **WHEN** the user selects a new run instead of continuing
- **THEN** the system creates a new run without deleting or corrupting the existing run

#### Scenario: User switches runs
- **WHEN** the user chooses to switch to another prior run
- **THEN** the system loads that run's state and updates the visible workflow context accordingly

### Requirement: Explicit-marker side-thread tracking
The system SHALL track side threads only when explicitly indicated by the user or confirmed by the user.

#### Scenario: User explicitly marks an open loop
- **WHEN** the user says phrases such as "remember this", "park this", "for later", "track this", "lock this in", or "ensure this"
- **THEN** the system records or updates a side thread with title, status, relation, notes, and optional next action

#### Scenario: Agent notices an ambiguous detour
- **WHEN** the agent believes a detour may matter later but the user has not explicitly marked it
- **THEN** the agent asks whether to track it before creating a side thread

#### Scenario: Side thread does not replace main rail
- **WHEN** a side thread is recorded
- **THEN** the system preserves the main workflow goal and provides a way to return to it

### Requirement: Controlled workflow state mutation
The system SHALL treat `state.json` as machine workflow state mutated only by extension-controlled mechanisms.

#### Scenario: Agent wants to update workflow state
- **WHEN** the agent needs to record current goal, phase, side thread, active iteration, or run status
- **THEN** it SHALL request the update through extension tools rather than editing `state.json` directly

#### Scenario: Human-facing artifacts remain editable
- **WHEN** the agent or user needs to modify `evals.json`, `feedback.md`, `summary.md`, or skill draft content
- **THEN** those human-facing artifacts MAY be edited through normal file editing workflows subject to applicable confirmations

### Requirement: Upstream-compatible workflow history
The system SHALL maintain `history.json` for upstream-style iteration/version progression separately from Pi workflow state.

#### Scenario: Iteration result recorded
- **WHEN** an eval iteration has benchmark or grading results
- **THEN** the system records version progression, parent version, pass rate, grading result, and current-best metadata in `history.json` where applicable

#### Scenario: UI state recorded separately
- **WHEN** the system records overlay status, active goal, side threads, pending confirmations, or artifact paths
- **THEN** it records that data in `state.json` rather than overloading `history.json`

### Requirement: Run summary artifact
The system SHALL maintain a human-readable `summary.md` at the run root.

#### Scenario: Workflow reaches a decision or review result
- **WHEN** the workflow captures important decisions, findings, or next steps
- **THEN** the system updates or enables updating `summary.md` so future agents and users can understand the run without reading raw event logs
