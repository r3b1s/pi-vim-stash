## Why

Loading pi extensions under active development currently requires either (a) running `pi` from within the repo to pick up `.pi/settings.json` or (b) installing packages globally. Both pollute the stable daily-driver config. We need a deliberate, opt-in development environment that keeps the global pi configuration pristine and isolates dev sessions from production use.

## What Changes

- **New `.pi-dev/dev-sources.json`**: Declares which local packages to load in dev mode — tracked in version control
- **New `scripts/pi-dev`**: Bootstrap script that generates an isolated runtime config (`.pi-dev/`) by merging global settings with dev sources, symlinking shared infrastructure directories, and launching pi under `PI_CODING_AGENT_DIR`
- **`.pi/` fully gitignored** (`**/.pi/**`): Entire `.pi/` directory is treated as a build artifact. Existing tracked files are removed from tracking via `git rm --cached`. The directory may still exist on disk for local `pi` to discover project-local settings, but nothing new is tracked.
- **Retros migrated to `.pi-dev/retros/`**: Existing retrospectives move to `.pi-dev/retros/` and remain tracked there.
- **`.pi-dev/` partially gitignored**: The directory is tracked, but generated/sensitive subpaths (`sessions/`, `settings.json`, `npm/`, `git/`, `trust.json`, `models.json`, and symlinked infra directories) are gitignored.
- **`scripts/pi-dev --clean`**: New flag to clean generated session and trust state without removing dev-sources.json.

## Capabilities

### New Capabilities
- `pi-dev-environment`: Bootstrap script (`scripts/pi-dev`) that creates an isolated pi config workspace from global config + dev package sources, with proper symlinks and secret isolation
- `dev-sources`: Declarative config file (`.pi-dev/dev-sources.json`) listing package sources to load in development mode — tracked in `.pi-dev/`

### Modified Capabilities

None. This is a new developer tooling capability.

## Impact

- **Repo files**: `.pi-dev/dev-sources.json` (new, tracked), `.pi-dev/retros/` (migrated from `.pi/retros/`), `.gitignore` (updated), `scripts/pi-dev` (new)
- **Removed from tracking**: All files under `.pi/` (prompts, skills, retros, settings.json) via `git rm --cached`
- **No API or dependency changes**: Pure developer experience — no runtime code changes
- **Breaking change**: The `.pi/` directory is no longer tracked. Existing files remain on disk for local use but are removed from git. Running `pi` from the repo root still discovers `.pi/settings.json` and `.pi/skills/` locally, but new developers must use `scripts/pi-dev` for the development environment.
