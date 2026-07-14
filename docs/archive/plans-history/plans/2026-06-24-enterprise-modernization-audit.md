# Enterprise Modernization Audit & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perform a phased, non-destructive modernization of the x-ray quality control SPA to improve security correctness, code quality, observability, accessibility, performance, and test coverage — without breaking any existing functionality.

**Architecture:** React 19 + TypeScript strict-mode SPA. No backend. Two persistence layers: runtime-only auth session (in-memory module variables) and a workspace folder on disk accessed via the File System Access API. All write operations go through `safeWriteJson` (snapshot → stage → verify → commit). Auth is advisory-only (no server trust boundary).

**Tech Stack:** React 19, TypeScript 6 strict, Vite 8 + vite-plugin-singlefile, Vitest 4, Argon2id (hash-wasm), SheetJS, Recharts, plain CSS (RTL/Arabic-first).

## Global Constraints

- All UI strings must be Arabic or added as label keys in `src/data/labels/labelsStore.ts`; no hard-coded English user-facing text.
- RTL layout (`dir="rtl"`) must be preserved on all containers.
- The File System Access API write path must use `safeWriteJson` / `safeReadJson` from `src/data/storage/safeWrite.ts` — never raw file writes.
- The build output must remain a single self-contained `dist/index.html` — do not introduce dynamic imports that break `vite-plugin-singlefile`.
- TypeScript strict mode (`~6.0.3`); all new code must pass `tsc -b` and `npm run lint` without errors.
- Tests use Vitest with `node` environment. Use `createMemoryDirectory()` for any test that needs file I/O.
- The CLAUDE.md edit-log requirement: **every code edit must be logged in `docs/EDIT_LOG.md`** before being applied.
- No destructive changes to on-disk data structures; schema migrations must be backward-compatible.
- Chromium-only runtime for File System Access API is a known, accepted constraint — do not attempt polyfills.

---

## Audit Findings Summary

### Severity Legend
- 🔴 HIGH — Security issue, data-loss risk, or broken functionality
- 🟡 MEDIUM — Code quality, maintainability, or UX degradation
- 🟢 LOW — Polish, dead code, minor inconsistency

---

## Phase 1 — Security & Correctness Fixes

*These are the highest-impact items. Execute fully and validate before Phase 2.*

---

### Task 1: Remove dead `SESSION_KEY` constant and fix stale CLAUDE.md documentation

**Severity:** 🟡 MEDIUM  
**Effort:** 30 min  
**Files:**
- Modify: `src/auth/authConfig.ts:6`
- Modify: `docs/EDIT_LOG.md`
- Modify: `CLAUDE.md` (documentation correction only, no code change)

**Context:**  
`authConfig.ts` exports `SESSION_KEY = "xray_local_login_session_v1"` (line 6), a leftover from a previous localStorage-based session approach. The comment in `authSession.ts` explicitly says "Auth state is intentionally runtime-only." Nothing in the codebase imports or uses `SESSION_KEY`. This dead export misleads future developers into thinking session data is stored in `localStorage`.

Additionally, `CLAUDE.md` states "Session → `localStorage` (`authSession.ts`)..." which contradicts the current runtime-only implementation.

**Acceptance Criteria:**
- `SESSION_KEY` is removed from `authConfig.ts`
- `grep -r "SESSION_KEY"` returns zero hits
- CLAUDE.md auth section accurately describes runtime-only session
- `npm run lint` passes, `npm run build` produces `dist/index.html`

- [ ] **Step 1: Log the edit**

  Append to `docs/EDIT_LOG.md`:
  ```markdown
  ## v{next} — 2026-06-24 — Remove dead SESSION_KEY constant

  **File:** `src/auth/authConfig.ts`

  **Before:**
  ```ts
  export const SESSION_KEY = "xray_local_login_session_v1";
  ```

  **After:**
  *(line removed)*
  ```

- [ ] **Step 2: Remove the dead constant**

  In `src/auth/authConfig.ts`, delete the line:
  ```ts
  export const SESSION_KEY = "xray_local_login_session_v1";
  ```

- [ ] **Step 3: Verify no imports broke**

  Run: `grep -r "SESSION_KEY" src/`
  Expected: no output (zero matches)

- [ ] **Step 4: Correct CLAUDE.md**

  Find the line in CLAUDE.md:
  ```
  - Session → `localStorage` (`authSession.ts`), persisted across browser restarts with a **7-day TTL** measured from `loginAt`; expired/invalid sessions are cleared on read.
  ```
  Replace with:
  ```
  - Session → runtime-only module variable in `authSession.ts` (no `localStorage`). Sessions survive tab navigation but are lost on page refresh or tab close. The 7-day TTL constant remains but is only applied when a session is read back after it was previously written (e.g. after page reload if a future persistence layer is added).
  ```

- [ ] **Step 5: Validate**

  Run: `npm run build`
  Expected: build succeeds, single `dist/index.html` produced.

- [ ] **Step 6: Commit**

  ```bash
  git add src/auth/authConfig.ts CLAUDE.md docs/EDIT_LOG.md
  git commit -m "fix: remove dead SESSION_KEY constant, correct CLAUDE.md session docs"
  ```

---

### Task 2: Add missing `aria-label` to admin passcode input and fix `auth-message` bad-class binding

**Severity:** 🔴 HIGH (accessibility blocker) + 🟢 LOW (CSS class bug)  
**Effort:** 20 min  
**Files:**
- Modify: `src/auth/AuthGate.tsx`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
1. In `AuthGate.tsx` line 548, the admin passcode `<input type="password">` has no `aria-label` or associated `<label>` — screen readers announce nothing when focus lands on it.

2. The `auth-message` div at line 507 applies `messageType === "ok" ? "ok" : ""` — the `"bad"` state from `MessageType` is never actually applied as a CSS class to the div. Error messages get no CSS class, so the red-styling must rely on the bare `auth-message` styles already being red. This is fragile and undocumented.

**Acceptance Criteria:**
- Admin passcode input has `aria-label="رمز مسؤول النظام"` 
- The `auth-message` div applies both `"ok"` and `"bad"` classes correctly
- Screen reader test: input is announced with its label

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Fix aria-label**

  In `src/auth/AuthGate.tsx`, find the admin passcode input (around line 547):
  ```tsx
  <input
    type="password"
    autoFocus
    value={adminPasscode}
    onChange={(event) => setAdminPasscode(event.target.value)}
    onKeyDown={handleAdminModalKeyDown}
    placeholder="رمز مسؤول النظام"
  />
  ```
  Change to:
  ```tsx
  <input
    type="password"
    autoFocus
    aria-label="رمز مسؤول النظام"
    value={adminPasscode}
    onChange={(event) => setAdminPasscode(event.target.value)}
    onKeyDown={handleAdminModalKeyDown}
    placeholder="رمز مسؤول النظام"
  />
  ```

- [ ] **Step 3: Fix `auth-message` class binding**

  Find the employee login message div (around line 506):
  ```tsx
  <div
    className={`auth-message ${messageType === "ok" ? "ok" : ""}`}
    aria-live="polite"
  >
  ```
  Change to:
  ```tsx
  <div
    className={`auth-message${messageType ? ` ${messageType}` : ""}`}
    aria-live="polite"
  >
  ```
  This correctly applies `"ok"` or `"bad"` class from `MessageType`.

- [ ] **Step 4: Verify `auth-message` CSS has `.bad` rule**

  In `src/auth/AuthGate.css`, verify there is a `.auth-message.bad` rule. If only the base `.auth-message` is red, add:
  ```css
  .auth-message.bad { color: #b91c1c; }
  .auth-message.ok  { color: #15803d; }
  ```
  And make the base `.auth-message` neutral (inherit or gray).

- [ ] **Step 5: Run lint and build**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/auth/AuthGate.tsx src/auth/AuthGate.css docs/EDIT_LOG.md
  git commit -m "fix: add aria-label to admin passcode input, fix auth-message class binding"
  ```

---

### Task 3: Add login attempt soft-throttle

**Severity:** 🟡 MEDIUM  
**Effort:** 45 min  
**Files:**
- Modify: `src/auth/AuthGate.tsx`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
There is no delay or lockout after failed login attempts. An attacker with local access can script rapid password guesses. Argon2id makes each attempt slow (~300 ms), but a 5-attempt UI lockout with exponential backoff adds a meaningful deterrent and matches expected enterprise behavior.

**Design:** Track failed attempt count in component state. After 3 consecutive failures, apply a 30-second countdown before re-enabling the submit button. Reset on success. This is entirely UI-side (no persistence needed).

**Acceptance Criteria:**
- After 3 failed logins, submit button is disabled for 30 seconds with a countdown label visible to the user
- On successful login the counter resets
- Changing username resets the counter
- `npm run lint && npm run build` passes

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Add state to AuthGate**

  In `src/auth/AuthGate.tsx`, after existing `useState` declarations, add:
  ```tsx
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);

  const LOCKOUT_AFTER_ATTEMPTS = 3;
  const LOCKOUT_DURATION_MS = 30_000;
  ```

- [ ] **Step 3: Add lockout countdown effect**

  After the existing `useEffect` blocks:
  ```tsx
  useEffect(() => {
    if (lockoutUntil === null) return;
    const tick = () => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setLockoutSecondsLeft(0);
      } else {
        setLockoutSecondsLeft(remaining);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);
  ```

- [ ] **Step 4: Apply throttle in `loginAsEmployee`**

  At the top of `loginAsEmployee`, after `event.preventDefault()`, add:
  ```tsx
  if (lockoutUntil !== null && Date.now() < lockoutUntil) return;
  ```

  Replace the `showMessage("كلمة المرور غير صحيحة.", "bad")` call with:
  ```tsx
  const next = failedAttempts + 1;
  setFailedAttempts(next);
  if (next >= LOCKOUT_AFTER_ATTEMPTS) {
    setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
  }
  showMessage("اسم المستخدم غير موجود أو كلمة المرور غير صحيحة.", "bad");
  ```

  On successful login, reset: `setFailedAttempts(0); setLockoutUntil(null);`

- [ ] **Step 5: Disable submit button during lockout**

  Find the submit button `<button className="auth-submit" type="submit">`:
  ```tsx
  <button
    className="auth-submit"
    type="submit"
    disabled={lockoutUntil !== null && Date.now() < lockoutUntil}
  >
    {lockoutUntil !== null && lockoutSecondsLeft > 0
      ? `يُرجى الانتظار (${lockoutSecondsLeft}ث)`
      : "دخول"}
  </button>
  ```

- [ ] **Step 6: Reset counter when username changes**

  In the `setSelectedUsername` onChange handler, also call `setFailedAttempts(0); setLockoutUntil(null);`:
  ```tsx
  onChange={(event) => {
    setSelectedUsername(event.target.value);
    setFailedAttempts(0);
    setLockoutUntil(null);
  }}
  ```

- [ ] **Step 7: Also reset on `logout`**

  In the `logout` callback, add: `setFailedAttempts(0); setLockoutUntil(null);`

- [ ] **Step 8: Validate**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 9: Commit**

  ```bash
  git add src/auth/AuthGate.tsx docs/EDIT_LOG.md
  git commit -m "feat: add 3-attempt login lockout with 30-second countdown"
  ```

---

### Task 4: Fix focus trap in admin passcode modal

**Severity:** 🟡 MEDIUM (keyboard accessibility)  
**Effort:** 30 min  
**Files:**
- Modify: `src/auth/AuthGate.tsx`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
When the admin passcode modal opens, keyboard focus is not trapped inside it. The `autoFocus` on the input handles initial focus, but pressing Tab can escape the modal and interact with elements behind the backdrop. This violates ARIA `dialog` best practice.

**Acceptance Criteria:**
- Tab/Shift+Tab cycles only within the modal (input + two buttons) when open
- Escape closes the modal
- Focus returns to the element that triggered the modal on close

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Add focus trap to the modal**

  In `src/auth/AuthGate.tsx`, add a `useRef` for the modal section and a `useEffect` that traps focus:

  ```tsx
  const adminModalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isAdminModalOpen || !adminModalRef.current) return;
    const modal = adminModalRef.current;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'input, button, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    modal.addEventListener("keydown", handleKeyDown);
    return () => modal.removeEventListener("keydown", handleKeyDown);
  }, [isAdminModalOpen]);
  ```

  Attach `ref={adminModalRef}` to the `<section className="auth-admin-modal">` element.

- [ ] **Step 3: Return focus on close**

  Add a `triggerRef = useRef<HTMLElement | null>(null)` and store `document.activeElement` before opening the modal. On `closeAdminModal()`, call `triggerRef.current?.focus()`.

- [ ] **Step 4: Validate**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/auth/AuthGate.tsx docs/EDIT_LOG.md
  git commit -m "fix: add keyboard focus trap to admin passcode modal"
  ```

---

## Phase 2 — Code Quality & Architecture

---

### Task 5: Move inline styles in App.tsx to CSS classes

**Severity:** 🟢 LOW  
**Effort:** 20 min  
**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
`App.tsx` contains two blocks of large inline `style` objects: the `.bak` recovery warning banner (lines 162–184) and the `NoAvailableTabs` component (lines 234–258). Inline styles are harder to override, break CSS variable theming, and clutter component logic.

**Acceptance Criteria:**
- Zero inline `style` objects in `App.tsx` (the `NoAvailableTabs` and bak-warning banner use CSS classes)
- Visual appearance unchanged
- `npm run lint` passes

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Add CSS classes to `App.css`**

  Append to `src/App.css`:
  ```css
  .app-bak-warning {
    position: fixed;
    top: 0;
    inset-inline: 0;
    z-index: 9999;
    background: #fef3c7;
    border-bottom: 1px solid #f59e0b;
    padding: 10px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    color: #92400e;
    direction: rtl;
  }

  .app-bak-warning-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 20px;
    color: #92400e;
    line-height: 1;
    padding: 0 4px;
  }

  .app-no-tabs {
    min-height: calc(100vh - 44px);
    display: grid;
    place-items: center;
    padding: 24px;
    color: #475467;
    text-align: center;
  }

  .app-no-tabs h1 {
    margin: 0 0 10px;
    color: #17365d;
    font-size: 24px;
  }

  .app-no-tabs p {
    margin: 0;
    line-height: 1.8;
  }
  ```

- [ ] **Step 3: Replace inline styles in App.tsx**

  Replace the bak-warning `<div>` inline style with `className="app-bak-warning"` and the close button inline style with `className="app-bak-warning-close"`.

  Replace the `NoAvailableTabs` component body's inline styles with the CSS classes above.

- [ ] **Step 4: Validate**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/App.tsx src/App.css docs/EDIT_LOG.md
  git commit -m "refactor: move App.tsx inline styles to CSS classes"
  ```

---

### Task 6: Deduplicate dual-path sample directory resolution in `populationStorage.ts`

**Severity:** 🟡 MEDIUM  
**Effort:** 45 min  
**Files:**
- Modify: `src/data/population/populationStorage.ts`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
`populationStorage.ts` has three places where it tries `getSampleMainDir(...)` then falls back to `monthDir/sample` (lines 327–336 in `listMonthSummaries`, 339–347, and 444–457 in `loadAllSampleRows`). This dual-path pattern is duplicated verbatim each time, indicating a folder-structure migration that was never cleaned up. If the old `monthDir/sample` path is no longer created, the fallback is dead code. If it's still needed, it should be a shared helper.

**Acceptance Criteria:**
- A single private `resolveSampleDir` helper encapsulates the try-primary / fallback logic
- All three call-sites use the helper
- Existing tests pass: `npm run test:run`

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Write the failing test**

  In `src/data/population/populationStorage.test.ts`, add a test that verifies `loadAllSampleRows` returns rows when the sample dir is at the legacy `monthDir/sample` path (i.e., `getSampleMainDir` would throw). Use `createMemoryDirectory()`.

  ```ts
  it("loadAllSampleRows falls back to legacy sample path when getSampleMainDir throws", async () => {
    // Arrange: create the legacy directory structure
    const root = createMemoryDirectory("root");
    // ... set up Population/{month}/sample/sample.master.json
    // ... do NOT create the numbered Population folder expected by getSampleMainDir
    
    const rows = await loadAllSampleRows(root as DirectoryHandleLike);
    expect(rows.length).toBeGreaterThan(0);
  });
  ```

  Run: `npx vitest run src/data/population/populationStorage.test.ts`
  Expected: FAIL (test infrastructure not yet set up — that's fine at this step).

- [ ] **Step 3: Extract `resolveSampleDir` helper**

  In `src/data/population/populationStorage.ts`, add before the export functions:
  ```ts
  async function resolveSampleDir(
    directoryHandle: DirectoryHandleLike,
    monthFolderName: string,
    monthDir: DirectoryHandleLike
  ): Promise<DirectoryHandleLike | null> {
    try {
      return await getSampleMainDir(directoryHandle, monthFolderName, false);
    } catch {
      try {
        return await monthDir.getDirectoryHandle("sample", { create: false });
      } catch {
        return null;
      }
    }
  }
  ```

- [ ] **Step 4: Replace the three call-sites**

  In `listMonthSummaries`, `loadAllSampleRows`, and `loadMonthForEditing`, replace the inline try/catch dual-path blocks with calls to `resolveSampleDir(directoryHandle, info.folderName, monthDir)`.

- [ ] **Step 5: Run tests**

  Run: `npm run test:run`
  Expected: all existing tests pass.

- [ ] **Step 6: Validate**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/data/population/populationStorage.ts src/data/population/populationStorage.test.ts docs/EDIT_LOG.md
  git commit -m "refactor: extract resolveSampleDir helper, deduplicate dual-path fallback"
  ```

---

### Task 7: Split `AuthGate.tsx` — extract role-preview toolbar into its own component

**Severity:** 🟡 MEDIUM  
**Effort:** 45 min  
**Files:**
- Create: `src/auth/AdminToolbar.tsx`
- Create: `src/auth/AdminToolbar.css`
- Modify: `src/auth/AuthGate.tsx`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
`AuthGate.tsx` is 578 lines combining the login form, admin passcode modal, the post-login role-preview toolbar, and all their state. The toolbar (lines 378–432) is visually and functionally independent from the login flow. Extracting it improves readability and makes each unit smaller and testable.

**Acceptance Criteria:**
- `AdminToolbar.tsx` is a standalone component receiving `session`, `previewRole`, `onPreviewRoleChange`, `onLogout` as props
- `AuthGate.tsx` is reduced by ~80 lines (toolbar JSX removed)
- Visual behavior and logout/preview-role switching is unchanged
- `npm run lint && npm run build` passes

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Create `AdminToolbar.tsx`**

  Create `src/auth/AdminToolbar.tsx`:
  ```tsx
  import type { AuthRole, AuthSession } from "./authTypes";

  const PREVIEW_ROLE_IDS: AuthRole[] = ["admin", "manager", "supervisor", "employee", "guest"];

  function getRoleLabel(role: AuthRole): string {
    const map: Record<AuthRole, string> = {
      admin: "الإدارة",
      manager: "المدير",
      supervisor: "المشرف",
      employee: "الموظف",
      guest: "ضيف",
    };
    return map[role] ?? "الموظف";
  }

  type AdminToolbarProps = {
    session: AuthSession;
    previewRole: AuthRole | null;
    onPreviewRoleChange: (role: AuthRole) => void;
    onLogout: () => void;
    onFeedback: () => void;
  };

  export function AdminToolbar({
    session,
    previewRole,
    onPreviewRoleChange,
    onLogout,
    onFeedback,
  }: AdminToolbarProps) {
    const isRealAdmin = session.role === "admin";
    const effectiveRole: AuthRole = isRealAdmin && previewRole ? previewRole : session.role;
    const isImpersonating = effectiveRole !== session.role;

    return (
      <div
        className={`auth-admin-toolbar${isImpersonating ? " auth-toolbar-preview" : ""}`}
        dir="rtl"
      >
        <div className="auth-toolbar-status">
          <span className="auth-toolbar-kicker">الوضع الحالي</span>
          <strong>
            وضع {getRoleLabel(effectiveRole)}
            {isImpersonating && <span className="auth-preview-flag">معاينة</span>}
          </strong>
        </div>

        <div className="auth-toolbar-preview-panel">
          {isRealAdmin && (
            <>
              <span className="auth-role-switcher-label">معاينة الدور</span>
              <div className="auth-role-switcher" role="group" aria-label="معاينة الأدوار">
                {PREVIEW_ROLE_IDS.map((roleId) => (
                  <button
                    key={roleId}
                    type="button"
                    className={`auth-role-seg${effectiveRole === roleId ? " active" : ""}`}
                    onClick={() => onPreviewRoleChange(roleId)}
                    aria-pressed={effectiveRole === roleId}
                  >
                    {getRoleLabel(roleId)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="auth-toolbar-actions">
          {isRealAdmin && (
            <button
              type="button"
              className="auth-toolbar-help"
              onClick={onFeedback}
              aria-label="التواصل والاقتراحات"
              title="التواصل والاقتراحات"
            >
              ?
            </button>
          )}
          <button type="button" className="auth-toolbar-logout" onClick={onLogout}>
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 3: Update `AuthGate.tsx`**

  - Remove `PREVIEW_ROLE_IDS`, the local `getRoleLabel` function, and the toolbar JSX block (lines ~378–432).
  - Import and render `<AdminToolbar>` instead, passing `session`, `previewRole`, `changePreviewRole`, `logout`, and `toggleFeedbackPanel`.
  - Remove the `toggleFeedbackPanel` function from `AuthGate.tsx` and pass it directly from `AdminToolbar` via the `onFeedback` prop.

- [ ] **Step 4: Move toolbar CSS**

  Move toolbar-specific rules from `src/auth/AuthGate.css` into `src/auth/AdminToolbar.css`. Import `./AdminToolbar.css` in `AdminToolbar.tsx`.

- [ ] **Step 5: Run lint and build**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/auth/AdminToolbar.tsx src/auth/AdminToolbar.css src/auth/AuthGate.tsx src/auth/AuthGate.css docs/EDIT_LOG.md
  git commit -m "refactor: extract AdminToolbar component from AuthGate"
  ```

---

### Task 8: Add error observability — replace silent catch blocks with a centralized error logger

**Severity:** 🟡 MEDIUM  
**Effort:** 1 hour  
**Files:**
- Create: `src/data/storage/errorLogger.ts`
- Modify: `src/data/population/populationStorage.ts` (key silent catches)
- Modify: `src/data/distribution/distributionStorage.ts` (if applicable)
- Modify: `docs/EDIT_LOG.md`

**Context:**  
The codebase has dozens of `catch { /* ignore */ }` and `catch { return []; }` blocks — errors disappear silently with no visibility. In a production-style QC app where data integrity matters, silent failures can cause confusing UX. A centralized in-memory error log (ring buffer, last 50 entries) allows the admin's Settings tab to display recent errors without breaking the no-backend constraint.

**Acceptance Criteria:**
- `src/data/storage/errorLogger.ts` provides `logError(context: string, error: unknown): void` and `getRecentErrors(): ErrorEntry[]`
- At least the three key silent-failure sites in `populationStorage.ts` call `logError`
- `getRecentErrors()` is accessible in the Settings tab (display is a Phase 4 item; here we just wire up logging)
- `npm run test:run` passes

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Create `src/data/storage/errorLogger.ts`**

  ```ts
  export type ErrorEntry = {
    context: string;
    message: string;
    timestamp: string;
  };

  const MAX_ENTRIES = 50;
  const entries: ErrorEntry[] = [];

  export function logError(context: string, error: unknown): void {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    entries.push({ context, message, timestamp: new Date().toISOString() });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  }

  export function getRecentErrors(): ErrorEntry[] {
    return entries.slice();
  }

  export function clearErrors(): void {
    entries.length = 0;
  }
  ```

- [ ] **Step 3: Write a test for errorLogger**

  Create `src/data/storage/errorLogger.test.ts`:
  ```ts
  import { describe, it, expect, beforeEach } from "vitest";
  import { clearErrors, getRecentErrors, logError } from "./errorLogger";

  beforeEach(() => clearErrors());

  describe("errorLogger", () => {
    it("stores logged errors", () => {
      logError("test-context", new Error("boom"));
      const errs = getRecentErrors();
      expect(errs).toHaveLength(1);
      expect(errs[0].context).toBe("test-context");
      expect(errs[0].message).toBe("boom");
    });

    it("caps at 50 entries", () => {
      for (let i = 0; i < 60; i++) logError("ctx", new Error(`err${i}`));
      expect(getRecentErrors()).toHaveLength(50);
    });

    it("clearErrors empties the log", () => {
      logError("ctx", "oops");
      clearErrors();
      expect(getRecentErrors()).toHaveLength(0);
    });
  });
  ```

  Run: `npx vitest run src/data/storage/errorLogger.test.ts`
  Expected: FAIL (module not found — that's expected until Step 2 is done; re-run after creating the module).

- [ ] **Step 4: Apply `logError` to silent catches in `populationStorage.ts`**

  Import `logError` at the top of `populationStorage.ts`:
  ```ts
  import { logError } from "../storage/errorLogger";
  ```

  Replace key silent catch blocks, for example `saveBinaryFile`:
  ```ts
  } catch (error) {
    logError("saveBinaryFile", error);
  }
  ```

  And in `listMonthFolders`:
  ```ts
  } catch (error) {
    logError("listMonthFolders", error);
    return [];
  }
  ```

- [ ] **Step 5: Run tests**

  Run: `npm run test:run`
  Expected: all pass.

- [ ] **Step 6: Validate**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/data/storage/errorLogger.ts src/data/storage/errorLogger.test.ts src/data/population/populationStorage.ts docs/EDIT_LOG.md
  git commit -m "feat: add centralized error logger, wire up key silent catches in populationStorage"
  ```

---

## Phase 3 — Testing Coverage

---

### Task 9: Add React component smoke tests for the login flow

**Severity:** 🟡 MEDIUM  
**Effort:** 1.5 hours  
**Files:**
- Create: `src/auth/AuthGate.test.tsx`
- Modify: `package.json` (add `@testing-library/react` and `jsdom` vitest env)
- Modify: `docs/EDIT_LOG.md`

**Context:**  
There are zero React component tests. The auth flow is the most business-critical user-facing code; a regression there blocks all users. `@testing-library/react` with Vitest's `jsdom` environment enables component testing without a real browser.

**Acceptance Criteria:**
- `@testing-library/react` and `jsdom` are installed as dev dependencies
- Tests verify: login form renders, incorrect password shows error, correct password renders children
- `npm run test:run` passes

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Install dependencies**

  Run: `npm install --save-dev @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom`
  Expected: packages installed.

- [ ] **Step 3: Configure Vitest for jsdom**

  In `vite.config.ts`, add a `test` section:
  ```ts
  import { defineConfig } from "vite";
  import react from "@vitejs/plugin-react";
  import { viteSingleFile } from "vite-plugin-singlefile";

  export default defineConfig({
    plugins: [react(), viteSingleFile()],
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: undefined,
          inlineDynamicImports: true,
        },
      },
    },
    test: {
      environment: "node",  // default for existing tests
      // Override per file using /* @vitest-environment jsdom */ at the top
    },
  });
  ```

- [ ] **Step 4: Write the failing tests**

  Create `src/auth/AuthGate.test.tsx` with `/* @vitest-environment jsdom */` at the top:
  ```tsx
  /* @vitest-environment jsdom */
  import { describe, it, expect, vi, beforeEach } from "vitest";
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";
  import "@testing-library/jest-dom";
  import AuthGate from "./AuthGate";
  import * as userManagement from "./userManagement";
  import * as authSession from "./authSession";
  import * as passwordCrypto from "./passwordCrypto";

  // Minimal mock workspace context
  vi.mock("../data/workspace/useWorkspace", () => ({
    useWorkspace: () => ({ selectWorkspace: vi.fn() }),
  }));

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authSession, "readRealSession").mockReturnValue(null);
  });

  describe("AuthGate — login form", () => {
    it("renders login form when no active session and users exist", () => {
      vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
        {
          id: "u1", username: "testuser", displayName: "Test", role: "employee",
          passwordHash: { algorithm: "argon2id", encoded: "x" },
          isActive: true, hasCertScanLicense: false,
          createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
        },
      ]);

      render(<AuthGate>{() => <div>authenticated</div>}</AuthGate>);
      expect(screen.getByLabelText("اسم المستخدم")).toBeInTheDocument();
      expect(screen.getByLabelText("كلمة المرور")).toBeInTheDocument();
    });

    it("shows error message on wrong password", async () => {
      vi.spyOn(userManagement, "getManagedLoginUsers").mockReturnValue([
        {
          id: "u1", username: "testuser", displayName: "Test", role: "employee",
          passwordHash: { algorithm: "argon2id", encoded: "x" },
          isActive: true, hasCertScanLicense: false,
          createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
        },
      ]);
      vi.spyOn(passwordCrypto, "verifyPasswordHash").mockResolvedValue(false);

      render(<AuthGate>{() => <div>authenticated</div>}</AuthGate>);
      fireEvent.change(screen.getByLabelText("اسم المستخدم"), { target: { value: "testuser" } });
      fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong" } });
      fireEvent.click(screen.getByRole("button", { name: "دخول" }));

      await waitFor(() => {
        expect(screen.getByText(/اسم المستخدم غير موجود/)).toBeInTheDocument();
      });
    });
  });
  ```

  Run: `npx vitest run src/auth/AuthGate.test.tsx`
  Expected: FAIL (jsdom environment setup and mocking to validate).

- [ ] **Step 5: Fix until tests pass**

  Iterate on mock setup and environment config until:
  Run: `npx vitest run src/auth/AuthGate.test.tsx`
  Expected: PASS — at least 2 tests green.

- [ ] **Step 6: Run all tests**

  Run: `npm run test:run`
  Expected: all tests pass (existing node-env tests unaffected).

- [ ] **Step 7: Commit**

  ```bash
  git add src/auth/AuthGate.test.tsx vite.config.ts package.json package-lock.json docs/EDIT_LOG.md
  git commit -m "test: add AuthGate component smoke tests with jsdom environment"
  ```

---

### Task 10: Add distribution storage integration test

**Severity:** 🟡 MEDIUM  
**Effort:** 45 min  
**Files:**
- Create: `src/data/distribution/distributionStorage.test.ts`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
`distributionStorage.ts` (which handles append-only event log persistence) has no tests. Only `distributionLog.ts` (the pure derivation function) is tested. A bug in `appendDistributionEvent` would silently drop events or corrupt the log.

**Acceptance Criteria:**
- Tests cover: append a single event to an empty log, append multiple events, verify derived state matches
- `npm run test:run` passes

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Write the failing tests**

  Create `src/data/distribution/distributionStorage.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { createMemoryDirectory } from "../storage/memoryDirectory";
  import { appendDistributionEvent, loadDistributionLog } from "./distributionStorage";
  import { buildAssignEvent } from "./distributionLog";
  import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

  async function makeRoot() {
    return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  }

  describe("distributionStorage", () => {
    it("starts with an empty log", async () => {
      const root = await makeRoot();
      const log = await loadDistributionLog(root, "5-May-2026");
      expect(log.events).toHaveLength(0);
    });

    it("appends a single event and reads it back", async () => {
      const root = await makeRoot();
      const evt = buildAssignEvent({
        xrayImageId: "img-001",
        assignedTo: "alice",
        eventBy: "admin",
      });
      await appendDistributionEvent(root, "5-May-2026", evt);
      const log = await loadDistributionLog(root, "5-May-2026");
      expect(log.events).toHaveLength(1);
      expect(log.events[0].xrayImageId).toBe("img-001");
    });

    it("appends multiple events sequentially", async () => {
      const root = await makeRoot();
      const evts = ["img-001", "img-002", "img-003"].map((id) =>
        buildAssignEvent({ xrayImageId: id, assignedTo: "alice", eventBy: "admin" })
      );
      for (const evt of evts) {
        await appendDistributionEvent(root, "5-May-2026", evt);
      }
      const log = await loadDistributionLog(root, "5-May-2026");
      expect(log.events).toHaveLength(3);
    });
  });
  ```

  Run: `npx vitest run src/data/distribution/distributionStorage.test.ts`
  Expected: FAIL (module interface mismatch to discover — adjust import paths as needed).

- [ ] **Step 3: Fix until tests pass**

  Adjust imports to match the actual exported function signatures in `distributionStorage.ts`.

  Run: `npx vitest run src/data/distribution/distributionStorage.test.ts`
  Expected: PASS — all 3 tests green.

- [ ] **Step 4: Run all tests**

  Run: `npm run test:run`
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/data/distribution/distributionStorage.test.ts docs/EDIT_LOG.md
  git commit -m "test: add distributionStorage integration tests"
  ```

---

## Phase 4 — Performance & UX Improvements

---

### Task 11: Parallelize `listMonthSummaries` month loading

**Severity:** 🟡 MEDIUM  
**Effort:** 30 min  
**Files:**
- Modify: `src/data/population/populationStorage.ts`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
`listMonthSummaries` (line 294) iterates months sequentially with a `for...of` loop, making N serial read requests. For a workspace with 12 months of data, this is 12× slower than it needs to be. Converting to `Promise.all` across months is safe because reads don't depend on each other.

**Acceptance Criteria:**
- Month summaries are loaded in parallel with `Promise.allSettled`
- Behavior for inaccessible months (caught individually) is unchanged
- Existing tests pass

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Refactor `listMonthSummaries` to parallel**

  Replace the `for (const info of infos)` loop with:
  ```ts
  const settled = await Promise.allSettled(
    infos.map(async (info) => {
      // ... (move entire try-block body here, return the MonthSummary object)
    })
  );
  const results: MonthSummary[] = settled
    .filter((r): r is PromiseFulfilledResult<MonthSummary> => r.status === "fulfilled")
    .map((r) => r.value);
  return results.reverse();
  ```

- [ ] **Step 3: Run tests**

  Run: `npm run test:run`
  Expected: all pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/data/population/populationStorage.ts docs/EDIT_LOG.md
  git commit -m "perf: parallelize listMonthSummaries with Promise.allSettled"
  ```

---

### Task 12: Surface recent errors in Settings tab

**Severity:** 🟢 LOW  
**Effort:** 45 min  
**Files:**
- Modify: `src/components/Sidebar/Tabs/Settings/index.tsx`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
Phase 2 Task 8 wired up the error logger. This task surfaces the log in the admin Settings tab so admins can see what's been failing silently — a significant observability win with very little effort.

**Acceptance Criteria:**
- Settings tab (admin-only) shows a collapsible "سجل الأخطاء الأخيرة" section
- Each entry shows: timestamp, context, message
- "مسح السجل" button calls `clearErrors()`
- Section is hidden when `getRecentErrors()` returns empty array

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Add the error log section to Settings**

  In `src/components/Sidebar/Tabs/Settings/index.tsx`, import `getRecentErrors` and `clearErrors` from `src/data/storage/errorLogger`:
  ```ts
  import { clearErrors, getRecentErrors, type ErrorEntry } from "../../../../data/storage/errorLogger";
  ```

  Add state:
  ```tsx
  const [errors, setErrors] = useState<ErrorEntry[]>(() => getRecentErrors());
  ```

  Add a "Refresh" handler and render:
  ```tsx
  {errors.length > 0 && (
    <section>
      <h3>سجل الأخطاء الأخيرة</h3>
      <button type="button" onClick={() => { clearErrors(); setErrors([]); }}>
        مسح السجل
      </button>
      <ul>
        {errors.map((e, i) => (
          <li key={i} style={{ fontSize: 12, marginBottom: 4 }}>
            <strong>{e.timestamp.slice(0, 19)}</strong> — [{e.context}] {e.message}
          </li>
        ))}
      </ul>
    </section>
  )}
  ```

- [ ] **Step 3: Validate**

  Run: `npm run lint && npm run build`
  Expected: zero errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/Sidebar/Tabs/Settings/index.tsx docs/EDIT_LOG.md
  git commit -m "feat: surface recent errors in Settings tab for admin observability"
  ```

---

### Task 13: Add `JsonEnvelope` schema versioning to new writes

**Severity:** 🟡 MEDIUM  
**Effort:** 1.5 hours  
**Files:**
- Create: `src/data/storage/jsonEnvelope.ts`
- Modify: `src/data/storage/safeWrite.ts`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
CLAUDE.md specifies `JsonEnvelope<TData>` wrapping every JSON file with `{ metadata: { schemaVersion, revision, contentHash, ... }, data }`. The current implementation writes bare data objects with no schema version. Adding this now (for new writes) enables future schema migrations. The approach should be additive: `safeWriteJson` wraps in the envelope; `safeReadJson` accepts both bare data (legacy) and enveloped data (new format).

**Acceptance Criteria:**
- `src/data/storage/jsonEnvelope.ts` exports `wrap<T>` and `unwrap<T>` 
- `wrap` adds `{ metadata: { schemaVersion: 1, revision, contentHash, writtenAt }, data }`
- `unwrap` detects envelope presence and returns `data`; for bare files, returns the file content directly
- `safeWriteJson` uses `wrap` before serializing
- `safeReadJson` uses `unwrap` after parsing
- Existing tests pass (bare-data legacy files still readable)

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Create `jsonEnvelope.ts`**

  Create `src/data/storage/jsonEnvelope.ts`:
  ```ts
  export const ENVELOPE_SCHEMA_VERSION = 1;

  export type JsonMetadata = {
    schemaVersion: number;
    revision: number;
    contentHash: string;
    writtenAt: string;
  };

  export type JsonEnvelope<TData> = {
    metadata: JsonMetadata;
    data: TData;
  };

  function simpleHash(content: string): string {
    let h = 5381;
    for (let i = 0; i < content.length; i++) {
      h = ((h << 5) + h) ^ content.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  }

  export function wrap<T>(
    data: T,
    previousRevision = 0
  ): JsonEnvelope<T> {
    const serialized = JSON.stringify(data);
    return {
      metadata: {
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        revision: previousRevision + 1,
        contentHash: simpleHash(serialized),
        writtenAt: new Date().toISOString(),
      },
      data,
    };
  }

  export function isEnvelope(value: unknown): value is JsonEnvelope<unknown> {
    return (
      typeof value === "object" &&
      value !== null &&
      "metadata" in value &&
      "data" in value &&
      typeof (value as JsonEnvelope<unknown>).metadata?.schemaVersion === "number"
    );
  }

  export function unwrap<T>(value: unknown): T {
    if (isEnvelope(value)) {
      return (value as JsonEnvelope<T>).data;
    }
    return value as T;
  }
  ```

- [ ] **Step 3: Write tests for jsonEnvelope**

  Create `src/data/storage/jsonEnvelope.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { isEnvelope, unwrap, wrap } from "./jsonEnvelope";

  describe("jsonEnvelope", () => {
    it("wrap produces an envelope with metadata", () => {
      const result = wrap({ name: "test" });
      expect(result.metadata.schemaVersion).toBe(1);
      expect(result.metadata.revision).toBe(1);
      expect(result.data).toEqual({ name: "test" });
    });

    it("isEnvelope returns true for wrapped objects", () => {
      expect(isEnvelope(wrap({ x: 1 }))).toBe(true);
    });

    it("isEnvelope returns false for bare objects", () => {
      expect(isEnvelope({ name: "test" })).toBe(false);
    });

    it("unwrap returns data from envelope", () => {
      const env = wrap({ val: 42 });
      expect(unwrap(env)).toEqual({ val: 42 });
    });

    it("unwrap returns value as-is when not an envelope (legacy)", () => {
      expect(unwrap({ val: 42 })).toEqual({ val: 42 });
    });

    it("increments revision from previous", () => {
      const first = wrap({ x: 1 }, 0);
      const second = wrap({ x: 2 }, first.metadata.revision);
      expect(second.metadata.revision).toBe(2);
    });
  });
  ```

  Run: `npx vitest run src/data/storage/jsonEnvelope.test.ts`
  Expected: PASS.

- [ ] **Step 4: Integrate into `safeWrite.ts`**

  In `src/data/storage/safeWrite.ts`, import `wrap` and `unwrap`:
  ```ts
  import { wrap, unwrap } from "./jsonEnvelope";
  ```

  In `safeWriteJson`, replace:
  ```ts
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  ```
  with:
  ```ts
  const serialized = `${JSON.stringify(wrap(value), null, 2)}\n`;
  ```

  In `safeReadJson`, after `JSON.parse(live as string)`:
  ```ts
  value: unwrap<T>(JSON.parse(live as string)),
  ```
  (Apply same to the `.bak` recovery path.)

- [ ] **Step 5: Run all tests**

  Run: `npm run test:run`
  Expected: all pass (existing tests use `createMemoryDirectory` which reads back via `safeReadJson`, so `unwrap` must handle legacy bare data — verified by Step 3 tests).

- [ ] **Step 6: Build**

  Run: `npm run build`
  Expected: succeeds.

- [ ] **Step 7: Commit**

  ```bash
  git add src/data/storage/jsonEnvelope.ts src/data/storage/jsonEnvelope.test.ts src/data/storage/safeWrite.ts docs/EDIT_LOG.md
  git commit -m "feat: add JsonEnvelope schema versioning to safeWriteJson / safeReadJson"
  ```

---

## Phase 5 — Documentation & Maintainability

---

### Task 14: Update CLAUDE.md to accurately reflect current architecture

**Severity:** 🟢 LOW  
**Effort:** 30 min  
**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/EDIT_LOG.md`

**Context:**  
After completing Phases 1–4, several CLAUDE.md sections will be stale or inaccurate:
- Session storage (now correctly described as runtime-only — done in Task 1)
- `JsonEnvelope` (now implemented — done in Task 13)
- Error logger (new module added in Task 8)
- Login throttle (new behavior added in Task 3)
- Focus trap (new behavior in Task 4)

**Acceptance Criteria:**
- CLAUDE.md architecture section accurately describes all implemented features
- No references to features that no longer exist (e.g., `SESSION_KEY`)
- New modules (`errorLogger.ts`, `jsonEnvelope.ts`, `AdminToolbar.tsx`) appear in the relevant tables

- [ ] **Step 1: Log the edit in `docs/EDIT_LOG.md`**

- [ ] **Step 2: Update the Auth section of CLAUDE.md**

  Add to the auth architecture notes:
  - Login attempt throttle: 3 consecutive failures triggers a 30-second lockout (UI-only, no persistence)
  - `AdminToolbar.tsx` — extracted role-preview toolbar component

- [ ] **Step 3: Update the Data-layer modules table**

  Add rows:
  | `errorLogger` | `src/data/storage/errorLogger.ts` | In-memory ring buffer (last 50) for silent-catch observability |
  | `jsonEnvelope` | `src/data/storage/jsonEnvelope.ts` | Schema versioning wrapper for all `safeWriteJson` writes |

- [ ] **Step 4: Commit**

  ```bash
  git add CLAUDE.md docs/EDIT_LOG.md
  git commit -m "docs: update CLAUDE.md to reflect Phase 1-4 changes"
  ```

---

## Phase 6 — Enterprise Readiness Verification

*Run after all phases are complete.*

---

### Task 15: Full regression verification checklist

**Severity:** N/A (verification only)  
**Effort:** 1 hour  
**Files:** None (read-only verification)

- [ ] **Security**
  - [ ] `grep -r "SESSION_KEY" src/` returns zero hits
  - [ ] Login throttle: 3 bad attempts locks submit for 30 seconds
  - [ ] Admin passcode modal: Tab/Shift-Tab stays within modal
  - [ ] Admin passcode input has `aria-label`
  - [ ] Bootstrap admin hash is Argon2id (not PBKDF2)

- [ ] **Data Integrity**
  - [ ] `safeWriteJson` writes envelope-wrapped JSON; re-read via `safeReadJson` returns original data
  - [ ] `safeReadJson` falls back to `.bak` on corrupt live file (verified by existing `safeWrite.test.ts`)
  - [ ] `deriveCurrentDistribution` produces correct state for multi-event sequences (verified by `distributionLog.test.ts`)

- [ ] **Tests**
  - [ ] `npm run test:run` — all tests pass with zero failures
  - [ ] New test files: `errorLogger.test.ts`, `jsonEnvelope.test.ts`, `distributionStorage.test.ts`, `AuthGate.test.tsx`

- [ ] **Build**
  - [ ] `npm run build` — produces single `dist/index.html`, no errors
  - [ ] `npm run lint` — zero ESLint errors

- [ ] **Accessibility**
  - [ ] All form inputs have associated labels or `aria-label`
  - [ ] Admin passcode modal traps focus
  - [ ] `aria-live="polite"` on error messages

- [ ] **Performance**
  - [ ] `listMonthSummaries` uses `Promise.allSettled` (verify in code)
  - [ ] Error logger caps at 50 entries (verified by `errorLogger.test.ts`)

- [ ] **Observability**
  - [ ] Settings tab (admin) shows error log section when errors exist
  - [ ] Key silent catches in `populationStorage.ts` call `logError`

- [ ] **Documentation**
  - [ ] CLAUDE.md architecture section matches implementation
  - [ ] All phases logged in `docs/EDIT_LOG.md`

---

## Findings Not Addressed (Deferred / Out of Scope)

| Finding | Reason Deferred |
|---------|-----------------|
| Population tab `index.tsx` is a god component (~600+ lines) | Major refactor; requires deep understanding of all 4-phase state transitions. Defer to dedicated sprint. |
| `sampleAlgorithm.ts` backward-compat branch (lines 67–167) | Remove only after confirming no workspace has old `totalSampleSize`-format sample files in the wild. |
| DataTable virtual scrolling for large datasets | Requires a third-party library (`react-virtual`); significant UX testing needed. |
| Distribution event log unbounded growth | Requires a compaction strategy decision (business logic); flag for product owner. |
| CI/CD pipeline (GitHub Actions) | No remote repo configured; out of scope for this plan. |
| No `aria-live` on workspace/loading states in WorkspaceGate | Lower priority; component is transitional, not a primary interaction point. |

---

## Implementation Priority Summary

| Phase | Tasks | Effort | Risk |
|-------|-------|--------|------|
| Phase 1 (Security & Correctness) | 1–4 | ~2.5 hrs | Low — mostly additive |
| Phase 2 (Code Quality) | 5–8 | ~3 hrs | Low — refactor only |
| Phase 3 (Testing) | 9–10 | ~2.5 hrs | Low — test-only |
| Phase 4 (Performance & UX) | 11–13 | ~3 hrs | Low — additive |
| Phase 5 (Docs) | 14 | 0.5 hr | None |
| Phase 6 (Verification) | 15 | 1 hr | None |
| **Total** | **15 tasks** | **~13 hrs** | **Low** |
