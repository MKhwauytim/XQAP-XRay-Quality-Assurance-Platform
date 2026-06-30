import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Folder, FolderArchive, Wrench, XCircle } from "lucide-react";

import type { AuthSession } from "../../auth/authTypes";
import { ADMIN_SHORTCUT_KEYS, VIEWER_PASSWORD } from "../../auth/authConfig";
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
      setViewError("رمز غير صحيح.");
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
          <h2>متصفح غير مدعوم</h2>
          <p>
            هذا التطبيق يتطلب{" "}
            <strong>Google Chrome</strong> أو{" "}
            <strong>Microsoft Edge</strong> على سطح المكتب
            للوصول المباشر إلى الملفات.
          </p>
          <p>يُرجى فتح التطبيق في متصفح مدعوم والمحاولة مجدداً.</p>
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
          <h2>اختر مساحة العمل</h2>
          <p>
            {pendingReconnect
              ? "تم العثور على مساحة عمل سابقة. انقر على «إعادة الاتصال» للمتابعة، أو اختر مجلداً جديداً."
              : "حدد مجلد مساحة العمل. سيطلب المتصفح إذن القراءة والكتابة مرة واحدة فقط."}
          </p>

          {pendingReconnect && (
            <button
              type="button"
              onClick={() => {
                void reconnectWorkspace();
              }}
            >
              إعادة الاتصال بمساحة العمل
            </button>
          )}

          <button
            type="button"
            className={pendingReconnect ? "secondary" : undefined}
            onClick={() => {
              void selectWorkspace();
            }}
          >
            اختيار مجلد
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
              <h2 id="viewPasscodeTitle">وضع العرض</h2>
              <p>أدخل رمز الدخول لعرض النظام للقراءة فقط.</p>
              <input
                type="password"
                autoFocus
                aria-label="رمز وضع العرض"
                value={viewPasscode}
                onChange={(event) => setViewPasscode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitViewPasscode();
                  if (event.key === "Escape") closeViewModal();
                }}
                placeholder="رمز وضع العرض"
              />
              {viewError && (
                <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "8px 0 0" }}>
                  {viewError}
                </p>
              )}
              <div className="auth-modal-actions">
                <button type="button" className="secondary" onClick={closeViewModal}>
                  إلغاء
                </button>
                <button type="button" onClick={submitViewPasscode}>
                  دخول
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

  // Workspace is ready — render the full app
  if (status === "ready") {
    return <>{children}</>;
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
              <h2>مساحة العمل غير مهيأة</h2>
              <p>
                المجلد المحدد لا يحتوي على بنية النظام المطلوبة. يمكنك
                إنشاؤها الآن.
              </p>
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
                إنشاء بنية مساحة العمل
              </button>
            </>
          ) : (
            <>
              <div className="workspace-gate-icon"><AlertTriangle size={40} /></div>
              <h2>عنوان خاطئ</h2>
              <p>
                المجلد المحدد لا يحتوي على بنية نظام صالحة. تأكد من
                اختيار المجلد الصحيح، أو تواصل مع مسؤول النظام لإعداد
                مساحة العمل.
              </p>
            </>
          )}

          <button
            type="button"
            className="secondary"
            onClick={() => {
              void selectWorkspace();
            }}
          >
            اختيار مجلد آخر
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
          <h2>ملفات مساحة العمل تالفة أو غير متوافقة</h2>
          <p>
            تم العثور على المجلد لكن بعض ملفات النظام تالفة أو بإصدار غير متوافق.
            يمكنك إصلاح البنية الآن — لن تتأثر بيانات السكان والعينات في المجلدات المرقمة.
          </p>
          <p style={{ color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "6px 10px", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} /> قد تحتاج إلى إعادة إضافة حسابات الموظفين بعد الإصلاح.
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
            إصلاح بنية مساحة العمل
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void selectWorkspace();
            }}
          >
            اختيار مجلد آخر
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
        <h2>تعذر فتح مساحة العمل</h2>
        <p>{message}</p>
        <button
          type="button"
          onClick={() => {
            void selectWorkspace();
          }}
        >
          اختيار مجلد آخر
        </button>
      </div>
    </div>
  );
}
