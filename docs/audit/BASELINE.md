# Phase 0 Baseline — 2026-06-28

## Gate results (captured before any hardening change)

| Gate | Command | Result |
|------|---------|--------|
| Type check | `tsc --noEmit` | ✅ PASS — 0 errors |
| Tests | `vitest run` | ✅ PASS — 119 tests, 25 files |
| Lint | `eslint src` | ✅ PASS — 0 problems |
| Build | `vite build` | ✅ PASS — `dist/index.html` 1,937.61 kB (gzip 664.61 kB) |

All four gates pass **with the pre-existing uncommitted working tree applied** (26 modified + 11 untracked files, ~2,496 insertions / 1,442 deletions).

## Working-tree reconciliation (DATA-01)

The pre-existing uncommitted work was **not authored in this session** and is too large to line-review here. Because every quality gate passes with it applied, it is captured as a single labeled checkpoint commit rather than dissected or discarded — this preserves the work and creates a restore point so subsequent hardening commits are isolated and independently revertible.

- **Branch:** `prod-readiness-hardening` (created off `main`)
- **Checkpoint commit:** pre-hardening WIP (all gates green)
- **Baseline tag:** `baseline-prod-readiness-2026-06-28` (applied after audit deliverables commit, on a clean tree)

## Rollback procedure

- **Undo all hardening, return to baseline:** `git reset --hard baseline-prod-readiness-2026-06-28`
- **Undo a single hardening change:** `git revert <commit>` (each fix is its own commit).
- **Return to pre-session `main`:** `git checkout main` (the branch leaves `main` untouched).
- **Rebuild artifact:** `npm run build` regenerates `dist/index.html` (git-ignored).

## Notes

- `dist/` is git-ignored — build artifacts are never committed.
- Line endings normalize LF→CRLF on Windows checkout (cosmetic; `.gitattributes` could pin this, tracked as a future nicety).
