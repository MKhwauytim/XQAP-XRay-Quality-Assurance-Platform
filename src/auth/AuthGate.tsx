import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent
} from "react";

import "./AuthGate.css";

import { AdminToolbar } from "./AdminToolbar";
import {
  ADMIN_SHORTCUT_KEYS,
  BOOTSTRAP_ADMIN_PASSWORD_HASH,
  BOOTSTRAP_ADMIN_USERNAME,
  VIEWER_USERNAME
} from "./authConfig";

import {
  clearSession,
  readPreviewRole,
  readRealSession,
  setPreviewRole,
  writeSession
} from "./authSession";
import {
  configureAuthActivityLogWorkspace,
  endAuthActivitySession,
  recordAuthActivityHeartbeat,
} from "./authActivityLog";
import type { AuthRole, AuthSession, MessageType } from "./authTypes";
import {
  createPasswordHash,
  needsRehash,
  verifyPasswordHash
} from "./passwordCrypto";
import {
  clearLastLoginUsername,
  readLastLoginUsername,
  writeLastLoginUsername
} from "./loginPersistence";
import {
  getManagedLoginUsers,
  normalizeUsername,
  persistUserPasswordHash,
  subscribeToUserManagementChanges,
  type ManagedLoginUser
} from "./userManagement";
import { ORGANIZATION_PATH_TEXT } from "../branding/organization";
import { DEMO_WORKSPACE_NAME } from "../data/workspace/demoWorkspace";
import { useWorkspace } from "../data/workspace/useWorkspace";

type AuthGateProps = {
  children: ReactNode | ((session: AuthSession) => ReactNode);
};

const ADMIN_ROLE: AuthRole = "admin";

function createSession(role: AuthRole, username: string): AuthSession {
  return {
    role,
    username,
    loginAt: new Date().toISOString()
  };
}

function isBootstrapAdminSession(session: AuthSession): boolean {
  return (
    session.role === ADMIN_ROLE && session.username === BOOTSTRAP_ADMIN_USERNAME
  );
}

function getInitialSession(): AuthSession | null {
  const storedSession = readRealSession();

  if (!storedSession) {
    return null;
  }

  if (isBootstrapAdminSession(storedSession)) {
    return storedSession;
  }

  const userStillExists = getManagedLoginUsers().some(
    (user) =>
      user.username === storedSession.username &&
      user.role === storedSession.role &&
      user.isActive
  );

  if (!userStillExists) {
    clearSession();
    return null;
  }

  return storedSession;
}

function normalizeShortcutKey(key: string): string {
  return key.trim().toLowerCase();
}

function isAdminShortcutSequence(sequence: string): boolean {
  return sequence === "at" || sequence === "شف";
}

export default function AuthGate({ children }: AuthGateProps) {
  const {
    directoryHandle,
    status: workspaceStatus,
    selectWorkspace,
    clearWorkspace
  } = useWorkspace();
  const [session, setSession] = useState<AuthSession | null>(getInitialSession);
  const [managedUsers, setManagedUsers] = useState<ManagedLoginUser[]>(() =>
    getManagedLoginUsers()
  );

  const [selectedUsername, setSelectedUsername] = useState(readLastLoginUsername);
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<MessageType>("");

  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState("");

  // Admin-only role-preview override (impersonate a role to test its view/permissions).
  const [previewRole, setPreviewRoleState] = useState<AuthRole | null>(() =>
    readPreviewRole()
  );

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);

  const LOCKOUT_AFTER_ATTEMPTS = 3;
  const LOCKOUT_DURATION_MS = 30_000;

  const altSequenceRef = useRef<string[]>([]);
  const altSequenceTimerRef = useRef<number | null>(null);

  const adminModalRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const isDemoSessionRef = useRef(false);

  // Derive whether there are any active users (to decide which form to show)
  const hasConfiguredUsers = managedUsers.some((user) => user.isActive);

  useEffect(() => {
    configureAuthActivityLogWorkspace(
      workspaceStatus === "ready" ? directoryHandle : null
    );
  }, [directoryHandle, workspaceStatus]);

  // Auto-login for the demo/viewer account: when the picker mounts the in-memory
  // demo workspace, enter the read-only demo session directly — no login form.
  // Keyed on the demo handle's name so it survives React StrictMode remounts;
  // logout unmounts the workspace, so it can't re-fire after the user leaves.
  useEffect(() => {
    if (!session && directoryHandle?.name === DEMO_WORKSPACE_NAME) {
      isDemoSessionRef.current = true;
      const demoSession: AuthSession = {
        role: ADMIN_ROLE,
        username: VIEWER_USERNAME,
        loginAt: new Date().toISOString(),
        mode: "demo"
      };
      // LOG-01: register the session with the authSession module too, so
      // permission checks (usePermissions → readSession) agree with the UI.
      writeSession(demoSession);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derive the demo session from the mounted demo workspace; guarded by !session so it settles in one step
      setSession(demoSession);
    }
  }, [directoryHandle, session]);

  useEffect(() => {
    return subscribeToUserManagementChanges(() => {
      const nextUsers = getManagedLoginUsers();
      setManagedUsers(nextUsers);

      setSession((currentSession) => {
        if (!currentSession || isBootstrapAdminSession(currentSession)) {
          return currentSession;
        }

        const userStillExists = nextUsers.some(
          (user) =>
            user.username === currentSession.username &&
            user.role === currentSession.role &&
            user.isActive
        );

        if (!userStillExists) {
          clearSession();
          return null;
        }

        return currentSession;
      });
    });
  }, []);

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

  useEffect(() => {
    if (!session) return;

    recordAuthActivityHeartbeat();
    const heartbeatId = window.setInterval(recordAuthActivityHeartbeat, 60_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") recordAuthActivityHeartbeat();
    };
    const handlePageHide = () => {
      endAuthActivitySession("page-closed");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [session]);

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

  const logout = useCallback((): void => {
    if (isDemoSessionRef.current) {
      isDemoSessionRef.current = false;
      clearWorkspace();
    }
    clearSession();

    setSession(null);
    setPreviewRoleState(null);
    setSelectedUsername(readLastLoginUsername());
    setPassword("");
    setAdminPasscode("");
    setIsAdminModalOpen(false);
    setMessage("");
    setMessageType("");
    setFailedAttempts(0);
    setLockoutUntil(null);
  }, [clearWorkspace]);

  // Switch the previewed role (admin only). Selecting "admin" exits preview mode.
  const changePreviewRole = useCallback((role: AuthRole): void => {
    const next = role === ADMIN_ROLE ? null : role;
    setPreviewRole(next);
    setPreviewRoleState(next);
  }, []);

  useEffect(() => {
    function handleHiddenAdminShortcut(event: KeyboardEvent) {
      if (!event.altKey) {
        return;
      }

      const key = normalizeShortcutKey(String(event.key || ""));

      if (
        !ADMIN_SHORTCUT_KEYS.includes(
          key as (typeof ADMIN_SHORTCUT_KEYS)[number]
        )
      ) {
        return;
      }

      event.preventDefault();

      altSequenceRef.current = [...altSequenceRef.current, key].slice(-2);

      if (altSequenceTimerRef.current) {
        window.clearTimeout(altSequenceTimerRef.current);
      }

      altSequenceTimerRef.current = window.setTimeout(() => {
        altSequenceRef.current = [];
      }, 2000);

      const currentSequence = altSequenceRef.current.join("");

      if (isAdminShortcutSequence(currentSequence)) {
        altSequenceRef.current = [];

        if (altSequenceTimerRef.current) {
          window.clearTimeout(altSequenceTimerRef.current);
        }

        triggerRef.current = document.activeElement as HTMLElement | null;
        setAdminPasscode("");
        setMessage("");
        setMessageType("");
        setIsAdminModalOpen(true);
      }
    }

    document.addEventListener("keydown", handleHiddenAdminShortcut, true);

    return () => {
      document.removeEventListener("keydown", handleHiddenAdminShortcut, true);

      if (altSequenceTimerRef.current) {
        window.clearTimeout(altSequenceTimerRef.current);
      }
    };
  }, []);

  function renderAuthenticatedChildren(currentSession: AuthSession): ReactNode {
    if (typeof children === "function") {
      return children(currentSession);
    }

    return children;
  }

  function showMessage(nextMessage: string, nextType: MessageType): void {
    setMessage(nextMessage);
    setMessageType(nextType);
  }

  function applySession(nextSession: AuthSession): void {
    writeSession(nextSession);
    setSession(nextSession);
  }

  async function loginAsEmployee(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (lockoutUntil !== null && Date.now() < lockoutUntil) return;

    const normalizedInput = normalizeUsername(selectedUsername);

    const user = managedUsers.find(
      (item) => normalizeUsername(item.username) === normalizedInput
    );

    if (!user) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      if (next >= LOCKOUT_AFTER_ATTEMPTS) {
        setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
      }
      showMessage("اسم المستخدم غير موجود أو كلمة المرور غير صحيحة.", "bad");
      return;
    }

    if (!user.isActive) {
      showMessage("هذا المستخدم غير مفعل.", "bad");
      return;
    }

    const isPasswordValid = await verifyPasswordHash(
      password,
      user.passwordHash
    );

    if (!isPasswordValid) {
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      if (next >= LOCKOUT_AFTER_ATTEMPTS) {
        setLockoutUntil(Date.now() + LOCKOUT_DURATION_MS);
      }
      showMessage("اسم المستخدم غير موجود أو كلمة المرور غير صحيحة.", "bad");
      return;
    }

    // Transparently upgrade legacy/weak password hashes (e.g. PBKDF2 → Argon2id)
    // now that we hold the plaintext. Non-fatal: keep the old hash on failure.
    if (needsRehash(user.passwordHash)) {
      try {
        const upgraded = await createPasswordHash(password);
        persistUserPasswordHash(user.id, upgraded);
      } catch {
        // ignore — login still succeeds with the existing hash
      }
    }

    const nextSession = createSession(user.role, user.username);
    applySession(nextSession);
    writeLastLoginUsername(user.username);

    setPassword("");
    setFailedAttempts(0);
    setLockoutUntil(null);
    showMessage("تم الدخول بنجاح.", "ok");
  }

  async function loginAsBootstrapAdmin(): Promise<void> {
    const isPasscodeValid = await verifyPasswordHash(
      adminPasscode,
      BOOTSTRAP_ADMIN_PASSWORD_HASH
    );

    if (!isPasscodeValid) {
      showMessage("رمز مسؤول النظام غير صحيح.", "bad");
      return;
    }

    const nextSession = createSession(ADMIN_ROLE, BOOTSTRAP_ADMIN_USERNAME);
    applySession(nextSession);
    writeLastLoginUsername(BOOTSTRAP_ADMIN_USERNAME);

    setAdminPasscode("");
    setIsAdminModalOpen(false);
    showMessage("", "");
  }

  function handleAdminModalKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>
  ): void {
    if (event.key === "Enter") {
      void loginAsBootstrapAdmin();
      return;
    }

    if (event.key === "Escape") {
      closeAdminModal();
    }
  }

  function closeAdminModal(): void {
    setIsAdminModalOpen(false);
    setAdminPasscode("");
    triggerRef.current?.focus();
  }

  function handleLogoError(event: SyntheticEvent<HTMLImageElement>): void {
    const image = event.currentTarget;

    image.style.display = "none";
    image.closest(".auth-logo")?.classList.add("auth-logo-empty");
  }

  if (session) {
    // Only a real admin may impersonate other roles. The effective session (with the
    // role swapped) is what the rest of the app sees; identity/username stay real.
    const isRealAdmin = session.role === ADMIN_ROLE;
    const effectiveRole: AuthRole =
      isRealAdmin && previewRole ? previewRole : session.role;
    const isImpersonating = effectiveRole !== session.role;
    const effectiveSession: AuthSession = isImpersonating
      ? { ...session, role: effectiveRole }
      : session;

    return (
      <>
        <AdminToolbar
          session={session}
          previewRole={previewRole}
          onPreviewRoleChange={changePreviewRole}
          onLogout={logout}
          onFeedback={() => window.dispatchEvent(new CustomEvent("feedback:toggle"))}
        />

        {renderAuthenticatedChildren(effectiveSession)}
      </>
    );
  }

  return (
    <main className="auth-root" dir="rtl">
      <div className="auth-split">

        {/* ── Right panel: branding ─────────────────────────── */}
        <aside className="auth-panel-brand">
          <div className="auth-brand-ring" aria-hidden="true" />
          <div className="auth-brand-inner">
            <div className="auth-logo" aria-label="شعار النظام">
              <img
                src="https://zatca.gov.sa/_layouts/15/zatca/Design/images/ZATCA-logo.svg"
                alt=""
                aria-hidden="true"
                onError={handleLogoError}
              />
            </div>
            <h1>نظام معالجة بيانات الأشعة</h1>
            <p>منصة فحص صور الأشعة</p>
          </div>
          <div className="auth-brand-footer">
            <div className="auth-org-path">{ORGANIZATION_PATH_TEXT}</div>
          </div>
        </aside>

        {/* ── Left panel: form ──────────────────────────────── */}
        <section
          className="auth-panel-form"
          role="dialog"
          aria-modal="true"
          aria-labelledby="authTitle"
        >
          <div className="auth-form-inner">
            <div className="auth-form-header">
              <h2 id="authTitle">تسجيل الدخول</h2>
              <p>أدخل بياناتك للمتابعة</p>
            </div>

            {hasConfiguredUsers ? (
              <form
                className="auth-form"
                autoComplete="off"
                onSubmit={loginAsEmployee}
              >
                <label className="auth-field" htmlFor="authUsername">
                  <span>اسم المستخدم</span>
                  <div className="auth-input-wrap">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                      </svg>
                    </span>
                    <input
                      id="authUsername"
                      type="text"
                      required
                      autoComplete="username"
                      placeholder="أدخل اسم المستخدم"
                      value={selectedUsername}
                      onChange={(event) => {
                        setSelectedUsername(event.target.value);
                      }}
                    />
                  </div>
                </label>

                <label className="auth-field" htmlFor="authPassword">
                  <span>كلمة المرور</span>
                  <div className="auth-input-wrap">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      id="authPassword"
                      type={isPasswordVisible ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      placeholder="أدخل كلمة المرور"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="auth-eye-toggle"
                      onClick={() => setIsPasswordVisible((current) => !current)}
                      aria-label="إظهار أو إخفاء كلمة المرور"
                    >
                      {isPasswordVisible ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </label>

                <button
                  className="auth-submit"
                  type="submit"
                  disabled={lockoutUntil !== null && Date.now() < lockoutUntil}
                >
                  <span>
                    {lockoutUntil !== null && lockoutSecondsLeft > 0
                      ? `يُرجى الانتظار (${lockoutSecondsLeft}ث)`
                      : "دخول"}
                  </span>
                  {!(lockoutUntil !== null && lockoutSecondsLeft > 0) && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  )}
                </button>

                <div
                  className={`auth-message${messageType ? ` ${messageType}` : ""}`}
                  aria-live="polite"
                >
                  {message}
                </div>
              </form>
            ) : (
              <div className="auth-form" aria-live="polite">
                <div className="auth-message bad">
                  لا يوجد مستخدمون مفعلون حالياً.
                </div>
              </div>
            )}

            <footer className="auth-footer">
              <div className="auth-footer-actions">
                <button type="button" className="auth-footer-change" onClick={() => { void selectWorkspace(); }}>
                  تغيير المجلد
                </button>
                <button type="button" onClick={logout}>
                  مسح الجلسة
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearLastLoginUsername();
                    setSelectedUsername("");
                  }}
                >
                  نسيان المستخدم
                </button>
              </div>
            </footer>
          </div>
        </section>

      </div>

      {isAdminModalOpen ? (
        <div className="auth-modal-backdrop" role="presentation">
          <section
            className="auth-admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="adminPasscodeTitle"
            ref={adminModalRef as RefObject<HTMLElement>}
          >
            <h2 id="adminPasscodeTitle">دخول مسؤول النظام</h2>

            <p>أدخل رمز دخول مسؤول النظام.</p>

            <input
              type="password"
              autoFocus
              aria-label="رمز مسؤول النظام"
              value={adminPasscode}
              onChange={(event) => setAdminPasscode(event.target.value)}
              onKeyDown={handleAdminModalKeyDown}
              placeholder="رمز مسؤول النظام"
            />

            <div className="auth-modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={closeAdminModal}
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={() => void loginAsBootstrapAdmin()}
              >
                دخول
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
