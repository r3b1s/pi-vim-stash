## ADDED Requirements

### Requirement: CI quality gates run on PRs and main pushes

The CI workflow SHALL trigger on pull requests and pushes to the main branch. The check job SHALL run typecheck (`pnpm -r run check`), Biome lint (`biome check .`), ESLint lint (`eslint packages/`), and tests (`pnpm -r run test`).

#### Scenario: PR opened triggers all quality gates

- **WHEN** a pull request is opened against the main branch
- **THEN** the check job runs typecheck, Biome lint, ESLint lint, and all tests

#### Scenario: Push to main triggers gates and release workflow

- **WHEN** commits are pushed to the main branch
- **THEN** the check job runs typecheck, Biome lint, ESLint lint, and all tests
- **AND** the release-please job runs to evaluate conventional commits
- **AND** the publish job runs if release-please created releases

### Requirement: Release-please creates version PRs from conventional commits

release-please SHALL read conventional commits since the last tag per package and create or update a "Version Packages" PR with version bumps and CHANGELOG.md updates.

#### Scenario: feat commit merged to main bumps MINOR version

- **WHEN** a commit with a `feat` type is merged to main
- **THEN** release-please opens a PR bumping the MINOR version of the affected package
- **AND** the PR includes a CHANGELOG.md entry for the new feature

#### Scenario: fix commit merged to main bumps PATCH version

- **WHEN** a commit with a `fix` type is merged to main
- **THEN** release-please opens a PR bumping the PATCH version of the affected package
- **AND** the PR includes a CHANGELOG.md entry for the fix

#### Scenario: Only docs and retro files changed triggers no version PR

- **WHEN** all commits since the last tag only touch docs or retro files within excluded paths
- **THEN** release-please creates no version PR

### Requirement: npm publishing with OIDC provenance

When release-please creates a release, the publish job SHALL run and publish released packages to npm using OIDC provenance attestation with the `--provenance` flag and `id-token: write` permission.

#### Scenario: Release created triggers publish

- **WHEN** release-please has created one or more releases
- **THEN** the publish job runs
- **AND** each released package is published to npm with `--provenance` attestation

#### Scenario: No releases created skips publish

- **WHEN** release-please has not created any releases
- **THEN** the publish job is skipped

### Requirement: Permissions follow least-privilege

The workflow SHALL set `permissions: contents: read` at the workflow level. The release-please job SHALL escalate to `contents: write, pull-requests: write`. The publish job SHALL escalate to `contents: read, id-token: write`.

#### Scenario: Workflow level permissions are restrictive

- **WHEN** the CI workflow starts
- **THEN** the top-level permissions are `contents: read` only

#### Scenario: Release-please job has write permissions

- **WHEN** the release-please job runs
- **THEN** it has `contents: write` and `pull-requests: write` permissions

#### Scenario: Publish job has OIDC permissions

- **WHEN** the publish job runs
- **THEN** it has `contents: read` and `id-token: write` permissions

### Requirement: pi-holo-mem Python tests run in CI

The check job SHALL include a step that runs pi-holo-mem's Python tests so that the Python bridge is validated alongside TypeScript code.

#### Scenario: Check job executes Python bridge tests

- **WHEN** the check job runs on a PR or push to main
- **THEN** pi-holo-mem's Python tests execute alongside the TypeScript tests
