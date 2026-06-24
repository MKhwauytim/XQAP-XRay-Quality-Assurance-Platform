import type { ReactNode } from "react";

import type { AuthSession } from "../../auth/authTypes";
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
    reconnectWorkspace
  } = useWorkspace();

  // Browser does not support File System Access API
  if (!isSupported || status === "unsupported_browser") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <div className="workspace-gate-icon">🗂️</div>
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
          <div className="workspace-gate-icon">📁</div>
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
              <div className="workspace-gate-icon">🔧</div>
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
              <div className="workspace-gate-icon">⚠️</div>
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
          <div className="workspace-gate-icon">🔧</div>
          <h2>ملفات مساحة العمل تالفة أو غير متوافقة</h2>
          <p>
            تم العثور على المجلد لكن بعض ملفات النظام تالفة أو بإصدار غير متوافق.
            يمكنك إصلاح البنية الآن — لن تتأثر بيانات السكان والعينات في مجلد Population.
          </p>
          <p style={{ color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "6px 10px", fontSize: 13 }}>
            ⚠ قد تحتاج إلى إعادة إضافة حسابات الموظفين بعد الإصلاح.
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
        <div className="workspace-gate-icon">❌</div>
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
