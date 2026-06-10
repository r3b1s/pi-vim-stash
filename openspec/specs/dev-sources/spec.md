## ADDED Requirements

### Requirement: dev-sources.json file

The `.pi-dev/dev-sources.json` file SHALL declare the list of pi package sources to load during development.

#### Scenario: file exists at expected location
- **WHEN** the repository is set up for development
- **THEN** `.pi-dev/dev-sources.json` SHALL exist at `.pi-dev/dev-sources.json` relative to the repo root
- **AND** it SHALL be tracked in version control

### Requirement: JSON array of source strings

The file SHALL be a JSON array of strings, each string being a valid pi package source as accepted by the `packages` key in `settings.json`.

#### Scenario: valid JSON array
- **WHEN** `.pi-dev/dev-sources.json` is parsed
- **THEN** it SHALL be valid JSON and evaluate to an array

#### Scenario: source format
- **WHEN** an entry is a relative path (starting with `./` or `../`)
- **THEN** it SHALL be resolved relative to the repo root (the directory containing `.pi-dev/`)

### Requirement: consumed by scripts/pi-dev

The `scripts/pi-dev` script SHALL read `.pi-dev/dev-sources.json` to determine which packages to inject into the dev runtime config's `packages` array.

#### Scenario: packages injected into merged config
- **WHEN** `scripts/pi-dev` processes `.pi-dev/dev-sources.json`
- **THEN** each source string SHALL be included in the `packages` array of `.pi-dev/settings.json`, after all global packages

#### Scenario: cwd-relative resolution
- **WHEN** `scripts/pi-dev` is run from any subdirectory (e.g., `packages/pi-foo/`)
- **THEN** the script SHALL resolve `.pi-dev/dev-sources.json` relative to the current working directory

#### Scenario: missing file prompts scaffold
- **WHEN** `scripts/pi-dev` is run from a directory that has no `.pi-dev/dev-sources.json`
- **AND** stdin is a TTY (interactive mode)
- **THEN** the script SHALL prompt the user to scaffold `.pi-dev/` with a default `dev-sources.json`
- **AND** the prompt SHALL explain that `settings.json` is generated dynamically from `dev-sources.json` to keep global config clean
- **AND** if user accepts, the script SHALL create `.pi-dev/`, write `[]` as default `dev-sources.json`, symlink global infrastructure, and proceed to launch pi
- **AND** if user declines, the script SHALL exit with instructions to create `.pi-dev/dev-sources.json` manually

#### Scenario: missing file in non-interactive mode
- **WHEN** `scripts/pi-dev` is run from a directory that has no `.pi-dev/dev-sources.json`
- **AND** stdin is NOT a TTY (non-interactive)
- **THEN** the script SHALL exit with a clear error message explaining how to create `.pi-dev/dev-sources.json`
