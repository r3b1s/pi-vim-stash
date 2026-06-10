## ADDED Requirements

### Requirement: Dynamic publish script derives package list

The publish script SHALL read package paths from `release-please-config.json` and package names from each `package.json`. The script SHALL NOT use a hardcoded package list.

#### Scenario: New package added to config is automatically included

- **WHEN** a new package is added to `release-please-config.json`
- **THEN** the publish script automatically includes it in the publish step without any modification to the script

#### Scenario: Package removed from config is automatically excluded

- **WHEN** a package is removed from `release-please-config.json`
- **THEN** the publish script automatically excludes it from the publish step without any modification to the script

### Requirement: All packages have files arrays for clean tarballs

Each `package.json` SHALL have a `files` array specifying exactly which files to include in the npm tarball.

#### Scenario: npm pack produces only specified files

- **WHEN** `npm pack` is run on any package
- **THEN** the resulting tarball contains only the files listed in the `files` array (e.g., `src`, `python`, `scripts`, `skills`, `README`, `LICENSE`, and `package.json`)

### Requirement: All packages have repository metadata

Each `package.json` SHALL have a `repository` field pointing to the GitHub repository. This metadata is required for npm provenance attestation to link published packages back to their source.

#### Scenario: Provenance attestation links package to source

- **WHEN** a package is published with `--provenance`
- **THEN** the attestation links to the correct GitHub repository via the `repository` field

### Requirement: Issue templates enforce structured reporting

Bug reports SHALL include a package dropdown, version field, description, expected behavior, and optional reproduction steps. Feature requests SHALL include a package dropdown, description, rationale, and optional implementation approach. Blank issues SHALL be disabled.

#### Scenario: Bug report template includes required fields

- **WHEN** a contributor opens a bug report
- **THEN** the template provides a package dropdown, version field, description, expected behavior, and optional reproduction steps

#### Scenario: Feature request template includes required fields

- **WHEN** a contributor opens a feature request
- **THEN** the template provides a package dropdown, description, rationale, and optional implementation approach

#### Scenario: Blank issues are disabled

- **WHEN** a contributor tries to open a blank issue
- **THEN** GitHub prevents blank issues from being created

### Requirement: Exclude-paths prevent non-code changes from triggering releases

release-please-config.json SHALL exclude `.pi/retros`, `.pi/skills`, and `openspec/` directories. Commits touching only excluded paths SHALL NOT trigger version bumps.

#### Scenario: Retro file update does not trigger release

- **WHEN** the only changes in a push are to files within `.pi/retros`
- **THEN** release-please does not create or update a version PR

#### Scenario: Source file change alongside retro file triggers release

- **WHEN** a push includes changes to both a source file and a file within `.pi/retros`
- **THEN** release-please creates or updates a version PR because non-excluded paths are present
