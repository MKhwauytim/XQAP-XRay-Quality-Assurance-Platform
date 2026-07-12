/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { usePermissions } from "../../../../auth/usePermissions";
import { AccessDenied } from "../../../PermissionGuard";
import TemplateBuilderTab from "../TemplateBuilder";
import XrayReferrals from "./views/XrayReferrals";
import XrayInspectionResults from "./views/XrayInspectionResults";
import ReferralApproval from "./views/ReferralApproval";
import NotificationManager from "./views/NotificationManager";
import "./EmployeeWorkspace.css";

// ── Sub-tab IDs ───────────────────────────────────────────────────────────────

const SUB_TAB_XRAY_REFERRALS    = "xray-referrals";
const SUB_TAB_XRAY_RESULTS      = "xray-results";
const SUB_TAB_REFERRAL_APPROVAL = "referral-approval";
const SUB_TAB_INSPECTION_FORM   = "inspection-form";
const SUB_TAB_NOTIFICATIONS     = "notifications";

type WorkspaceSubTab =
  | typeof SUB_TAB_XRAY_REFERRALS
  | typeof SUB_TAB_XRAY_RESULTS
  | typeof SUB_TAB_REFERRAL_APPROVAL
  | typeof SUB_TAB_INSPECTION_FORM
  | typeof SUB_TAB_NOTIFICATIONS;

const KNOWN_SUB_TABS = new Set<string>([
  SUB_TAB_XRAY_REFERRALS,
  SUB_TAB_XRAY_RESULTS,
  SUB_TAB_REFERRAL_APPROVAL,
  SUB_TAB_INSPECTION_FORM,
  SUB_TAB_NOTIFICATIONS,
]);

// ── Tab config (auto-registered by tabRegistry) ───────────────────────────────

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "employee-workspace",
  label: "إدارة مساحة العمل",
  order: 15,
  allowedRoles: ["guest", "employee", "supervisor", "manager", "admin"],
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: SUB_TAB_XRAY_REFERRALS,    label: "صور الأشعة المحالة" },
    { id: SUB_TAB_XRAY_RESULTS,      label: "نتائج فحص الأشعة" },
    { id: SUB_TAB_REFERRAL_APPROVAL, label: "اعتماد الطلبات" },
    { id: SUB_TAB_INSPECTION_FORM,   label: "نموذج الفحص" },
    { id: SUB_TAB_NOTIFICATIONS,     label: "مركز الإشعارات" },
  ],
};

// ── Main component ────────────────────────────────────────────────────────────

export default function EmployeeWorkspaceTab() {
  const { directoryHandle } = useWorkspace();
  const { can, canAccessTab } = usePermissions();
  const [activeSubTab, setActiveSubTab] = useState<WorkspaceSubTab>(SUB_TAB_XRAY_REFERRALS);

  // Keep sidebar in sync whenever the active subtab changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("pop-subtab-changed", { detail: activeSubTab }));
  }, [activeSubTab]);

  // Listen for sub-tab selection events dispatched by Sidebar
  useEffect(() => {
    function handler(e: CustomEvent<{ subTabId: string }>) {
      const { subTabId } = e.detail;
      if (KNOWN_SUB_TABS.has(subTabId)) {
        setActiveSubTab(subTabId as WorkspaceSubTab);
      }
    }
    window.addEventListener("pop-set-subtab", handler as EventListener);
    return () => window.removeEventListener("pop-set-subtab", handler as EventListener);
  }, []);

  if (!directoryHandle) {
    return (
      <section className="ew-page">
        <p className="ew-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  if (activeSubTab === SUB_TAB_XRAY_REFERRALS) {
    if (
      !canAccessTab("ew/xray-referrals") ||
      (!can("submit-answers") &&
        !can("submit-referrals") &&
        !can("request-replacement") &&
        !can("view-all-entries"))
    ) {
      return <AccessDenied />;
    }
    return <XrayReferrals directoryHandle={directoryHandle} />;
  }

  if (activeSubTab === SUB_TAB_REFERRAL_APPROVAL) {
    if (!canAccessTab("ew/referral-approval") || (!can("approve-referrals") && !can("approve-replacements"))) {
      return <AccessDenied />;
    }
    return <ReferralApproval directoryHandle={directoryHandle} />;
  }

  if (activeSubTab === SUB_TAB_XRAY_RESULTS) {
    if (!canAccessTab("ew/xray-results")) {
      return <AccessDenied />;
    }
    return <XrayInspectionResults directoryHandle={directoryHandle} />;
  }

  if (activeSubTab === SUB_TAB_INSPECTION_FORM) {
    if (!canAccessTab("ew/inspection-form")) {
      return <AccessDenied />;
    }
    return <TemplateBuilderTab />;
  }

  if (activeSubTab === SUB_TAB_NOTIFICATIONS) {
    if (!canAccessTab("ew/notifications")) {
      return <AccessDenied />;
    }
    return <NotificationManager directoryHandle={directoryHandle} />;
  }
  return <XrayReferrals directoryHandle={directoryHandle} />;
}
