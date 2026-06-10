## Why

pi-things is a pnpm monorepo with 4 packages (`@r3b1s/pi-skill-creator`, `@r3b1s/pi-vim-stash`, `@r3b1s/pi-token-killer`, `@r3b1s/pi-holo-mem`). The repo has quality gates (typecheck, lint, test) but no CI/CD pipeline and no npm publishing workflow. Adding GitHub Actions CI with release-please for automated versioning and npm publishing with OIDC provenance will establish a reliable release pipeline.

## What Changes

- Add `.github/workflows/ci.yml` — single workflow with 3 jobs: `check` (typecheck + lint + test), `release-please` (automated version bumps from conventional commits), `publish` (npm publish with OIDC provenance)
- Add `release-please-config.json` — maps 4 packages to components, defines changelog sections (feat, fix, perf, revert, docs, chore shown; style, refactor, test, build, ci hidden), excludes `.pi/retros`, `.pi/skills`, `openspec/` as release triggers
- Add `.release-please-manifest.json` — current versions for all 4 packages
- Add `scripts/publish-released.sh` — dynamic publish script that reads release-please output and publishes released packages (no hardcoded package list — derives from release-please-config.json + each package.json name)
- Add `.github/ISSUE_TEMPLATE/bug_report.yml` — bug report template with package dropdown
- Add `.github/ISSUE_TEMPLATE/feature_request.yml` — feature request template with package dropdown
- Add `.github/ISSUE_TEMPLATE/config.yml` — disables blank issues
- Add `files` arrays to all 4 package.json files for clean npm tarballs
- Add `repository` field to all 4 package.json files for provenance requirements
- Update `.gitignore` if needed for any new patterns

## Capabilities

### New Capabilities
- `ci-pipeline`: GitHub Actions workflow with quality gates (typecheck, lint, test), release-please for automated versioning, and npm publish with OIDC provenance
- `npm-publishing`: Dynamic publish script, package.json metadata for publishing (files, repository, publishConfig), OIDC trusted publishing setup

### Modified Capabilities

## Impact

- New files: `.github/workflows/ci.yml`, `release-please-config.json`, `.release-please-manifest.json`, `scripts/publish-released.sh`, `.github/ISSUE_TEMPLATE/*.yml`
- Modified files: all 4 `packages/*/package.json` (add files, repository fields)
- External: npm account @r3b1s needs trusted publisher config on npmjs.com (per-package, after first publish)
- External: GitHub repo needs to be public for OIDC provenance
- pi-holo-mem Python tests need a CI step (mise task test-python)
- Conventional commits become load-bearing (release-please reads them for version bumps)
