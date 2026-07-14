# Security model — risk acceptance

**Status:** advisory-only security model, accepted for this app's context (no backend, no
network, no multi-tenant deployment). This document is the single page of record for that
acceptance. `CLAUDE.md` carries a short summary and links here; this doc holds the full detail.

## 1. Trust boundary

XQAP has **no backend**. Every role check, permission check, and business-logic guard runs
entirely in the user's browser. All business data (population, samples, distribution,
templates, answers, reports) is plain JSON written to a user-selected workspace folder on disk
via the File System Access API.

**Consequence:** a user with local access to the machine (or with browser devtools open) can:

- Read or edit any JSON file in the workspace folder directly, bypassing every UI-level
  validation and permission check.
- Read or edit the app's `localStorage` entries (managed users, role→tab permission matrix,
  label overrides) to grant themselves a different role or unlock hidden tabs.
- Read the session token in `sessionStorage` or forge one.

**The auth layer (`src/auth/`) is a UX/role-routing guard, not a trust boundary.** It exists to
give each role an appropriately scoped, uncluttered UI and to prevent accidental cross-role
actions — it does **not** defend against a user who deliberately chooses to bypass it. This app
must not be deployed anywhere a malicious or determined insider must be defended against by the
software itself; that defense, if needed, is an organizational/physical-access control outside
this codebase's scope.

## 2. Bootstrap admin hash exposure + passcode policy

The bootstrap `admin` account's password hash (`BOOTSTRAP_ADMIN_PASSWORD_HASH` in
`src/auth/authConfig.ts`) is compiled directly into the client bundle (`dist/index.html`).
Anyone who can obtain the built app — which, given the no-backend design, is anyone who runs
it — can extract this hash and attempt an **offline** brute-force/dictionary attack against it
with no rate limiting, no lockout, and no logging of attempts.

The hash uses Argon2id (`m=19456 KiB, t=2, p=1` — OWASP's 2026 baseline), which is
deliberately memory- and time-hard to slow such attacks, but Argon2id raises the cost of
cracking a weak passcode — it does not make a weak passcode safe.

**Passcode policy (accepted mitigation):**

- The bootstrap admin passcode **must** be long and high-entropy (treat it like a root
  credential, not a login you'd reuse or write down casually) — it is the only real defense
  against this exposure.
- Legacy PBKDF2-SHA256 hashes (pre-2026-06-23 rotation) are still verified for backward
  compatibility and are transparently upgraded to Argon2id on next successful login
  (`needsRehash` → `persistUserPasswordHash`). Any account still on a legacy hash should be
  rotated to a strong passcode at the next opportunity to benefit from the stronger algorithm.
- Rotating the bootstrap admin passcode requires generating a new Argon2id hash and updating
  `BOOTSTRAP_ADMIN_PASSWORD_HASH` in `src/auth/authConfig.ts`, then rebuilding — see the comment
  at `authConfig.ts:21-23` (dated 2026-06-23, referencing `docs/EDIT_LOG.md` v2) for the last
  rotation.

## 3. Demo/viewer static passcode (TEC-06 — accepted by design)

`src/auth/authConfig.ts` defines a hardcoded demo/preview account:

```ts
export const VIEWER_USERNAME = "viewer";
export const VIEWER_PASSWORD = "view";
```

This is intentionally a plaintext, static, publicly-known credential — not a secret. Logging in
as `viewer` mounts an **in-memory, ephemeral demo workspace** (`createDemoWorkspace` in
`src/data/workspace/demoWorkspace.ts`): no real folder is opened, nothing is ever written to the
user's disk, and the session cannot touch real workspace data. Treat it the same as a public
read-only demo link, not as an access-controlled account.

**Accepted risk:** fine as-is for a local-exploration/demo aid. **If demo mode is ever changed
to point at real data** (e.g. a seeded copy of production-shaped data with sensitive content, or
made reachable from a shared/hosted deployment), this acceptance must be revisited — rotate the
credential or gate it behind a real check at that point.

## 4. localStorage / JSON tamperability

Two browser-storage surfaces hold app state outside the workspace folder, both of which any
local user can read or edit via devtools with no server round-trip to catch the change:

- **`localStorage["xray_user_management_v1"]`** — managed users and the role→tab permission
  matrix. Editing this can self-elevate a role or unlock hidden tabs. Changes broadcast via a
  custom DOM event (`subscribeToUserManagementChanges`) so the UI reacts immediately, but there
  is no integrity check on the stored value itself.
- **`sessionStorage["xray_auth_session_v1"]`** — the current session. Survives a reload,
  auto-clears when the tab/browser closes, and carries a 7-day TTL as a secondary guard on
  read-back. This is a UX convenience (avoid re-login on refresh), **not** a security control —
  a forged or replayed session value would be accepted the same as a real one, since there is no
  server to validate it against.
- **Workspace JSON files** (`1-population/`, `2-samples/`, etc.) — protected against
  *accidental* corruption by the safe-write layer (`safeWriteJson`/`safeReadJson`: snapshot →
  `.bak`, stage in `.tmp`, verify, commit, re-verify) and versioned via `JsonEnvelope`, but this
  is a crash/corruption safeguard, not tamper protection — a user editing the files directly with
  a text editor can write anything that passes the schema shape checks.

**Accepted risk:** consistent with §1 — there is no mechanism, short of a real backend with
server-side authorization, that would close this gap. Not planned for this app's current scope.

## 5. Acceptance

This document describes the security posture as understood and **accepted** for XQAP's current
deployment model (single user or small trusted team, local workspace folder, no backend, no
network exposure of business data). It should be revisited if any of the following changes:
multi-tenant or hosted deployment, exposure of the demo/viewer account to real data, or a
decision to defend against actively malicious local users.

**Accepted by:** XQAP maintainers (hardening batch, branch `hardening-2026-07-08`)
**Date:** 2026-07-08

## 6. Addendum — data-pipeline rework (2026-07-14, Wave B7)

Three clarifications added alongside the Wave A/B data-pipeline rework
(`docs/architecture/DATA_PIPELINE_REWORK_2026-07-14.md`). None change the posture in §1;
they make explicit what the new integrity fields do and do not guarantee.

### (a) `contentHash` is corruption-detection, not tamper-proofing

Every workspace JSON file carries `JsonEnvelope.metadata.contentHash`, a **non-cryptographic
djb2-style digest** (`simpleHash` in `src/data/storage/jsonEnvelope.ts`). On read, `validateEnvelope`
recomputes it and rejects a file whose stored hash no longer matches its data — this catches
partial writes, disk corruption, and truncation. It provides **no protection against deliberate
tampering**: the hash has no secret key, so anyone who edits a file can recompute a matching
`contentHash` and the change passes validation. The same limitation applies to the Wave B5
hash-chains (`previousDecisionHash` on approval decisions, `previousArchiveHash` on audit-log
archives): they are **tamper-EVIDENT, not tamper-PROOF** — they surface an accidental or
out-of-band edit that breaks the chain, but a determined editor with file access can recompute the
entire chain. A cryptographically strong, keyed MAC would add no real security here because the key
would have to ship in the client bundle (there is no server to hold it) — see §1.

### (b) Shared-folder concurrency is an accepted permanent limitation

Multiple machines can point at the same workspace folder (e.g. a network share). Concurrent writes
are guarded **best-effort** by the Web Locks API (within a tab/origin) and by a Compare-And-Swap
retry loop (`casLoop`) that embeds a per-write UUID token and re-reads to detect a lost update
across machines. This is genuinely useful but is **not** a distributed lock: there is no central
authority to arbitrate two machines that read the same base revision and commit within the same
narrow window. When CAS retries are exhausted, the write **fails loudly with an Arabic conflict
message** (Wave B6 ensures user-initiated writes surface this rather than failing silently) so the
user can reload and retry — data is never silently lost, but true simultaneous cross-machine
serialization is out of reach without a backend. This is an **accepted, permanent limitation** of
the no-backend design, not a defect to be fixed.

### (c) NCA ECC-2:2024 note

The Saudi National Cybersecurity Authority's Essential Cybersecurity Controls (ECC-2:2024) apply in
full to government entities and would require controls this browser-only SPA cannot enforce:
encryption of data at rest and in transit per classification, centralized logging/SIEM
integration, and network-layer controls. Full ECC compliance is therefore **out of scope for the
no-backend architecture** and would require a server-backed rework (identity provider,
server-side authorization, encrypted central store, audit forwarding). The app aligns where it
costs nothing — plain-JSON records with retention/archival policy, per-file revisioning, and an
append-only audit trail — but these are voluntary alignments, not compliance. See
`docs/research/PIPELINE_RESEARCH_2026-07-14.md` §7 for the underlying survey.

**Accepted by:** XQAP maintainers (data-pipeline rework, Wave B7)
**Date:** 2026-07-14
