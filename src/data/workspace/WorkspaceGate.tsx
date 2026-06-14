import type { ReactNode } from "react";

import type { AuthSession } from "../../auth/authTypes";
import { useWorkspace } from "./useWorkspace";

type WorkspaceGateProps = {
  session: AuthSession;
  children: ReactNode;
};

export function WorkspaceGate({ session, children }: WorkspaceGateProps) {
  const {
    status,
    message,
    pendingReconnect,
    missingItems,
    isSupported,
    selectWorkspace,
    reconnectWorkspace,
    createInitialStructure
  } = useWorkspace();

  // Browser doesn't support File System Access API
  if (!isSupported || status === "unsupported_browser") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <h2>متصفح غير مدعوم</h2>
          <p>هذا التطبيق يتطلب Chrome أو Edge على سطح المكتب للوصول إلى الملفات.</p>
          <p>يُرجى فتح التطبيق في Google Chrome أو Microsoft Edge.</p>
        </div>
      </div>
    );
  }

  // Ready — render the app
  if (status === "ready") {
    return <>{children}</>;
  }

  // Checking in progress
  if (status === "checking") {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <p className="workspace-gate-status">{message}</p>
        </div>
      </div>
    );
  }

  // Missing structure — offer to create if admin
  if (status === "missing_structure") {
    const isAdmin = session.role === "admin";
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <h2>بنية مساحة العمل غير مكتملة</h2>
          <p>{message}</p>
          {missingItems.length > 0 && (
            <ul className="workspace-gate-missing">
              {missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {isAdmin ? (
            <button
              type="button"
              onClick={() => void createInitialStructure(session.username)}
            >
              إنشاء بنية مساحة العمل
            </button>
          ) : (
            <p className="workspace-gate-hint">
              تواصل مع المسؤول لإنشاء بنية مساحة العمل.
            </p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() => void selectWorkspace()}
          >
            اختيار مجلد آخر
          </button>
        </div>
      </div>
    );
  }

  // Error, permission denied, invalid structure
  if (
    status === "error" ||
    status === "permission_denied" ||
    status === "invalid_structure"
  ) {
    return (
      <div className="workspace-gate" dir="rtl">
        <div className="workspace-gate-card">
          <h2>تعذر فتح مساحة العمل</h2>
          <p>{message}</p>
          <button type="button" onClick={() => void selectWorkspace()}>
            اختيار مجلد
          </button>
        </div>
      </div>
    );
  }

  // not_selected — initial state or pending reconnect
  return (
    <div className="workspace-gate" dir="rtl">
      <div className="workspace-gate-card">
        <h2>مساحة العمل</h2>
        <p>
          {pendingReconnect
            ? "تم العثور على مساحة عمل سابقة. انقر لإعادة الاتصال."
            : "اختر مجلد مساحة العمل للبدء."}
        </p>
        {pendingReconnect && (
          <button type="button" onClick={() => void reconnectWorkspace()}>
            إعادة الاتصال بمساحة العمل
          </button>
        )}
        <button
          type="button"
          className={pendingReconnect ? "secondary" : undefined}
          onClick={() => void selectWorkspace()}
        >
          اختيار مجلد جديد
        </button>
      </div>
    </div>
  );
}
