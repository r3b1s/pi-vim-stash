# Pi Skill Creator

Pi-native package for creating, improving, porting, evaluating, and reviewing Agent Skills.

## Package resources

This package declares both resources in `package.json`:

- extension: `src/extension/index.ts`
- bundled skill: `skills/skill-creator/SKILL.md`

Install locally during development:

```bash
pi install -l .
# or try once
pi -e .
```

## Usage

- `/sc` starts or resumes the workflow.
- `sc_run` manages durable run state.
- `sc_eval` orchestrates eval planning/execution artifacts.
- `sc_review` manages persisted review state and feedback.

Run artifacts are stored under `.pi/skill-creator/runs/<run-id>/` by default and are ignored by git.

## Confirmation boundaries

The extension may write run-directory artifacts. Ask before running noisy/expensive eval batches or applying edits to target skill files outside the run directory.

## JSON mode fallback/probe

The primary eval path is the Pi TypeScript SDK. JSON mode is reserved for future compatibility probes or fallback diagnostics and should not be used as the normal `/sc` or `sc_*` workflow implementation.
