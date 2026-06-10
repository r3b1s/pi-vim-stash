# Reflections: pi-things Monorepo Setup

## Lessons

Each lesson is a durable pattern or tool insight encountered during this session.

---

### 1. Biome 2.4.8 has a different config shape than 1.x

**What happened:** When upgrading from Biome 1.x (or an earlier 2.x) to 2.4.8, several keys changed location:
- `files.ignore` → removed; use `files.includes` with `!` prefix to exclude
- `formatter.quoteStyle` → moved under `javascript.formatter.quoteStyle`
- Folder ignore patterns no longer need trailing `/**` (since Biome 2.2.0, bare directory names work)

**Why it matters:** Biome is still evolving rapidly. Config schemas from even a few months ago may be invalid. The `biome migrate` command exists but doesn't always catch everything. The JSON schema URL (`https://biomejs.dev/schemas/2.4.8/schema.json`) is the authoritative reference.

**What to do about it:** Pin the schema URL in `"$schema"`. When biome check fails with a cryptic validation error, compare your config against the schema for the pinned version. The `files.includes` pattern (`"**"` + `"!excluded-dir"`) is the canonical way to manage include/exclude in 2.x.

---

### 2. pnpm auto-installs peer dependencies aggressively

**What happened:** Packages declared peer dependencies on `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, etc. pnpm's default behavior is to auto-install missing peer dependencies from the registry. Since these packages aren't published and aren't in the workspace, `pnpm install` produced "module not found" errors during TypeScript type-checking.

**Why it matters:** In a monorepo where packages have unpublished peer dependencies (common during development before publishing), pnpm's auto-install-peers defaults can cause build failures. Unlike npm or yarn, pnpm is strict about peer resolution and will try to fetch them.

**What to do about it:** You have two options:
1. **Development approach**: Add the peer deps as `devDependencies` in each package (so they're resolvable locally), then remove them just before publishing.
2. **Strict approach**: Set `pnpm.peerDependencyRules.ignoreMissing` in the root `package.json` to suppress the error for specific packages during development.
3. Or set `linkWorkspacePackages: true` in `pnpm-workspace.yaml` if the packages are internal-only.

---

### 3. `import.meta.resolve` is incompatible with Vitest's SSR transform

**What happened:** The `pi-vim-stash` package uses `import.meta.resolve("@earendil-works/pi-coding-agent")` at module scope (not inside a function) to compute a module URL. When Vitest runs tests, it uses an SSR-like transform that doesn't support `import.meta.resolve` the same way Node.js does. Result: 3 tests fail with module resolution errors.

**Why it matters:** `import.meta.resolve` is a Node.js-specific API. Vitest uses Vite under the hood, which has its own module resolution pipeline. Vite's SSR transform does not implement `import.meta.resolve` identically to Node — especially for bare specifiers that would normally resolve through `node_modules`.

**What to do about it:** Options:
- **(a) Polyfill/stub in vitest setup**: Use `vi.stubGlobal` or a setup file to mock `import.meta.resolve` before tests run.
- **(b) Restructure code**: Move the `import.meta.resolve` call into a lazy getter or function so it doesn't execute at module parse time during tests.
- **(c) Use `--experimental-vm-modules`**: Not reliable with Vitest.
- **(d) Skip with `test.skip`**: If the affected tests are peripheral, mark them with a `@tag` and skip in CI.

---

### 4. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are too strict for migrating existing codebases

**What happened:** The initial `tsconfig.base.json` inherited strict settings from a prior project. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` caused hundreds of type errors across the three migrated packages because the original code was written without these strictness flags.

**Why it matters:** These two flags are not part of `"strict": true` — they're opt-in extras. They're designed for greenfield projects that can adopt them from day one. For existing code, they create a massive backlog of type errors that are mostly noise (optional property checks in benign patterns, array indexing that's known-safe but not provable by the type system).

**What to do about it:** Remove them from the base config. They can be re-enabled per-package once the code has been refactored. The base config should set `"strict": true` (which covers the core strictness flags) but omit these two optional extras.

---

### 5. ESLint's `no-unsafe-*` rules are extremely noisy for codebases with pervasive `any`

**What happened:** Enabling `recommendedTypeCheckedOnly` and `stylisticTypeCheckedOnly` from `typescript-eslint` surfaced hundreds of `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, and `no-unsafe-argument` violations. These rules flag every place where an `any`-typed value is used — which is pervasive in existing Pi extension code.

**Why it matters:** The `no-unsafe-*` family is designed for type-safe codebases that have already eliminated `any`. For codebases in the process of migrating to stricter typing (especially those that interact with dynamic runtime APIs), these rules generate so much noise that they overwhelm other useful lint feedback.

**What to do about it:** Disable `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, and `no-unsafe-argument` in ESLint config initially. Keep the non-`unsafe` type-aware rules enabled (e.g., `no-floating-promises`, `no-misused-promises`) as they catch real bugs without being swamped by `any` noise. Re-enable the `no-unsafe-*` rules incrementally as `any` usage is eliminated.

---

### 6. npm shim scripts: `command -v npm` finds the shim itself

**What happened:** The npm shim (`scripts/bin/npm`) uses `command -v -a npm` to find all `npm` executables in `PATH`, then filters out its own directory. If this filtering is wrong or incomplete, the shim can call itself recursively instead of the real npm.

**Why it matters:** When `scripts/bin/` is added to `PATH`, the shim becomes the first `npm` found. Without explicit filtering, `command -v npm` returns the shim itself. The fix: iterate `command -v -a npm` results, skip paths that match `"$SCRIPT_DIR"`, and use the first remaining entry as the real npm.

**What to do about it:** The shim already implements this correctly (`[[ "$p" != "$SCRIPT_DIR/npm" ]]`), but the pattern is fragile. In complex PATH setups, consider using `PATH` manipulation: temporarily remove `$SCRIPT_DIR` from `PATH` before calling `command -v npm`, then restore it.

---

### 7. TypeScript 5.9.3 lost type narrowing on `resolveClipboardMirrorPolicy` without explicit return type annotation

**What happened:** The function `resolveClipboardMirrorPolicy` returns an object `{ policy: ClipboardMirrorPolicy; warning?: string }`. Without an explicit return type annotation on the function, TypeScript 5.9.3 inferred a broader type that lost the narrowing of the `policy` field to `"all" | "yank" | "never"` — instead inferring `string`. Adding the explicit return type annotation fixed the issue.

**Why it matters:** TypeScript's return type inference for functions that build objects from conditional branches can be fragile, especially when there are early returns or when the branches return objects with different shapes. Relying on inference alone can cause downstream code to lose type precision.

**What to do about it:** Always annotate the return type of public/exported functions that return complex objects. This is both documentation and a safeguard against inference changes between TypeScript versions. The function signature should be the source of truth for the return type.

---

### 8. `.pi/settings.json` npm entries can block subagent startup — CRITICAL

**What happened:** `.pi/settings.json` was configured with entries for all three packages:

```json
{
  "packages": [
    "./packages/pi-skill-creator",
    "./packages/pi-vim-stash",
    "./packages/pi-token-killer"
  ]
}
```

Pi reads this file at startup to discover local packages. Even though the `extensions` and `skills` arrays inside each package's `package.json` contain valid local paths, Pi's subagent spawning mechanism attempted to resolve these through npm in addition to the local filesystem. Since the packages aren't published to npm yet, subagents (like the `retro` and `reflect` agents) failed to start with "package not found" errors. **This blocked both retro and reflect agents initially.**

**Why it matters:** This is a hidden footgun. The `.pi/settings.json` file is supposed to enable local package discovery, but it also triggers an npm resolution path. If the packages aren't published, subagent spawning breaks silently or with confusing errors. The symptom is that subagents fail to spawn, but the error message points to npm resolution, not to the `settings.json` configuration.

**What to do about it:** 
1. **Immediate fix**: Remove unpublished packages from `.pi/settings.json` until they're actually published to npm. Local packages can still be used via relative paths or workspace linking.
2. **Long-term**: Ensure `.pi/settings.json` only lists packages that are published and installable. For local development, use `pnpm link` or workspace protocol instead.
3. **Debugging tip**: If a pi subagent fails to start with a package resolution error, check `.pi/settings.json` first — it's likely listing an unpublished package.

---

## Meta-Lesson: Subagent Resilience

**Pattern observed:** When `.pi/settings.json` lists packages not published to npm, subagents (retro, reflect, propose, explore, etc.) fail at startup. The failure is confusing because the error comes from npm resolution, not from the settings configuration. In this session, it took multiple attempts and diagnostics to identify the root cause.

**What to do about it:** Before invoking subagents in a project with `.pi/settings.json`, run `pi doctor` or check that all listed packages are resolvable. The `settings.json` acts as a gatekeeper — if it's misconfigured, the entire subagent ecosystem breaks.

---

## Skill Proposals

### Proposed skill: `pi-monorepo-toolchain`

**Pattern observed:** Setting up a pnpm monorepo for Pi packages involves a consistent set of steps that were repeated across this session: pnpm workspace config, shared toolchain (Biome + ESLint + TypeScript + Vitest), npm/npx shims, `.pi/settings.json` handling, catalog dependencies, and local package linking.

**What the skill would do:** Provide a checklist and reference for setting up a Pi monorepo. Include:
- `pnpm-workspace.yaml` template with catalog
- `tsconfig.base.json` template with the relaxed settings learned here
- `biome.json` template for Biome 2.4.8
- `eslint.config.js` template with `no-unsafe-*` disabled
- npm/npx shim scripts with the PATH-finding pattern
- `.pi/settings.json` guidance (don't list unpublished packages)
- Known pitfalls: import.meta.resolve vs Vitest, peer deps in pnpm, TypeScript return type annotations

**Trigger conditions:** User asks to set up a monorepo for Pi packages, or mentions "pnpm workspace" + "pi".

**Scope:** Project-level (`pi-things`).

**Dependencies:** None beyond the tools already in the repo.

---

### Proposed skill: `pi-settings-troubleshoot`

**Pattern observed:** When subagents fail to start, the root cause was `.pi/settings.json` referencing unpublished packages. This debugging pattern is reusable.

**What the skill would do:** A diagnostic checklist for pi subagent startup failures:
1. Check `.pi/settings.json` for npm entries referencing unpublished packages
2. Check that all `pi.extensions` and `pi.skills` paths in `package.json` exist
3. Run `pi doctor` or equivalent to validate the environment
4. Verify that peer dependencies are resolvable

**Trigger conditions:** User reports subagent startup failures, or an agent fails to spawn with npm resolution errors.

**Scope:** Global (applicable across Pi projects).

**Dependencies:** None.
