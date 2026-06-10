## Context

The pi-things monorepo at `/home/dev/Local/personal/pi-things` contains 4 pi extension packages (`pi-skill-creator`, `pi-vim-stash`, `pi-token-killer`, `pi-holo-mem`). During development, these packages need to be loaded by pi for testing. Currently, the only way is to either (a) include their paths in `.pi/settings.json` (which triggers on every `pi` invocation from the repo root) or (b) install them globally — both conflating stable daily-driver config with experimental development.

The pi configuration system supports `PI_CODING_AGENT_DIR` to override the agent config directory. We need a design that uses this primitive to create an isolated, opt-in development environment.

## Goals / Non-Goals

**Goals:**
- Create an opt-in development pi environment that loads local packages
- Keep global `~/.pi/agent/` configuration pristine and untouched
- Prevent any credentials, auth tokens, trust decisions, or session data from leaking into version control
- Provide a simple, generic bootstrap script that works for any pi package development setup (monorepo or single-package)
- Track only essential dev config (dev-sources.json, retros) in version control

**Non-Goals:**
- Modifying pi itself or its configuration loading behavior
- Replacing the existing gotgenes/packages development pattern
- Making `.pi/prompts/` or `.pi/skills/` available in the testing environment
- Runtime performance optimization

## Decisions

### Decision 1: `PI_CODING_AGENT_DIR` for config isolation

Use `PI_CODING_AGENT_DIR` environment variable to point pi at a generated runtime config directory (`.pi-dev/`). This replaces the global config directory (`~/.pi/agent/`) entirely for that session, preventing any pollution of the stable config.

**Rationale**: Pi's documented environment variable, no source changes needed. Surfaces the same settings resolution logic as normal startup but against a controlled directory. The variable is set inline (not exported) in the script, scoped to the pi process.

**Alternatives considered**:
- Running `pi` from repo root with `--no-*` flags: Too many flags, fragile
- Symlinking global packages into `.pi/`: Doesn't isolate dev config from global

### Decision 2: `.pi/` fully gitignored, `.pi-dev/` partially tracked

`.pi/` is entirely gitignored via `**/.pi/**` — no allow-lists. Everything under `.pi/` is treated as a build artifact. Existing tracked files (`prompts/`, `skills/`, `retros/`, `settings.json`) are removed from tracking via `git rm --cached`.

`.pi-dev/` is NOT gitignored. Instead, specific generated/sensitive subpaths within it are gitignored:
- `sessions/`, `settings.json`, `npm/`, `git/`, `trust.json`, `models.json`
- Symlinked infrastructure directories (`agents/`, `extensions/`, `themes/`, `system-prompts/`, `skills/`, `prompts/`)

Tracked within `.pi-dev/`: `dev-sources.json`, `retros/`

**Rationale**: Separates "what's generated for testing" from "what's part of the project." Only the bare minimum dev config is tracked. Sensitive/generated artifacts are automatically excluded.

### Decision 3: Declarative `.pi-dev/dev-sources.json`

Separate the dev package list from `settings.json` into its own tracked file inside `.pi-dev/`. The file is a plain JSON array of pi package source strings (relative paths, npm refs, or git refs). The script resolves `.pi-dev/dev-sources.json` relative to the current working directory — enabling per-package dev sessions from within e.g. `packages/pi-foo/`.

**If `.pi-dev/dev-sources.json` does not exist** in the current working directory, the script SHALL prompt the user (interactive mode) asking whether to scaffold `.pi-dev/` with a default `dev-sources.json` (empty array `[]`), symlink global infrastructure, and launch. The prompt SHALL explain that the test environment generates `settings.json` dynamically from `dev-sources.json` so the global pi config stays clean. If the user declines, the script SHALL exit with a clear error message. In non-interactive mode (no TTY), the script SHALL exit with instructions.

**Rationale**:
- Decouples "what packages to load in dev mode" from project settings
- Single source of truth for dev packages
- `.pi-dev/` is per-directory — each package manages its own dev sources
- Scaffolding makes first-time setup frictionless without assuming defaults

### Decision 4: Symlinks as the primary infrastructure mechanism

The `scripts/pi-dev` script creates symlinks from `.pi-dev/` to `~/.pi/agent/` for shared infrastructure directories. This is the primary mechanism — the merged `settings.json` does NOT reference `~/.pi/agent/...` paths.

Directories symlinked:
- `agents/`, `extensions/`, `npm/`, `git/`, `themes/`, `system-prompts/`, `skills/`, `prompts/`

Files symlinked:
- `models.json`, `trust.json`

**Rationale**: Symlinks keep the dev environment in sync with global config automatically. Settings.json stays clean — pi discovers resources from the actual directory structure. Symlinks are safe because `.pi-dev/` generated paths are gitignored, so target content never enters the repo.

### Decision 5: Graceful missing-directory handling

The script checks existence of each global directory before symlinking:
- **Essential dirs** (`agents/`, `extensions/`): Create empty target directories if missing (with notification)
- **Optional dirs** (`npm/`, `git/`, `themes/`, `system-prompts/`, `skills/`, `prompts/`): Skip symlinking with a warning if missing

### Decision 6: Secret safety via gitignore, not isolation

Rather than excluding secrets from `.pi-dev/` entirely (which would break pi), secrets are symlinked into `.pi-dev/` but gitignored:
- `models.json` — symlinked, gitignored (`.pi-dev/models.json`)
- `trust.json` — symlinked, gitignored (`.pi-dev/trust.json`)
- `auth.json` — NOT symlinked. Pi prompts at startup or uses env vars. Keeps API keys fully out of the dev workspace.

**Rationale**: `models.json` and `trust.json` are necessary for pi to function but contain low-sensitivity data. `.pi-dev/` is gitignored for these paths, so no leakage risk. `auth.json` stays in `~/.pi/agent/` only.

### Decision 7: Cleanup mechanism

`scripts/pi-dev --clean` clears generated session state without removing `dev-sources.json`:
1. Removes `.pi-dev/sessions/`
2. Removes `.pi-dev/trust.json` (symlink gets recreated on next run)
3. Prints confirmation

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| Symlinks resolve to absolute paths on the developer's machine | `.pi-dev/` generated paths are gitignored. No machine-specific paths in committed files. |
| If `~/.pi/agent/` directory structure changes, symlinks become stale | `scripts/pi-dev` regenerates symlinks on each invocation |
| Auth must be re-established for dev sessions (no auth.json) | Acceptable — pi prompts at startup or uses env vars in non-interactive mode |
| `.pi/` no longer tracked — new devs won't have `.pi/prompts/` or `.pi/skills/` | These are openspec skills; they are documented as repo-level resources. New devs can install openspec separately or recreate as needed. |
