## ADDED Requirements

### Requirement: Extension-aware bundled skill
The system SHALL bundle a `skill-creator` Agent Skill that is aware of and designed to coordinate with the Pi extension.

#### Scenario: Skill metadata loaded
- **WHEN** Pi discovers the bundled skill
- **THEN** the skill exposes valid Agent Skills frontmatter with aligned name and directory conventions for this project

#### Scenario: Skill instructions reference extension workflow
- **WHEN** the agent reads the bundled skill instructions
- **THEN** the instructions describe `/sc`, `sc_*` tools, run directories, eval workflow, review panel, and fallback behavior

#### Scenario: Extension unavailable
- **WHEN** the skill is used without the extension capabilities available
- **THEN** the skill provides enough fallback/manual guidance to create, improve, port, and evaluate skills using available tools

### Requirement: Extension-first guidance
The bundled skill SHALL treat the Pi extension as the mainline workflow implementation.

#### Scenario: Mechanical workflow needed
- **WHEN** the agent needs to create or resume run state, execute evals, or open review
- **THEN** the skill guides the agent to use `sc_*` extension tools rather than ad hoc manual orchestration

#### Scenario: Reasoning or drafting needed
- **WHEN** the user is clarifying intent, choosing porting strategy, drafting instructions, interpreting feedback, or planning improvements
- **THEN** the skill guides the agent to reason conversationally rather than delegating all thought to extension tools

### Requirement: High-level guidance with canonical tool patterns
The bundled skill SHALL provide high-level workflow guidance and canonical tool-use patterns without brittle step-by-step choreography.

#### Scenario: Eval prompts approved
- **WHEN** eval prompts have been approved by the user
- **THEN** the skill may instruct the agent to use `sc_eval` as the canonical mechanism for snapshotting, running, and collecting eval results

#### Scenario: State update needed
- **WHEN** the workflow goal, intent, side thread, or run status needs to be recorded
- **THEN** the skill may instruct the agent to use `sc_run` rather than editing machine state directly

#### Scenario: Review needed
- **WHEN** an eval iteration is ready for human review
- **THEN** the skill may instruct the agent to use `sc_review` to open or manage review state

### Requirement: `/sc` command coordinates workflow activation
The extension SHALL provide `/sc` as the main command for starting, resuming, and showing the skill-creator workflow.

#### Scenario: Command invoked
- **WHEN** the user invokes `/sc`
- **THEN** the extension creates or resumes a run, activates the instruction layer, and shows or updates workflow state as appropriate

#### Scenario: Command toggles visibility
- **WHEN** a workflow is already active and the user invokes `/sc` for visibility control
- **THEN** the extension may show, hide, or focus the workflow panel without starting an unrelated new run

### Requirement: `sc_*` tool prefix
The extension SHALL use the `sc_` prefix for LLM-callable skill-creator tools.

#### Scenario: Tool names registered
- **WHEN** the extension registers LLM-callable tools
- **THEN** skill-creator tools use names beginning with `sc_`

#### Scenario: Long prefix avoided
- **WHEN** the extension exposes v1 skill-creator tools
- **THEN** it SHALL NOT require the longer `skill_creator_` prefix for those tools

### Requirement: Small phase-oriented tool surface
The extension SHALL expose a small set of phase-oriented tools for v1.

#### Scenario: Run state operation
- **WHEN** the agent needs to create, resume, read, or update run state
- **THEN** it uses `sc_run`

#### Scenario: Eval operation
- **WHEN** the agent needs to snapshot skills, run evals, collect metrics, or aggregate an iteration
- **THEN** it uses `sc_eval`

#### Scenario: Review operation
- **WHEN** the agent needs to open review, save feedback, mark review complete, or summarize review status
- **THEN** it uses `sc_review`

#### Scenario: Tool surface remains compact
- **WHEN** implementing v1
- **THEN** the extension avoids creating many narrow tools for every internal operation unless a clear reliability need emerges

### Requirement: Concise tool results with structured details
Extension tools SHALL return concise human-readable summaries plus structured details.

#### Scenario: Tool completes successfully
- **WHEN** an `sc_*` tool completes
- **THEN** its result content includes a concise summary suitable for the agent and user

#### Scenario: Machine-readable data needed
- **WHEN** an `sc_*` tool produces ids, paths, metrics, status, or result metadata
- **THEN** its result includes structured details containing that data

#### Scenario: Raw artifacts are large
- **WHEN** a tool produces or references large transcripts, outputs, or event logs
- **THEN** the tool result returns paths and summaries rather than dumping raw data into conversation context

### Requirement: Extension owns machine state mutation
The extension SHALL be the only component that mutates `state.json`.

#### Scenario: Agent requests state change
- **WHEN** the agent needs to change run status, current goal, intent label, side thread data, active iteration, or panel state
- **THEN** it requests the change through `sc_run`, `sc_eval`, or `sc_review`

#### Scenario: Direct state edit attempted
- **WHEN** the agent would otherwise edit `state.json` directly
- **THEN** the skill guidance and extension contract require using extension tools instead

### Requirement: Agent owns target skill content edits
The agent SHALL perform target skill file writes or edits through normal file tools after user confirmation.

#### Scenario: Candidate ready for target application
- **WHEN** a candidate skill draft or improvement should be applied to the target skill path
- **THEN** the agent asks for user confirmation and then uses normal write/edit tools to make the visible file change

#### Scenario: Extension creates run artifacts
- **WHEN** drafts, snapshots, eval results, metrics, diagnostics, reports, or state artifacts are needed inside the run directory
- **THEN** the extension writes those artifacts without requiring the agent to manually construct every file

### Requirement: Upstream-derived resources with license preservation
The package SHALL preserve upstream license material when adapting upstream Anthropic skill-creator content.

#### Scenario: Upstream content copied or adapted
- **WHEN** upstream skill instructions, scripts, prompts, schemas, or resources are copied or adapted
- **THEN** the repository includes appropriate Apache-2.0 license material and documentation attribution outside active skill/prompt instructions

#### Scenario: Active prompt content adapted
- **WHEN** upstream prompt or skill content is adapted for active use
- **THEN** Claude Code, Cowork, browser, `.claude/commands`, `claude -p`, and `present_files` assumptions are removed or rewritten for Pi

### Requirement: Bundled specialist prompts
The system SHALL preserve grader, analyzer, and comparator concepts as bundled resources.

#### Scenario: Grading needed
- **WHEN** eval outputs need qualitative or assertion-based grading
- **THEN** the system can use a bundled grader reference prompt or equivalent logic without requiring a separate subagent extension

#### Scenario: Benchmark analysis needed
- **WHEN** benchmark data is available
- **THEN** the system can use a bundled analyzer reference prompt or equivalent logic to surface non-obvious patterns such as flaky evals, non-discriminating assertions, and time/token tradeoffs

#### Scenario: Blind comparison needed later
- **WHEN** a future workflow needs blind A/B comparison
- **THEN** the system has a bundled comparator reference prompt concept available without making it mandatory for v1 review

### Requirement: Skill directory and frontmatter alignment
The bundled skill SHALL align its directory name and frontmatter name for portability and consistency.

#### Scenario: Skill packaged
- **WHEN** the bundled skill is added to the package
- **THEN** its directory name and frontmatter `name` are both `skill-creator`

### Requirement: Pi package resource declaration
The repository SHALL declare Pi resources so the extension and skill can be installed together.

#### Scenario: Package manifest created
- **WHEN** the package manifest is created
- **THEN** it declares Pi extension and skill resources using Pi package conventions

#### Scenario: User installs local package
- **WHEN** the package is installed or loaded through Pi package/local path mechanisms
- **THEN** Pi can discover both the `/sc` extension and bundled `skill-creator` skill

### Requirement: Fallback JSON mode probe remains separate from primary contract
The extension contract SHALL not rely on JSON mode for normal operation.

#### Scenario: Normal extension workflow
- **WHEN** `/sc` and `sc_*` tools are used in Pi
- **THEN** the workflow uses extension APIs and the SDK eval engine rather than spawning JSON mode as the main path

#### Scenario: Compatibility fallback needed
- **WHEN** a fallback/probe runner is implemented
- **THEN** it remains separate from the primary extension-tool contract
