# Delta Spec: monorepo-structure

## Modified Requirements

### Requirement: mise manages tool versions

`mise.toml` at the repo root SHALL declare `node = "lts"` and `pnpm = "11"` under `[tools]`. Running `mise install` SHALL provision these tools. The mise-managed pnpm 11 SHALL take precedence over any Node-bundled pnpm on PATH.

The root `package.json` SHALL have a `"packageManager"` field matching the actual mise-installed pnpm version (e.g., `"pnpm@11.5.2"`) to ensure corepack consistency.

#### Scenario: mise install provisions environment
- **WHEN** `mise install` is run from the repo root
- **THEN** Node.js LTS (currently 22.x) and pnpm 11 are installed and available on PATH

#### Scenario: pnpm version matches packageManager field
- **WHEN** `pnpm --version` is run from the repo root
- **THEN** it returns a pnpm 11.x version matching the `packageManager` field in root `package.json`

#### Scenario: mise tasks provide dev commands
- **WHEN** `mise run ci` is executed
- **THEN** typecheck, lint, and test tasks run in parallel

## Rationale

The spec originally declared `node = "22"` and `pnpm = "9"`. The `mise.toml` was later updated to `node = "lts"` and `pnpm = "11"` but the spec was not updated to match. Additionally, the mise-managed pnpm 11 was not taking precedence over the Node LTS-bundled pnpm 9 on PATH, causing a version mismatch between what mise declared and what actually ran.
