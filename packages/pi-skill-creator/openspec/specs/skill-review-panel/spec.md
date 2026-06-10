## Purpose

Define the terminal/TUI overlay review experience for workflow status, eval progress, candidate/baseline comparison, criteria display, compact metrics, verdict/notes feedback, and review completion for the Pi skill-creator extension.

## Requirements

### Requirement: Context-dependent review panel
The system SHALL provide a terminal/TUI review panel whose content adapts to the current workflow context.

#### Scenario: Eval batch running
- **WHEN** an eval batch is running
- **THEN** the panel shows progress, running/completed/failed condition status, and relevant run paths or summaries

#### Scenario: Eval review ready
- **WHEN** an eval iteration is ready for review
- **THEN** the panel shows candidate/baseline output comparison, criteria, compact metrics, and feedback controls

#### Scenario: General workflow state requested
- **WHEN** no eval review is active or the user requests workflow state
- **THEN** the panel shows current goal, inferred intent, phase/rail position, side threads, and suggested next actions where available

### Requirement: Chat remains primary
The system SHALL implement the panel as an aid to the conversational workflow, not as a replacement for chat.

#### Scenario: Panel open during conversation
- **WHEN** the panel is open
- **THEN** the user can still continue the conversational workflow and the panel can be hidden or dismissed

#### Scenario: Review completes
- **WHEN** the user submits review feedback
- **THEN** the agent summarizes and discusses next steps in chat rather than requiring all decisions inside the panel

### Requirement: Toggleable and expandable panel
The system SHALL support both compact and expanded review panel presentations.

#### Scenario: Compact panel desired
- **WHEN** the user wants to keep chat visible
- **THEN** the system can show a compact side panel or similarly non-dominant overlay

#### Scenario: Expanded review desired
- **WHEN** the user needs more space for comparison or feedback
- **THEN** the system can expand the panel to a larger overlay or workbench-like presentation

#### Scenario: User hides panel
- **WHEN** the user closes or hides the panel
- **THEN** the workflow continues and the panel can be shown again later

### Requirement: One-eval-at-a-time review
The system SHALL display one eval case at a time during output review.

#### Scenario: Review opens
- **WHEN** an iteration has multiple eval cases
- **THEN** the review panel initially displays one selected eval case and indicates its position within the set

#### Scenario: Eval changes
- **WHEN** the user navigates to another eval case
- **THEN** the panel replaces the comparison content with that eval's baseline, candidate, criteria, metrics, and feedback

### Requirement: Baseline-left candidate-right comparison
The system SHALL place baseline output on the left and candidate output on the right during eval review.

#### Scenario: New-skill baseline
- **WHEN** reviewing a create-new eval case
- **THEN** the left side shows `without_skill` output and the right side shows `with_skill` output

#### Scenario: Existing-skill baseline
- **WHEN** reviewing an improve-existing or port/adapt eval case
- **THEN** the left side shows `old_skill` output and the right side shows `with_skill` output

### Requirement: Criteria centered beneath comparison
The system SHALL show eval criteria beneath the baseline/candidate comparison area.

#### Scenario: Formal grading exists
- **WHEN** `grading.json` contains expectation results for the selected eval case
- **THEN** the criteria area shows expectation text, pass/fail status, and evidence where available

#### Scenario: Assertions exist but are ungraded
- **WHEN** eval metadata contains assertions or expectations but grading has not run
- **THEN** the criteria area shows the criteria text without pass/fail evidence

#### Scenario: Qualitative-only eval
- **WHEN** the selected eval has no formal criteria
- **THEN** the criteria area shows a clear empty state indicating that the review is qualitative

### Requirement: Keyboard-first navigation
The system SHALL prioritize keyboard navigation during review.

#### Scenario: Next eval shortcut
- **WHEN** the user presses the configured next-eval key such as right arrow
- **THEN** the panel navigates to the next eval case when one exists

#### Scenario: Previous eval shortcut
- **WHEN** the user presses the configured previous-eval key such as left arrow
- **THEN** the panel navigates to the previous eval case when one exists

#### Scenario: Header nav indicator
- **WHEN** an eval case is displayed
- **THEN** the panel header shows navigation context such as `Eval N/M: <name>`

### Requirement: Feedback verdict and notes
The system SHALL collect per-eval feedback as a verdict plus freeform notes.

#### Scenario: User selects verdict
- **WHEN** the user reviews an eval case
- **THEN** the panel allows selecting one verdict from `candidate better`, `baseline better`, `tie`, or `unclear`

#### Scenario: User writes notes
- **WHEN** the user has qualitative feedback about the selected eval case
- **THEN** the panel allows entering freeform notes associated with that eval case

#### Scenario: Feedback persists
- **WHEN** the user navigates away from an eval case or closes the panel
- **THEN** entered feedback is saved to iteration feedback artifacts

### Requirement: Output boxes include summary and artifacts
The system SHALL show final answer or run summary plus produced outputs in each candidate/baseline box.

#### Scenario: Text answer exists
- **WHEN** a run produced a final assistant answer or summary
- **THEN** the corresponding output box shows that text or a concise summary

#### Scenario: Files were produced
- **WHEN** a run produced files in its output directory
- **THEN** the corresponding output box lists those files and renders inline previews where practical

#### Scenario: Full transcript needed
- **WHEN** the user requests more detail for a run
- **THEN** the panel provides access to the readable transcript or transcript path without showing raw transcript content by default

### Requirement: Compact per-run metrics
The system SHALL show compact metrics under each baseline and candidate output box.

#### Scenario: Metrics available
- **WHEN** metrics and timing are available for a run
- **THEN** the panel shows compact values such as tokens, cost, tool count, error count, and duration under that run's output box

#### Scenario: Metrics unavailable
- **WHEN** a metric is unavailable due to provider or capture limitations
- **THEN** the panel shows an omitted or unknown state rather than fabricating the metric

### Requirement: Minimal review actions
The system SHALL expose only review-focused actions in the review panel for v1.

#### Scenario: User saves feedback
- **WHEN** the user records feedback for an eval case
- **THEN** the panel saves the feedback to `feedback.md` and `feedback.json` or their in-memory equivalents before persistence

#### Scenario: User submits review complete
- **WHEN** the user marks review complete
- **THEN** the system records review completion and returns control to the conversational summary/improvement decision flow

#### Scenario: User wants to improve or rerun
- **WHEN** the user wants to improve or rerun after review
- **THEN** those decisions are handled in chat after review summary rather than as primary v1 panel buttons

### Requirement: Feedback fallback artifacts
The system SHALL support review without an interactive TUI by using feedback files.

#### Scenario: No interactive UI available
- **WHEN** the system cannot show the review panel
- **THEN** it provides or updates `feedback.md` for human editing and `feedback.json` for structured feedback capture

#### Scenario: Feedback file edited
- **WHEN** the user edits feedback through a terminal editor or manually
- **THEN** the workflow can read that feedback and summarize it in chat

### Requirement: Review panel uses durable artifacts
The system SHALL render review data from the run directory artifacts rather than relying only on volatile session memory.

#### Scenario: Review reopened later
- **WHEN** the user reopens review for a prior iteration
- **THEN** the panel reconstructs comparison, metrics, criteria, and feedback state from persisted run artifacts

#### Scenario: Active session changed
- **WHEN** the original chat session is not available
- **THEN** the review panel still displays persisted outputs, summaries, metrics, and feedback for the run where possible
