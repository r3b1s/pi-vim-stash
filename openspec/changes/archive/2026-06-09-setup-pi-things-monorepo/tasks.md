## 1. Root scaffolding

- [x] 1.1 Create root `package.json` with `"private": true`, `"packageManager": "pnpm@9.x.x"`, workspace scripts (`check`, `lint`, `test`, `format`), and dev dependencies via catalog references
- [x] 1.2 Create `pnpm-workspace.yaml` with `packages: ["packages/*"]`, `linkWorkspacePackages: false`, and `catalog:` section for shared dependency versions (typescript, vitest, @types/node, @biomejs/biome, eslint, typescript-eslint)
- [x] 1.3 Create `tsconfig.base.json` with `target: "ES2024"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `strict: true`, `noEmit: true`
- [x] 1.4 Create `biome.json` with formatting (space indent, double quotes) and recommended lint rules, ignoring `dist/`, `node_modules/`, `.pi/`, `coverage/`
- [x] 1.5 Create `eslint.config.js` with `typescript-eslint` `recommendedTypeCheckedOnly` and `stylisticTypeCheckedOnly`, scoped to `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts`, with ignores for `dist/`, `node_modules/`, `.pi/`, `.fallow/`
- [x] 1.6 Create `mise.toml` with `[tools]` (node 22, pnpm 9), `[env]` (_.path for scripts/bin shims), and `[tasks]` (install, check, lint, test, ci, format, clean) with dependency graph (ci depends on check + lint + test in parallel)
- [x] 1.7 Create `.gitignore` adopting the gotgenes template (dist, node_modules, .pi/npm, coverage, .fallow, OS files, editor files, *.tgz, .env, pnpm store, Vite temp)
- [x] 1.8 Create `scripts/bin/npm` shim that blocks npm and redirects to pnpm (with pass-throughs for Pi internals: `npm root`, `.pi/npm/` paths, global installs)
- [x] 1.9 Create `scripts/bin/npx` shim that blocks npx and redirects to `pnpm exec`

## 2. Copy and configure pi-skill-creator

- [x] 2.1 Copy `~/Local/personal/pi-skill-creator/` contents into `packages/pi-skill-creator/` (preserving src/, skills/, third_party/, openspec/, tests/, tsconfig.json, vitest.config.ts, README.md, CHANGELOG.md, LICENSE, THIRD_PARTY_NOTICES.md)
- [x] 2.2 Rename `tests/` to `test/` in `packages/pi-skill-creator/`
- [x] 2.3 Update `packages/pi-skill-creator/package.json`: set name to `@r3b1s/pi-skill-creator`, add `publishConfig: { "access": "public" }`, update devDependencies to use `catalog:` references, add missing scripts (`lint`, `check`), add `#src/*` and `#test/*` imports
- [x] 2.4 Update `packages/pi-skill-creator/tsconfig.json` to extend `../../tsconfig.base.json` with `paths` for `#src/*` and `#test/*`, include `src` and `test`
- [x] 2.5 Update `packages/pi-skill-creator/vitest.config.ts` with `#src` and `#test` path aliases, update test include glob to `test/**/*.test.ts`
- [x] 2.6 Update test file imports if `tests/` → `test/` rename affects any paths
- [x] 2.7 Create `packages/pi-skill-creator/AGENTS.md` redirect stub

## 3. Copy and configure pi-vim-stash

- [x] 3.1 Copy `~/Local/personal/pi-vim-stash/` contents into `packages/pi-vim-stash/`
- [x] 3.2 Move flat `.ts` files (`index.ts`, `stash.ts`, `motions.ts`, `text-objects.ts`, `word-boundary-cache.ts`, `settings.ts`, `clipboard-policy.ts`, `types.ts`) into `packages/pi-vim-stash/src/`
- [x] 3.3 Move `test/` contents into `packages/pi-vim-stash/test/`
- [x] 3.4 Update `packages/pi-vim-stash/package.json`: set name to `@r3b1s/pi-vim-stash`, set `pi.extensions` to `["./src/index.ts"]`, add `publishConfig: { "access": "public" }`, update devDependencies to use `catalog:` references, replace node:test scripts with Vitest, add `check` script
- [x] 3.5 Create `packages/pi-vim-stash/tsconfig.json` extending `../../tsconfig.base.json` with `paths` for `#src/*` and `#test/*`, include `src` and `test`
- [x] 3.6 Create `packages/pi-vim-stash/vitest.config.ts` with `#src` and `#test` path aliases
- [x] 3.7 Migrate test files from `node:test` to Vitest (replace `import { describe, it } from 'node:test'` with `import { describe, it, expect } from 'vitest'`, replace `assert.*` with `expect()`, replace `t.mock` with `vi.mock`)
- [x] 3.8 Remove `lefthook.yml` and `eslint.config.mjs` (root configs replace these)
- [x] 3.9 Remove root-level `biome.json` if present (root config replaces it)
- [x] 3.10 Create `packages/pi-vim-stash/AGENTS.md` redirect stub

## 4. Copy and configure rtk-pi

- [x] 4.1 Copy `~/Local/personal/rtk-pi/` contents into `packages/rtk-pi/`
- [x] 4.2 Create `packages/rtk-pi/src/` directory and move `index.ts` and `rewrite.ts` into it
- [x] 4.3 Update `packages/rtk-pi/package.json`: set name to `@r3b1s/rtk-pi`, set `pi.extensions` to `["./src/index.ts"]`, add `publishConfig: { "access": "public" }`, add `type: "module"`, add `engines: { "node": ">=22" }`, add devDependencies with `catalog:` references (typescript, @types/node)
- [x] 4.4 Create `packages/rtk-pi/tsconfig.json` extending `../../tsconfig.base.json` with `paths` for `#src/*`, include `src`
- [x] 4.5 Create `packages/rtk-pi/AGENTS.md` redirect stub

## 5. Pi development environment

- [x] 5.1 Create `.pi/settings.json` with local path entries for all three packages and npm entries with `"extensions": [], "skills": []` to disable npm versions
- [x] 5.2 Create root `AGENTS.md` with Level 0 scope: monorepo structure (pnpm workspace, packages/* layout), how to run commands (pnpm -r / mise run), code style (TypeScript ES2024, Biome + ESLint split, conflict workarounds), and commit conventions (Conventional Commits)

## 6. Documentation

- [x] 6.1 Create `toolchain-research.md` at repo root documenting deferred tools: fallow (dead code analysis), prek (git hooks), rumdl (markdown lint), release-please (release automation). Include what each does, why deferred, and when to adopt.
- [x] 6.2 Update `README.md` with monorepo overview, package list, development setup (mise install, pnpm install), and available commands

## 7. Verification

- [x] 7.1 Run `pnpm install` and verify all workspace packages resolve
- [x] 7.2 Run `pnpm -r run check` and verify TypeScript passes for all packages
- [x] 7.3 Run `pnpm run lint` and verify Biome + ESLint pass across all packages
- [x] 7.4 Run `pnpm -r run test` and verify Vitest runs for pi-skill-creator and pi-vim-stash
- [x] 7.5 Run `mise run ci` and verify parallel execution of check + lint + test
- [x] 7.6 Verify no git commits have been generated (`git log` shows no new commits)
- [x] 7.7 Verify original repos at `~/Local/personal/` are unchanged
