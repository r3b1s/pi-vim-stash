## ADDED Requirements

### Requirement: scripts/pi-dev bootstrap

The `scripts/pi-dev` script SHALL create an isolated pi runtime configuration workspace at `.pi-dev/` and launch pi against it.

#### Scenario: script exists and is executable
- **WHEN** the repository is cloned
- **THEN** `scripts/pi-dev` SHALL exist and be executable (chmod +x)

#### Scenario: generates .pi-dev/ directory
- **WHEN** `scripts/pi-dev` is invoked from any working directory within the repo
- **THEN** a `.pi-dev/` directory SHALL be created (if not already existing) or refreshed, containing at minimum a `settings.json` file, a `sessions/` directory, and symlinks to global infrastructure

#### Scenario: merges global settings with dev sources
- **WHEN** `scripts/pi-dev` runs
- **THEN** the generated `.pi-dev/settings.json` SHALL contain all keys from `~/.pi/agent/settings.json`, with the `packages` array extended by the sources listed in `.pi-dev/dev-sources.json`

#### Scenario: launches pi with isolated config
- **WHEN** `scripts/pi-dev` completes generation
- **THEN** it SHALL execute `pi` with `PI_CODING_AGENT_DIR` set to the absolute path of `.pi-dev/`, forwarding all CLI arguments

#### Scenario: no modification to global config
- **WHEN** `scripts/pi-dev` runs
- **THEN** files under `~/.pi/agent/` SHALL NOT be modified, created, or deleted

#### Scenario: cwd-based dev-sources resolution
- **WHEN** user runs `scripts/pi-dev` from `packages/pi-foo/`
- **THEN** the script SHALL resolve `.pi-dev/dev-sources.json` relative to the current working directory

### Requirement: infrastructure directory symlinks

The `scripts/pi-dev` script SHALL create symlinks from `.pi-dev/` to global infrastructure directories for shared resources. Symlinks are the primary mechanism — the merged `settings.json` does not contain `~/.pi/agent/...` paths.

#### Scenario: agents directory symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/agents` SHALL be a symlink to `~/.pi/agent/agents/`

#### Scenario: extensions directory symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/extensions` SHALL be a symlink to `~/.pi/agent/extensions/`

#### Scenario: npm cache symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/npm` SHALL be a symlink to `~/.pi/agent/npm/` if it exists

#### Scenario: git cache symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/git` SHALL be a symlink to `~/.pi/agent/git/` if it exists

#### Scenario: themes directory symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/themes` SHALL be a symlink to `~/.pi/agent/themes/` if it exists

#### Scenario: system-prompts directory symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/system-prompts` SHALL be a symlink to `~/.pi/agent/system-prompts/` if it exists

#### Scenario: global skills directory symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/skills` SHALL be a symlink to `~/.pi/agent/skills/` if it exists

#### Scenario: global prompts directory symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/prompts` SHALL be a symlink to `~/.pi/agent/prompts/` if it exists

### Requirement: models.json and trust.json handling

The script SHALL symlink `models.json` and `trust.json` into `.pi-dev/` for pi functionality, while keeping them gitignored.

#### Scenario: models.json symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/models.json` SHALL be a symlink to `~/.pi/agent/models.json`

#### Scenario: trust.json symlinked
- **WHEN** `scripts/pi-dev` runs
- **THEN** `.pi-dev/trust.json` SHALL be a symlink to `~/.pi/agent/trust.json`

#### Scenario: models.json gitignored
- **WHEN** `.gitignore` is evaluated
- **THEN** `.pi-dev/models.json` SHALL be ignored by git

#### Scenario: trust.json gitignored
- **WHEN** `.gitignore` is evaluated
- **THEN** `.pi-dev/trust.json` SHALL be ignored by git

### Requirement: auth.json exclusion

The script SHALL NOT copy or symlink `auth.json` into `.pi-dev/`.

#### Scenario: auth.json excluded
- **WHEN** `scripts/pi-dev` runs
- **THEN** `~/.pi/agent/auth.json` SHALL NOT be referenced, copied, or symlinked into `.pi-dev/`
- **AND** pi SHALL still start, using either environment variable credentials or interactive auth prompt

### Requirement: graceful missing-directory handling

The script SHALL handle missing global directories gracefully.

#### Scenario: essential dir missing creates empty
- **WHEN** `~/.pi/agent/agents/` does not exist
- **THEN** the script SHALL create an empty `.pi-dev/agents/` directory and notify the user

#### Scenario: optional dir missing skips with warning
- **WHEN** `~/.pi/agent/npm/` does not exist
- **THEN** the script SHALL skip the npm symlink and print a warning
- **AND** pi SHALL continue to start without error

### Requirement: CLI argument forwarding

The script SHALL forward all CLI arguments to the underlying `pi` invocation.

#### Scenario: arguments forwarded
- **WHEN** user runs `scripts/pi-dev -p "hello"`
- **THEN** pi SHALL execute with `-p "hello"` appended to its arguments

### Requirement: --clean flag

The script SHALL support a `--clean` flag to clear generated session state.

#### Scenario: --clean removes sessions
- **WHEN** user runs `scripts/pi-dev --clean`
- **THEN** `.pi-dev/sessions/` SHALL be removed
- **AND** `.pi-dev/trust.json` SHALL be removed (if present)
- **AND** `.pi-dev/dev-sources.json` SHALL NOT be removed
- **AND** a confirmation message SHALL be printed
