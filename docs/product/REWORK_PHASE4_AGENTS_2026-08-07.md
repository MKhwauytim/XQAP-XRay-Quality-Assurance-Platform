# Rework — Phase 4: Agent Roster, Skills, and Workflow

**Date:** 2026-08-07
**Input:** `REWORK_PHASE3_SPEC_2026-08-07.md` (workstreams W0–W8).
**Status:** Phase 4 of 4 — definition complete; execution gated (see §6).

---

## 1. Roster design principles

1. **One agent owns one workstream.** Split by *subsystem*, not by file, so an agent holds a
   coherent mental model and its edits don't collide with a sibling's.
2. **Every implementation agent is followed by an adversarial verifier** with a different brief —
   the implementer's job is to make it work, the verifier's is to prove it doesn't.
3. **Worktree isolation only where agents mutate overlapping files.** It costs ~200–500ms plus disk
   per agent, so it is not the default.
4. **Deterministic-code agents are constrained to run golden masters before and after**, and to
   report any diff rather than accept it.
5. **No agent commits or pushes.** Changes are left staged for human review.

---

## 2. The roster

### Tier 0 — Prerequisites (must complete before anything else)

| Agent | Goal | Skills / knowledge required | Tools |
|---|---|---|---|
| **field-manifest-analyst** | Produce `EMPLOYEE_MIRROR_STUB_FIELDS` and `MONTH_AGGREGATE_FIELDS` by reading actual JSX, plus a test that fails when a component reads a field outside the manifest | React component analysis; distinguishing rendered fields from merely-typed ones | Read, Grep, Glob, Write, Edit |
| **safety-net-engineer** | W0 — golden masters at 3 grains, `fast-check` properties validated against **current** code, ~30-line differential harness, determinism audit | Property-based testing; characterization testing; JS determinism traps (sort totality, float order-sensitivity, `JSON.stringify` semantics, structured-clone loss) | Read, Grep, Write, Edit, Bash |

**Why these are Tier 0:** the manifest blocks W4 and W6 and both fail *silently* without it; the
safety net blocks every deterministic change. Running anything else first is building on sand.

### Tier 1 — Independent quick fixes (high parallelism, no shared state)

| Agent | Owns | Notes |
|---|---|---|
| **input-fix-engineer** | W1.1, W1.2 (comma bug, alias validation) | `useDelimitedListInput()`; must fix alias, sheet-pattern **and** stage-mapping inputs |
| **ui-fix-engineer** | W1.3, W1.10, W8.7 (modal portal, movement-type hint, approvals polish) | Portal preferred over dropping `transform` — fixes the class, not one case |
| **report-ux-engineer** | W1.4, W1.9 (customizer instant-open, KPI shared load + template) | **W1.9 fixes a correctness bug too** — the `template: null` hardcode |
| **sampling-ux-engineer** | W1.6, W1.7 (running total, `minRequiredCount` default) | Touches sampling config — must run W0 golden masters |
| **platform-fix-engineer** | W1.5, W1.8 (save progress, session persistence) | Also updates `SECURITY_MODEL.md` for the accepted risk |

These five run **fully parallel**. File overlap is minimal; no worktree isolation needed.

### Tier 2 — Critical path (sequential, each gated by verification)

| Agent | Owns | Skills required | Isolation |
|---|---|---|---|
| **storage-engineer** | W3 — segments, write protocol, checkpoint, change detection | Event sourcing; append-only log design; snapshot+delta; File System Access semantics; **why the fold is non-commutative** | worktree |
| **data-shape-engineer** | W4 — reference-not-copy, stub, drop `rawRow` | Schema migration with dual-read; graceful degradation | worktree |
| **aggregate-lifecycle-engineer** | W6 — aggregates on disk, month auto-lock, W35a enforcement | Aggregate design; cache keying by `(month, revision)`; **disk vs IndexedDB placement rationale** | worktree |

### Tier 3 — Parallel with Tier 2

| Agent | Owns | Notes |
|---|---|---|
| **react-platform-engineer** | W5 — TanStack Query, Virtual, React Compiler, `scheduler.postTask()` | Must honour the **single invalidation authority** rule |
| **aggregation-architect** | W2 — one fact table, explicit grain, delete divergent folds | Numbers **will** change; every diff must be reviewed against W0 masters |

### Tier 4 — After Tier 2/3

| Agent | Owns |
|---|---|
| **reports-engineer** | W7 — model restructure, R1–R5, decompose `slides.ts` |
| **hygiene-engineer** | W8 — dead code, `feedback/` relocation, boundary fix, exports, placement, docs |

### Cross-cutting

| Agent | Goal | Count |
|---|---|---|
| **adversarial-verifier** | Given one change, try to **refute** it: find the input that breaks it, the guarantee it weakened, the golden diff it accepted silently. Default to "refuted" when uncertain | 1 per Tier 2/3/4 change; 3 in parallel for W3 (highest risk) |
| **determinism-auditor** | For any change to sampling, folding, or report builders: confirm golden masters ran before and after, and that every diff is intentional and documented | 1 per deterministic change |

**Total: 12 agent roles, ~22 invocations** across the full sequence.

---

## 3. Skills each agent must be briefed on

Beyond its workstream, every agent receives:

1. **The governing rules** (Phase 3 §0) — rewrite licensed, correctness guarantees not.
2. **The two load-bearing guarantees:** collision-free multi-writer writes (unique filenames) and
   double-assign prevention (fresh pre-action read). *Make them cheap, never remove them.*
3. **The determinism trap list:** sort-comparator totality; numeric-looking string keys; float
   rounding order-sensitivity (**pin fold order**); `JSON.stringify` dropping `undefined` and
   flattening `Map`/`Set`; `postMessage` structured-clone loss; unpinned `Date.now()`.
4. **The edit-log protocol** — `npm run editlog -- --tier=N`, written *after* the edit.
5. **Constraints:** single-file build; bundle budget; workspace files stay human-inspectable; no
   backend; Chromium-only.
6. **Do not commit or push.**

---

## 4. Workflow shape

```
Phase A  parallel: field-manifest-analyst, safety-net-engineer
         └─ barrier: both must succeed (everything downstream depends on them)

Phase B  parallel: the 5 Tier-1 quick-fix agents
         └─ pipeline: each → adversarial-verifier (no barrier; verify as each lands)

Phase C  storage-engineer (worktree)
         └─ 3 parallel adversarial-verifiers  ← highest-risk change in the project
         └─ determinism-auditor

Phase D  parallel: data-shape-engineer, react-platform-engineer, aggregation-architect
         └─ pipeline: each → adversarial-verifier + determinism-auditor where deterministic

Phase E  aggregate-lifecycle-engineer → verifier

Phase F  reports-engineer → verifier + determinism-auditor

Phase G  hygiene-engineer → verifier
```

**Barriers only where genuinely needed:** after Phase A (everything depends on it) and after Phase C
(W4 and W6 build on the new storage shape). Everything else pipelines.

**Estimated agent-invocations:** ~22. **Wall-clock is dominated by Phase C**, which is sequential by
nature and the highest-risk work in the project.

---

## 5. Per-phase acceptance gates

| Phase | Gate |
|---|---|
| A | Golden masters regenerate identically twice; `fast-check` properties pass against **unmodified** code; manifests have an enforcing test |
| B | Each fix independently demonstrable; a comma can be typed; every modal backdrop covers the viewport; customizer opens <200ms |
| C | 9,000-assignment save in **minutes**; cold load folds only new events; **late-event refold produces output identical to folding from scratch** |
| D | Workspace ~1:1 with source Excel; employee loads sample with **zero** population reads; all accuracy figures agree across editions |
| E | Finished-month Population tab performs **zero** row reads |
| F | R1–R5 present; report model diffs reviewed and intentional |
| G | Dead code gone (`aggregate()` retained); bundle within budget; full suite green |

---

## 6. Execution gate — why the workflow is defined but not launched

The roster and workflow above are ready to run. I am **not** launching them unattended, for three
specific reasons rather than general caution:

1. **Concurrent sessions on this repo are routine** (recorded in prior session memory). A
   multi-agent rework touching dozens of files across hours is precisely the situation that
   collides with another session's work — producing a merge mess rather than a reviewable change.
2. **The working tree already carries uncommitted work** (v59.200–v59.202). Layering a large rework
   on top compounds review burden and makes rollback harder.
3. **Two items need owner decisions that change outputs**, not just implementations:
   - **C6 backfill policy** — backfill CertScan shortfall from NonCertScan, or under-fill and
     report? This changes the sample's statistical properties. *Recommendation: under-fill and
     report* — silent substitution would misrepresent stratum composition in an audit context.
   - **C5 CertScan matching** — needs the owner's actual CertScan paste and port names to confirm
     where normalization diverges. The interim fix (a pre-commit match-count preview) is safe and
     specified, but the root fix isn't determinable without that data.

**Recommended launch order when execution is approved:**
1. Commit or stash the existing v59.200–202 work first.
2. Run **Phase A alone** and review it. It adds tests and manifests — no behaviour change — and
   everything downstream depends on it being right.
3. Then Phase B (quick fixes) — visible wins, low risk, independently reviewable.
4. Then Phase C with its three verifiers, reviewed before proceeding.

Phases A and B alone deliver: a working comma key, every modal fixed, an instant customizer, honest
save progress, persistent sign-in, KPI tiles that are both fast *and* correct, and visible sampling
totals — while the risky work stays gated behind a reviewed safety net.
