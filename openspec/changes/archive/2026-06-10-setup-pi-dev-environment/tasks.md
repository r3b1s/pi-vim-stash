## 1. Gitignore and Git Tracking

- [x] 1.1 Add `**/.pi/**` to `.gitignore` — fully ignore all `.pi/` directories at any depth
- [x] 1.2 Add `.gitignore` entries for generated `.pi-dev/` subpaths: `sessions/`, `settings.json`, `trust.json`, `models.json`
- [x] 1.3 Add `.gitignore` entries for symlinked `.pi-dev/` infrastructure directories (all optional, symlinked from global): `agents`, `extensions`, `themes`, `system-prompts`, `skills`, `prompts`, `npm`, `git`
- [x] 1.4 Move `.pi/retros/` to `.pi-dev/retros/` — preserve git history, retros are tracked in new location
- [x] 1.5 Run `git rm --cached` for all tracked files under `.pi/` (prompts, skills, retros, settings.json)
- [x] 1.6 Remove existing `.pi/npm/` entry from `.gitignore` (covered by `**/.pi/**`)

## 2. Declare Dev Sources

- [x] 2.1 Create `.pi-dev/dev-sources.json` with local monorepo package paths (`./packages/pi-skill-creator`, `./packages/pi-vim-stash`, `./packages/pi-token-killer`, `./packages/pi-holo-mem`)
- [x] 2.2 Stage `.pi-dev/dev-sources.json` for tracking

## 3. Bootstrap Script

- [x] 3.1 Create `scripts/pi-dev` — detect `.pi-dev/dev-sources.json` in cwd; if missing, prompt to scaffold (interactive) or exit with instructions (non-interactive); scaffold creates `.pi-dev/`, default empty `dev-sources.json`, symlinks global infrastructure
- [x] 3.2 Implement infrastructure directory symlinks from `.pi-dev/` → `~/.pi/agent/`: agents, extensions, npm, git, themes, system-prompts, skills, prompts (shared between scaffold and non-scaffold paths)
- [x] 3.3 Implement `models.json` and `trust.json` symlinks into `.pi-dev/`
- [x] 3.4 Implement graceful missing-dir handling: create empty dirs for essential (agents, extensions), skip with warning for optional (npm, git, themes, system-prompts, skills, prompts)
- [x] 3.5 Implement `--clean` flag: removes `.pi-dev/sessions/` and `.pi-dev/trust.json`, preserves `.pi-dev/dev-sources.json`
- [x] 3.6 Implement CLI argument forwarding — append `"$@"` to pi invocation
- [x] 3.7 Make `scripts/pi-dev` executable (`chmod +x`)

## 4. Verify

- [x] 4.1 Run `scripts/pi-dev --version` to confirm pi launches with isolated config
- [x] 4.2 Verify `.pi-dev/` contents: settings.json exists with merged packages, symlinks point to `~/.pi/agent/`
- [x] 4.3 Verify `git status` shows no `.pi/` artifacts as untracked
- [x] 4.4 Verify `git status` shows `.pi-dev/dev-sources.json` and `.pi-dev/retros/` as tracked
- [x] 4.5 Run `scripts/pi-dev --clean` and verify sessions/ and trust.json are removed, dev-sources.json preserved
- [x] 4.6 Run `scripts/pi-dev -p "hello"` from a package subdirectory to confirm cwd-based resolution
