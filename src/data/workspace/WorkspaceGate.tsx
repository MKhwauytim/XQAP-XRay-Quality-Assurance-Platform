import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Folder, FolderArchive, Keyboard, Rocket, Wrench, X, XCircle } from "lucide-react";

import type { AuthSession } from "../../auth/authTypes";
import { ADMIN_SHORTCUT_KEYS, VIEWER_PASSWORD } from "../../auth/authConfig";
import {
  createDefaultPermissions,
  getManagedLoginUsers,
  readUserManagementState,
  subscribeToUserManagementChanges,
} from "../../auth/userManagement";
import { listMonthFolders } from "../population/populationStorage";
import { getLabels } from "../labels/labelsStore";
import { useLabels } from "../labels/useLabels";
import { useWorkspace } from "./useWorkspace";

import "./WorkspaceGate.css";

// ─── WorkspacePicker ────────────────────────────────────────────────────────
// Shown BEFORE authentication. Blocks until the user picks a directory and the
// initial structure check completes. Once a directory is selected and checked
// (whatever the result), it renders children so AuthGate can appear.

type WorkspacePickerProps = {
  children: ReactNode;
};

export function WorkspacePicker({ children }: WorkspacePickerProps) {
  const {
    isSupported,
    status,
    message,
    pendingReconnect,
    selectWorkspace,
    reconnectWorkspace,
    enterDemoWorkspace
  } = useWorkspace();
  const labels = useLabels();

  // Hidden view-mode entry (mirrors the admin shortcut): on the address-picker
  // screen, hold Alt and press A then T to open a passcode prompt; entering the
  // view passcode mounts the read-only demo workspace, which then auto-enters
  // view mode. Bound only while the picker is shown, so it can't collide with
  // the admin shortcut on the login screen.
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewPasscode, setViewPasscode] = useState("");
  const [viewError, setViewError] = useState("");
  const altSequenceRef = useRef<string[]>([]);
  const altSequenceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "not_selected") return;

    function handleShortcut(event: KeyboardEvent) {
      if (!event.altKey) return;
      const key = String(event.key || "").trim().toLowerCase();
      if (!(ADMIN_SHORTCUT_KEYS as readonly string[]).includes(key)) return;
      event.preventDefault();

      altSequenceRef.current = [...altSequenceRef.current, key].slice(-2);
      if (altSequenceTimerRef.current) window.clearTimeout(altSequenceTimerRef.current);
      altSequenceTimerRef.current = window.setTimeout(() => {
        altSequenceRef.current = [];
      }, 2000);

      const sequence = altSequenceRef.current.join("");
      if (sequence === "at" || sequence === "شف") {
        altSequenceRef.current = [];
        setViewPasscode("");
        setViewError("");
        setIsViewModalOpen(true);
      }
    }

    document.addEventListener("keydown", handleShortcut, true);
    return () => {
      document.removeEventListener("keydown", handleShortcut, true);
      if (altSequenceTimerRef.current) window.clearTimeout(altSequenceTimerRef.current);
    };
  }, [status]);

  function submitViewPasscode(): void {
    if (viewPasscode === VIEWER_PASSWORD) {
      setIsViewModalOpen(false);
      setViewPasscode("");
      setViewError("");
      void enterDemoWorkspace();
    } else {
      setViewError(getLabels().wsgate_view_passcode_error);
    }
  }

  function closeViewModal(): void {
    setIsViewModalOpen(false);
    setViewPasscode("");
    setViewError("");
  }

  // Browser does not support File System Access API
  if (!isSupported || status === "unsupported_browser") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-icon"><FolderArchive size={40} /></div>
          <h2>{labels.wsgate_unsupported_title}</h2>
          <p>
            {labels.wsgate_unsupported_prefix}{" "}
            <strong>Google Chrome</strong> {labels.wsgate_unsupported_or}{" "}
            <strong>Microsoft Edge</strong> {labels.wsgate_unsupported_suffix}
          </p>
          <p>{labels.wsgate_unsupported_retry}</p>
        </div>
      </div>
    );
  }

  // Checking in progress — show spinner before revealing login
  if (status === "checking") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-spinner" aria-hidden="true" />
          <p className="workspace-gate-status">{message}</p>
        </div>
      </div>
    );
  }

  // No directory selected yet — show the picker UI
  if (status === "not_selected") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-icon"><Folder size={40} /></div>
          <h2>{labels.wsgate_picker_title}</h2>
          <p>
            {pendingReconnect
              ? labels.wsgate_picker_reconnect_msg
              : labels.wsgate_picker_select_msg}
          </p>

          {pendingReconnect && (
            <button
              type="button"
              onClick={() => {
                void reconnectWorkspace();
              }}
            >
              {labels.wsgate_reconnect_btn}
            </button>
          )}

          <button
            type="button"
            className={pendingReconnect ? "secondary" : undefined}
            onClick={() => {
              void selectWorkspace();
            }}
          >
            {labels.wsgate_pick_folder_btn}
          </button>
        </div>

        {isViewModalOpen && (
          <div className="auth-modal-backdrop" role="presentation">
            <section
              className="auth-admin-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="viewPasscodeTitle"
            >
              <h2 id="viewPasscodeTitle">{labels.wsgate_view_modal_title}</h2>
              <p>{labels.wsgate_view_modal_desc}</p>
              <input
                type="password"
                autoFocus
                aria-label={labels.wsgate_view_passcode_label}
                value={viewPasscode}
                onChange={(event) => setViewPasscode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitViewPasscode();
                  if (event.key === "Escape") closeViewModal();
                }}
                placeholder={labels.wsgate_view_passcode_label}
              />
              {viewError && (
                <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "8px 0 0" }}>
                  {viewError}
                </p>
              )}
              <div className="auth-modal-actions">
                <button type="button" className="secondary" onClick={closeViewModal}>
                  {labels.wsgate_cancel_btn}
                </button>
                <button type="button" onClick={submitViewPasscode}>
                  {labels.wsgate_enter_btn}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  // Directory picked and check done (ready / missing / error / etc.) — render
  // children so AuthGate appears next
  return <>{children}</>;
}

// ─── WorkspaceGate ──────────────────────────────────────────────────────────
// Shown AFTER authentication. Reacts to the workspace structure check result
// based on the authenticated session role.
//
// • ready            → renders app children
// • missing_structure:
//     admin          → offer to create the structure
//     other roles    → "عنوان خاطئ" — wrong address, contact admin
// • checking         → spinner (e.g. during createInitialStructure)
// • anything else    → error + re-pick

type WorkspaceGateProps = {
  session: AuthSession;
  children: ReactNode;
};

export function WorkspaceGate({ session, children }: WorkspaceGateProps) {
  const {
    status,
    message,
    missingItems,
    invalidItems,
    selectWorkspace,
    createInitialStructure
  } = useWorkspace();
  const labels = useLabels();

  // Structure creation in progress
  if (status === "checking") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-spinner" aria-hidden="true" />
          <p className="workspace-gate-status">{message}</p>
        </div>
      </div>
    );
  }

  // Workspace is ready — render the full app + (admin-only) first-run checklist
  if (status === "ready") {
    return (
      <>
        {children}
        <FirstRunChecklist session={session} />
      </>
    );
  }

  // Missing structure — role-gated response
  if (status === "missing_structure") {
    const isAdmin = session.role === "admin";

    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          {isAdmin ? (
            <>
              <div className="workspace-gate-icon"><Wrench size={40} /></div>
              <h2>{labels.wsgate_missing_title}</h2>
              <p>{labels.wsgate_missing_desc}</p>
              {missingItems.length > 0 && (
                <ul className="workspace-gate-missing">
                  {missingItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => {
                  void createInitialStructure(session.username);
                }}
              >
                {labels.wsgate_create_structure_btn}
              </button>
            </>
          ) : (
            <>
              <div className="workspace-gate-icon"><AlertTriangle size={40} /></div>
              <h2>{labels.wsgate_wrong_address_title}</h2>
              <p>{labels.wsgate_wrong_address_desc}</p>
            </>
          )}

          <button
            type="button"
            className="secondary"
            onClick={() => {
              void selectWorkspace();
            }}
          >
            {labels.wsgate_pick_another_btn}
          </button>
        </div>
      </div>
    );
  }

  // invalid_structure + admin — offer targeted repair
  if (status === "invalid_structure" && session.role === "admin") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-icon"><Wrench size={40} /></div>
          <h2>{labels.wsgate_invalid_title}</h2>
          <p>{labels.wsgate_invalid_desc}</p>
          <p style={{ color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "6px 10px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {labels.wsgate_invalid_warning}
          </p>
          {invalidItems.length > 0 && (
            <ul className="workspace-gate-missing">
              {invalidItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              void createInitialStructure(session.username);
            }}
          >
            {labels.wsgate_repair_btn}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void selectWorkspace();
            }}
          >
            {labels.wsgate_pick_another_btn}
          </button>
        </div>
      </div>
    );
  }

  // error, permission_denied, invalid_structure (non-admin)
  return (
    <div className="workspace-gate" dir="rtl">
      <div className="workspace-gate-card">
        <div className="workspace-gate-icon"><XCircle size={40} /></div>
        <h2>{labels.wsgate_error_title}</h2>
        <p>{message}</p>
        <button
          type="button"
          onClick={() => {
            void selectWorkspace();
          }}
        >
          {labels.wsgate_pick_another_btn}
        </button>
      </div>
    </div>
  );
}

// ─── FirstRunChecklist (C3) ──────────────────────────────────────────────────
// A light, role-gated onboarding checklist shown ONLY to admins on an empty /
// just-created workspace. Each item reflects REAL workspace state and deep-links
// to the relevant tab. It auto-hides once the workspace has ≥1 imported month
// (regardless of dismissal); manual dismissal persists per workspace in
// localStorage so it doesn't resurrect on reload before the first month exists.
// Non-admins never see it.

const FIRSTRUN_DISMISS_PREFIX = "xray_firstrun_dismissed_v1:";

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Deep-link into the app: switch the top-level tab (App listens on `app-navigate`),
 *  then — deferred so the target tab has mounted its listeners — its sub-tab. */
function navigateToTab(tabId: string, subTabId?: string): void {
  window.dispatchEvent(new CustomEvent("app-navigate", { detail: { tabId } }));
  if (subTabId) {
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("sidebar-subtab-changed", { detail: { parentTabId: tabId, subTabId } }),
      );
      window.dispatchEvent(new CustomEvent("pop-set-subtab", { detail: { subTabId } }));
    }, 80);
  }
}

/** ≥1 user the admin actually created (default seed users use `default-user-` ids). */
function hasNonDefaultUser(): boolean {
  return getManagedLoginUsers().some((u) => !u.id.startsWith("default-user-"));
}

/** True when the role→tab permission matrix differs from the shipped defaults. */
function permissionsAreCustomized(): boolean {
  const defaults = createDefaultPermissions().filter((p) => p.role !== "admin");
  const defMap = new Map(defaults.map((p) => [`${p.role}:${p.tabId}`, p.access]));
  const current = readUserManagementState().permissions.filter((p) => p.role !== "admin");
  for (const p of current) {
    const key = `${p.role}:${p.tabId}`;
    const def = defMap.get(key);
    if (def === undefined || def !== p.access) return true;
    defMap.delete(key);
  }
  // Any default entry missing from the current matrix is also a customization.
  return defMap.size > 0;
}

function FirstRunChecklist({ session }: { session: AuthSession }) {
  const labels = useLabels();
  const { directoryHandle, selectedDirectoryName } = useWorkspace();
  const isAdmin = session.role === "admin";
  const workspaceKey = directoryHandle?.name || selectedDirectoryName || "";
  const dismissKey = FIRSTRUN_DISMISS_PREFIX + workspaceKey;

  const [monthCount, setMonthCount] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed(dismissKey));
  // Bumped on user-management changes to recompute the user/permission steps.
  const [, setTick] = useState(0);

  // Re-read dismissal whenever the workspace identity changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync dismissal flag to the current workspace key
    setDismissed(readDismissed(dismissKey));
  }, [dismissKey]);

  // Keep the user/permission steps live.
  useEffect(() => subscribeToUserManagementChanges(() => setTick((t) => t + 1)), []);

  // Load the month count; refresh when the tab regains focus (e.g. after an import).
  useEffect(() => {
    if (!isAdmin || !directoryHandle) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear when not applicable
      setMonthCount(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void listMonthFolders(directoryHandle)
        .then((list) => {
          if (!cancelled) setMonthCount(list.length);
        })
        .catch(() => {
          if (!cancelled) setMonthCount(0);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [isAdmin, directoryHandle]);

  if (!isAdmin) return null;
  if (monthCount === null) return null; // still loading — avoid a flash
  if (monthCount >= 1) return null; // auto-hide once the first month is imported
  if (dismissed) return null;

  const steps: Array<{ done: boolean; title: string; desc: string; action?: string; onAction?: () => void }> = [
    {
      done: true, // only rendered when status === "ready", i.e. structure exists
      title: labels.firstrun_step_structure_title,
      desc: labels.firstrun_step_structure_desc,
    },
    {
      done: hasNonDefaultUser(),
      title: labels.firstrun_step_users_title,
      desc: labels.firstrun_step_users_desc,
      action: labels.firstrun_step_users_action,
      onAction: () => navigateToTab("user-management", "users"),
    },
    {
      done: permissionsAreCustomized(),
      title: labels.firstrun_step_permissions_title,
      desc: labels.firstrun_step_permissions_desc,
      action: labels.firstrun_step_permissions_action,
      onAction: () => navigateToTab("user-management", "page-permissions"),
    },
    {
      done: false, // monthCount is 0 here (component hides once ≥1)
      title: labels.firstrun_step_month_title,
      desc: labels.firstrun_step_month_desc,
      action: labels.firstrun_step_month_action,
      onAction: () => navigateToTab("population", "process"),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  function dismiss(): void {
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {
      /* non-fatal */
    }
    setDismissed(true);
  }

  return (
    <aside className="firstrun-checklist" dir="rtl" role="complementary" aria-label={labels.firstrun_title}>
      <div className="firstrun-head">
        <div className="firstrun-head-main">
          <span className="firstrun-head-icon"><Rocket size={18} aria-hidden /></span>
          <div>
            <strong>{labels.firstrun_title}</strong>
            <span className="firstrun-subtitle">{labels.firstrun_subtitle}</span>
          </div>
        </div>
        <button type="button" className="firstrun-close" onClick={dismiss} aria-label={labels.firstrun_dismiss}>
          <X size={16} />
        </button>
      </div>

      <div className="firstrun-progress">
        <div className="firstrun-progress-track">
          <div
            className="firstrun-progress-fill"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
        <span className="firstrun-progress-text">
          {doneCount} {labels.firstrun_progress_of} {steps.length}
        </span>
      </div>

      <ol className="firstrun-steps">
        {steps.map((step, i) => (
          <li key={i} className={`firstrun-step${step.done ? " done" : ""}`}>
            <span className="firstrun-step-mark" aria-hidden="true">
              {step.done ? <Check size={14} /> : i + 1}
            </span>
            <div className="firstrun-step-body">
              <strong>{step.title}</strong>
              <span>{step.desc}</span>
            </div>
            {!step.done && step.action && step.onAction && (
              <button type="button" className="firstrun-step-action" onClick={step.onAction}>
                {step.action}
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="firstrun-hint">
        <span className="firstrun-hint-icon"><Keyboard size={14} aria-hidden /></span>
        <span>{labels.firstrun_demo_hint}</span>
      </div>
    </aside>
  );
}
