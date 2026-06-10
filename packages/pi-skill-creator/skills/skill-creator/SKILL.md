---
name: skill-creator
description: Pi-native workflow guidance for creating, improving, porting, evaluating, and reviewing Agent Skills with the /sc extension and sc_* tools. Use when working on skill design, skill evals, skill porting, or skill improvement.
license: Apache-2.0
compatibility: Designed for Pi with the bundled skill-creator extension; includes fallback guidance when extension tools are unavailable.
metadata:
  package: pi-skill-creator
---

# Skill Creator for Pi

Use this skill when the user wants to create a new Agent Skill, improve an existing skill, run skill evals/benchmarks, or port/adapt an external skill into Pi.

## Mainline Pi Workflow

The Pi extension is the primary implementation surface:

- `/sc` starts, resumes, switches, or shows the workflow.
- `sc_run` creates/resumes/reads/updates durable run state.
- `sc_eval` handles eval prompt approval, snapshots, candidate/baseline runs, metrics, diagnostics, grading, and benchmark aggregation.
- `sc_review` opens/manages review state and persists verdicts/notes.
- Durable artifacts live under `.pi/skill-creator/runs/<run-id>/` by default.

Conversation remains primary. Use chat for intent capture, tradeoff discussion, drafting, porting decisions, review interpretation, and improvement planning. Use extension tools for mechanical workflow state, eval orchestration, and review state.

## Canonical Tool Patterns

- Need to create, resume, inspect, label intent, change phase, park/complete/error a run, or record visible rails? Use `sc_run`.
- Need to run or prepare evals after prompts/settings are approved? Use `sc_eval`.
- Need to review outputs, save verdicts/notes, mark review complete, or summarize review status? Use `sc_review`.
- Do not edit `.pi/skill-creator/runs/*/state.json` directly; state is machine workflow data owned by extension tools.
- Human-facing artifacts such as `summary.md`, `evals.json`, `feedback.md`, and skill drafts can be edited through normal tools when appropriate.
- Ask for user confirmation before running noisy/expensive eval batches or applying edits to target skill files outside the run directory.

## Rails, Not Gates

Track orientation without forcing a rigid wizard:

- current goal
- inferred intent: `create-new`, `improve-existing`, `run-evals`, or `port-adapt`
- phase/rail position
- next suggested actions
- active iteration and artifact paths
- side threads only when the user explicitly marks them ("remember", "park this", "for later", "track this", "lock this in", "ensure this") or confirms an agent suggestion

If intent is ambiguous, continue broad discovery or ask for confirmation before labeling the run.

## Workflow Guidance

### Create New Skill

1. Capture the target capability, users, triggering situations, success criteria, examples, edge cases, and non-goals.
2. Draft the skill instructions and any resources/scripts in the run directory first when uncertainty is high.
3. Propose 2-3 realistic eval prompts after a draft/snapshot exists.
4. Require user approval/edits before running evals.
5. Compare `with_skill` against `without_skill` under identical model, thinking, tools, cwd, and environment.
6. Review results; discuss improve, rerun, or finish in chat.

### Improve Existing Skill

1. Inspect the existing skill and user-reported failure modes.
2. Snapshot the old skill for `old_skill` baseline before changing target files.
3. Draft candidate changes and eval prompts.
4. Require confirmation before applying target skill edits.
5. Compare `with_skill` against `old_skill` fairly.

### Port or Adapt External Skill

1. Ask whether the goal is a close fork or a Pi-native rewrite.
2. Preserve upstream license/attribution outside active prompt content.
3. Remove or rewrite non-Pi assumptions from active instructions.
4. Use source/upstream snapshot as `old_skill` baseline when it can run cleanly enough in Pi; otherwise record diagnostics.

### Eval-Only / Benchmark

1. Select or create eval prompts and expectations.
2. Confirm model/thinking/tool profile and eval prompts with the user.
3. Run candidate/baseline conditions fairly and in parallel by default.
4. Review persisted artifacts before deciding next steps.

## Eval Artifacts

Preserve upstream-compatible names where practical:

- `evals.json` at run root and per iteration
- `eval_metadata.json`
- `grading.json`
- `metrics.json`
- `diagnostics.json`
- `timing.json`
- `transcript.md`
- optional active/debug `transcript.jsonl`
- `benchmark.json` and `benchmark.md`
- `feedback.md` and `feedback.json`
- `history.json`
- `summary.md`

Prefer paths and summaries in chat/tool results instead of dumping large transcripts or raw event logs.

## Review Guidance

Review compares one eval at a time:

- baseline output on the left (`without_skill` or `old_skill`)
- candidate output on the right (`with_skill`)
- criteria/assertions centered beneath the comparison
- compact metrics under each run
- verdict: candidate better, baseline better, tie, or unclear
- freeform notes saved per eval

After review completes, summarize in chat and ask the user whether to improve, rerun, or finish. Do not run automatic multi-iteration loops in v1.

## Fallback When Extension Tools Are Unavailable

If `/sc` or `sc_*` tools are unavailable, continue manually while preserving the same boundaries:

1. Create a run directory under `.pi/skill-creator/runs/<manual-run-id>/`.
2. Keep a human-readable `summary.md` and avoid hand-editing machine state if the extension may resume later.
3. Draft skill changes in run artifacts first when target writes need confirmation.
4. Write `evals.json`, run candidate/baseline prompts with the same settings, and save outputs/transcripts/metrics under iteration directories.
5. Use `feedback.md` for review notes and summarize next steps in chat.

Fallback is a backup path, not the preferred workflow.
