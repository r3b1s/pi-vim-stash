## 1. Package Metadata Updates

- [x] 1.1 Add `repository` field to `@r3b1s/pi-holo-mem` package.json (`packages/pi-holo-mem/package.json`) with type "git", url "https://github.com/r3b1s/pi-things.git", and directory "packages/pi-holo-mem"
- [x] 1.2 Add `files` array to `@r3b1s/pi-holo-mem` package.json with entries: `src`, `python`, `scripts`, `README.md`, `LICENSE`
- [x] 1.3 Add `repository` field to `@r3b1s/pi-skill-creator` package.json (`packages/pi-skill-creator/package.json`) — same structure, directory "packages/pi-skill-creator"
- [x] 1.4 Add `LICENSE` entry to existing `files` array in `@r3b1s/pi-skill-creator` package.json (it already has src, skills, third_party, README.md, THIRD_PARTY_NOTICES.md, package.json — just needs LICENSE)
- [x] 1.5 Add `repository` field to `@r3b1s/pi-token-killer` package.json (`packages/pi-token-killer/package.json`) — same structure, directory "packages/pi-token-killer"
- [x] 1.6 Add `files` array to `@r3b1s/pi-token-killer` package.json with entries: `src`, `README.md`, `LICENSE`
- [x] 1.7 Add `repository` field to `@r3b1s/pi-vim-stash` package.json (`packages/pi-vim-stash/package.json`) — same structure, directory "packages/pi-vim-stash"
- [x] 1.8 Add `files` array to `@r3b1s/pi-vim-stash` package.json with entries: `src`, `README.md`, `LICENSE`

## 2. Release-Please Configuration

- [x] 2.1 Create `release-please-config.json` at repo root with package entries for all 4 packages, specifying `"release-type": "node"` for each, changelog sections (Features, Bug Fixes, Performance Improvements, Breaking Changes), and exclude-paths (openspec/, .pi/, AGENTS.md, KNOWN_ISSUES.md)
- [x] 2.2 Create `.release-please-manifest.json` at repo root with current versions: `"packages/pi-holo-mem": "0.1.0"`, `"packages/pi-skill-creator": "0.1.0"`, `"packages/pi-token-killer": "0.2.0"`, `"packages/pi-vim-stash": "0.1.0"`

## 3. Publish Script

- [x] 3.1 Create `scripts/publish.sh` — a dynamic publish script that discovers all non-private workspace packages (via `pnpm list --json --depth -1` or parsing pnpm-workspace.yaml + package.json files), filters out packages with `"private": true`, runs `npm publish` with `--provenance` and `--access public` for each package

## 4. GitHub Actions Workflow

- [x] 4.1 Create `.github/workflows/ci.yml` with trigger on `pull_request` and `push` to `main` branch
- [x] 4.2 Add quality-gate job that runs on both triggers: install deps, then run typecheck (`tsc --noEmit` via `pnpm -r run check`), biome lint (`biome check .`), eslint (`eslint packages/`), and tests (`pnpm -r run test`)
- [x] 4.3 Add release-please job (depends on quality-gate, runs only on push to main) using `googleapis/release-please-action@v4` with `token: ${{ secrets.GITHUB_TOKEN }}`
- [x] 4.4 Add publish job (depends on release-please, runs only on push to main, conditional on release-please creating a release): checkout, setup Node 22, install pnpm, `pnpm install`, then run `scripts/publish.sh` with OIDC trusted publishing — no NPM_TOKEN secret needed. Set `NPM_CONFIG_PROVENANCE: true` in the environment, and grant OIDC permissions (`id-token: write`, `contents: read`). The workflow authenticates to npm via GitHub's OIDC token (provenance signing), not a stored secret. Note: this relies on each package having its trusted publisher configured on npmjs.com (see Group 5 tasks).
- [x] 4.5 Add pi-holo-mem Python tests step in the quality-gate job: install Python 3.11, run `cd packages/pi-holo-mem && python3 -m venv /tmp/pi-holo-mem-test-venv && /tmp/pi-holo-mem-test-venv/bin/pip install --quiet -r python/requirements.txt pytest && /tmp/pi-holo-mem-test-venv/bin/pytest python/tests/ -v`
- [x] 4.6 Set least-privilege permissions at workflow level: `contents: write` (for release-please PRs), `pull-requests: write`, and job-level overrides where needed (publish job gets `id-token: write` + `contents: read`). No `NPM_TOKEN` secret is stored in GitHub — all npm authentication uses OIDC trusted publishing.

## 5. Manual First Publish and Trusted Publishing Setup

> **Why manual first publish?** npm's OIDC trusted publishing requires at least one version of a package to exist on the registry before you can configure the trusted publisher link. The first publish must be done from the developer's machine using a personal npm token (classic or automation). After that, CI uses OIDC and no secrets are needed.

- [ ] 5.1 Publish `@r3b1s/pi-token-killer` manually for the first time: set a personal npm token in `~/.npmrc` (`//registry.npmjs.org/:_authToken=TOKEN`) or pass it via env var (`NODE_AUTH_TOKEN=<token> pnpm --filter @r3b1s/pi-token-killer publish --access public`), then verify the package appears on https://www.npmjs.com/package/@r3b1s/pi-token-killer
- [ ] 5.2 Publish `@r3b1s/pi-holo-mem` manually for the first time: same auth method, `NODE_AUTH_TOKEN=<token> pnpm --filter @r3b1s/pi-holo-mem publish --access public`, verify on npmjs.com
- [ ] 5.3 Publish `@r3b1s/pi-skill-creator` manually for the first time: `NODE_AUTH_TOKEN=<token> pnpm --filter @r3b1s/pi-skill-creator publish --access public`, verify on npmjs.com
- [ ] 5.4 Publish `@r3b1s/pi-vim-stash` manually for the first time: `NODE_AUTH_TOKEN=<token> pnpm --filter @r3b1s/pi-vim-stash publish --access public`, verify on npmjs.com
- [ ] 5.5 For each package on npmjs.com, go to package Settings → Publishing access → Configure trusted publishing: set Repository to `r3b1s/pi-things`, Workflow to `ci.yml`, and Environment to `Release` (or the environment name used in the workflow). This links the GitHub Actions OIDC identity to the npm package.
- [ ] 5.6 Verify trusted publishing works: create a test tag or release for one package and confirm the CI workflow can publish without any NPM_TOKEN secret

> **pnpm auth reference:** pnpm uses the same `.npmrc` convention as npm. Token can be set in `~/.npmrc` as `//registry.npmjs.org/:_authToken=TOKEN`, passed as `NODE_AUTH_TOKEN` environment variable (which pnpm reads automatically), or via `npm login` (pnpm respects the resulting `.npmrc`).

## 6. GitHub Issue Templates

- [x] 6.1 Create `.github/ISSUE_TEMPLATE/bug_report.yml` (YAML form format) with fields: title, description, steps to reproduce, expected behavior, actual behavior, environment (OS, Node version, pi version), package affected (dropdown of 4 packages)
- [x] 6.2 Create `.github/ISSUE_TEMPLATE/feature_request.yml` with fields: title, problem description, proposed solution, alternatives considered, package affected (dropdown)
- [x] 6.3 Create `.github/ISSUE_TEMPLATE/config.yml` with `blank_issues_enabled: false` and contact links for discussions or other channels

## 7. Verification and Testing

- [x] 7.1 Run `pnpm install` and verify all package.json changes parse correctly (no JSON syntax errors)
- [x] 7.2 Run `pnpm -r run check` (typecheck) to confirm metadata changes don't break compilation
- [x] 7.3 Run `biome check .` to confirm biome passes on new/modified files
- [x] 7.4 Run `pnpm -r run test` to confirm existing tests still pass
- [x] 7.5 Run `bash scripts/publish.sh --dry-run` (or equivalent dry-run logic) to verify the publish script discovers all 4 packages and would publish them correctly
- [x] 7.6 Validate `release-please-config.json` and `.release-please-manifest.json` structure (manual review or `release-please` CLI validation if available)
- [x] 7.7 Validate GitHub Actions workflow YAML syntax (e.g., with `actionlint` if available, or manual review)
- [x] 7.8 Verify no `NPM_TOKEN` secret references remain in the workflow — all npm auth should be via OIDC
