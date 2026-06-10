# Handoff: Assimilate pi-holo-mem into monorepo

## State

**Done:**
- Standalone `pi-holographic-memory` extension migrated to `packages/pi-holo-mem/` in the pi-things monorepo
- Source files copied (excluding runtime artifacts, standalone tooling configs)
- Package configs created: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Source modified: config.ts externalization (state to `~/.pi/agent/pi-holo-mem/`), threshold param fix, 4xx retry fix (numeric status check)
- Typebox alias removed — all imports use `"@sinclair/typebox"` directly (Option B)
- `PIHOLOMEM_*` env var prefix unified across TS and Python sides
- Scripts + Python bridge + scaffolding + root monorepo config updates applied
- All reviewer findings (10 issues) fixed in second round
- Change archived, delta specs synced to main specs
- Package-level spec drift corrected (3 of 4 had drifted from delta versions)
- Verification: `tsc` clean, `eslint` clean, `vitest` 17/17, monorepo `test:all` 654/654

**Remaining:**
- Package-level specs now match archived deltas — no further drift expected unless manually edited

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Typebox import strategy | Remove alias, use `"@sinclair/typebox"` directly (Option B) | Simpler; avoided maintaining package-level alias when root tsconfig paths already mapped it |
| Runtime state location | `~/.pi/agent/pi-holo-mem/` (venv, DB, PID, logs) | Consistent with pi agent runtime conventions, not polluting cwd |
| Env var prefix | `PIHOLOMEM_*` on both TS and Python sides | Single unified prefix, no mapping layer needed |
| 4xx retry detection | Numeric status check on error object | Robust; avoided fragile string matching against error messages |
| Reviewer selection | mimo-v2.5 + deepseek-v4-flash in parallel with identical prompts | Comparison experiment — produced complementary findings |

## Blockers

- None. Implementation complete and verified.

## Next Actions

1. **Monitor package-level specs** — ensure they stay in sync if the package is further modified
2. **Remove stale files** if any remain from the standalone repo (the copy excluded most, but a final diff check against the source repo could catch stragglers)
3. **Use for future assimilations** — the parallel-subagent pattern (Phase 1 copy → Phase 2 parallel configs/source/scripts/specs → review → fix) is repeatable for similar migrations

## Durable Learnings

- When `vitest.config.ts` drops an alias, ALL source imports using that alias must be updated — tsc alone won't catch runtime imports
- `.d.ts` files need ESLint ignores when outside `projectService` scope
- `@sinclair/typebox` is a runtime dependency when used in tool registration, not just devDep
- Package-level specs can drift from delta specs if copied from source repo instead of delta — always copy from the delta spec
- Parallel reviewers with different models produce complementary findings (mimo caught config hygiene, deepseek caught runtime correctness)
