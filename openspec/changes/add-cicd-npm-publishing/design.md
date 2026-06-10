## Context

pi-things is a pnpm monorepo with 4 packages. It already has local quality gates (tsc --noEmit, biome + eslint, vitest) wired through root package.json scripts and mise.toml tasks. No CI/CD exists yet. The reference implementation is at ~/Local/docs/pi-packages which uses a 3-job pipeline (check → release-please → publish) with similar architecture.

## Goals / Non-Goals

**Goals:**

- Automated CI on PRs and main pushes (typecheck, lint, test)
- Automated version bumps via release-please reading conventional commits
- Automated npm publishing with OIDC provenance attestation
- Clean npm tarballs (files arrays in all packages)
- Issue templates for structured bug reports and feature requests

**Non-Goals:**

- Fallow dead-code analysis (deferred)
- Public type verification (deferred)
- Python tests in CI (handled separately via mise, not part of the main CI pipeline initially)
- Build step / compiled output (packages ship raw TypeScript)
- PyPI publishing for pi-holo-mem Python component

## Decisions

1. **Single workflow file (ci.yml) vs multiple**: Single file with 3 linear jobs (check → release-please → publish). The pipeline is linear and all jobs share the same trigger events. Splitting adds fragility with no benefit.

2. **release-please over changesets or tag-driven**: Conventional commits are already in use. release-please reads them directly — no extra "add changeset" step. The developer workflow is: merge feat/fix commits → release-please opens a "Version Packages" PR → merge that PR → publish happens automatically. This matches the gotgenes/pi-packages reference pattern.

3. **Dynamic publish script over hardcoded list**: Derives package list from release-please-config.json keys + reads each package.json name at runtime. Eliminates the "forgot to update the script" failure mode when adding new packages. Tradeoff: one more file to read at runtime, but negligible cost for 4 packages.

4. **OIDC trusted publishing over NPM_TOKEN**: Eliminates long-lived secrets. Provenance attestation comes free. Requires public repo and npm CLI >= 11.5.1. Initial publish of each package still needs a manual token (trusted publisher config happens after package exists on npm).

5. **workflow-level permissions: contents: read**: Least-privilege default. Each job escalates only what it needs: release-please gets contents:write + pull-requests:write, publish gets id-token:write.

6. **pi-holo-mem Python tests separate from main CI**: The mise task `test-python` creates a venv and runs pytest. This is a separate step in the check job, not a separate workflow. It requires python3 on the runner (ubuntu-latest has it).

7. **Changelog sections**: feat, fix, perf, revert, docs, chore shown. style, refactor, test, build, ci hidden. Breaking changes always shown regardless of type.

8. **Exclude-paths**: .pi/retros, .pi/skills, openspec/ directories excluded from release triggering. packages/*/skills/ NOT excluded (integral to package functionality).

## Risks / Trade-offs

- [Trusted publishing requires public repo] → Provenance attestation won't work if repo is private. Mitigation: repo is already intended to be public.
- [First publish needs manual token] → Trusted publisher can only be configured after the package exists on npm. Mitigation: first publish done manually from local machine, then trusted publisher configured before second CI publish.
- [Conventional commits are now load-bearing] → Non-conventional commits won't trigger proper version bumps. Mitigation: already using conventional commits consistently.
- [Dynamic publish script reads files at runtime] → If release-please-config.json or a package.json is malformed, the script fails. Mitigation: set -euo pipefail, jq validates JSON structure.
- [No fallow gates] → Dead code can accumulate. Mitigation: deferred to a future change, not blocked.
