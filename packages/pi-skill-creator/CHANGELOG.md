# Changelog

All notable changes to the pi-skill-creator extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/r3b1s/pi-things/compare/pi-skill-creator-v0.1.0...pi-skill-creator-v0.2.0) (2026-06-10)


### Features

* **pi-skill-creator:** import skill creator extension ([c24aadc](https://github.com/r3b1s/pi-things/commit/c24aadcef8ad320d26421f8d2f3cd068ca79caff))
* **repo:** add CI/CD pipeline with release-please and npm publishing ([b8872bb](https://github.com/r3b1s/pi-things/commit/b8872bb36f78342eb8255200be09be66f1e8dd3c))

## [0.1.0] - 2026-05-26

### Added

- **`/sc` command** — Primary user entry point for creating, porting, improving, evaluating, and reviewing Agent Skills. Creates or resumes a run, activates the bundled skill guidance, and shows workflow state.
- **`sc_run` tool** — Create, resume, read, and update workflow run state including current goal, phase, intent label, and side threads.
- **`sc_eval` tool** — Snapshot skills, run eval batches with candidate/baseline conditions, collect metrics and diagnostics, and aggregate iteration results.
- **`sc_review` tool** — Open the TUI review panel, save eval feedback, mark review complete, and manage review state.
- **SDK-first eval engine** — Skill evaluation using the Pi TypeScript SDK with parallel candidate/baseline runs, identical model/tool settings per batch, and fair condition isolation.
- **Output-quality evaluation** — Skill behavior evaluated through user task prompts with comparable candidate/baseline outputs rather than trigger-only evals.
- **Eval prompt proposal and approval** — Automatic generation of 2-3 realistic eval prompts based on user intent with required user approval before execution.
- **Grading engine** — Expectation-based assertions with pass/fail evidence, qualitative review support, and benchmark aggregation with pass rates, timing, and cost deltas.
- **Terminal/TUI review panel** — Context-dependent side-by-side comparison of baseline and candidate outputs with criteria display, compact metrics, per-eval verdict/notes feedback, and keyboard navigation.
- **Durable run storage** — Project-local run artifacts under `.pi/skill-creator/runs/` with upstream-compatible layout: iterations, eval cases, condition directories, transcripts, metrics, diagnostics, and timelines.
- **Smart workflow resume** — Detects the latest active run on `/sc` invocation and defaults to continuing it, with options to start new runs or switch between existing runs.
- **Visible workflow state** — Toggleable orientation panel showing current goal, inferred intent, phase/rail position, side threads, and suggested next actions — rails not gates.
- **Explicit-marker side-thread tracking** — Lightweight open loops created only when the user explicitly marks items for later tracking, avoiding noisy auto-accumulation.
- **Bundled `skill-creator` Agent Skill** — Extension-aware instruction layer that guides the agent to use `/sc` and `sc_*` tools as the mainline workflow while providing fallback manual guidance when the extension is unavailable.
- **Grader, analyzer, and comparator reference prompts** — Bundled resource prompts for qualitative grading, benchmark analysis, and blind A/B comparison.
- **Eval JSON schemas** — Validation schemas for `evals.json` and `state.json` artifact formats.
- **Four OpenSpec capability specs** — Foundation specifications for the skill-creator-workflow, skill-evaluation-engine, skill-extension-contract, and skill-review-panel capabilities.
- **Upstream license attribution** — Apache-2.0 license and attribution for adapted Anthropic `skill-creator` content, with all Claude Code, Cowork, browser, and `present_files` assumptions rewritten for Pi.
- **Comprehensive test suite** — Unit tests covering artifacts, baselines, eval config, eval runner, grading, improvement, review UI, and storage modules.

### Changed

- N/A — Initial release.

### Deprecated

- N/A — Initial release.

### Removed

- N/A — Initial release.

### Fixed

- N/A — Initial release.

### Security

- N/A — Initial release.

[0.1.0]: https://github.com/r3b1s/pi-things/releases/tag/pi-skill-creator-v0.1.0
