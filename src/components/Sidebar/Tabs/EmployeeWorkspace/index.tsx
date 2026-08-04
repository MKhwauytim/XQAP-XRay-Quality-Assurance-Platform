/* eslint-disable react-refresh/only-export-components */
import { Suspense, useEffect, useMemo, useState } from "react";
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { usePermissions } from "../../../../auth/usePermissions";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { AccessDenied } from "../../../PermissionGuard";
import { touchVisitedTabs } from "../../../../app/visitedTabs";
import { useLabels } from "../../../../data/labels/useLabels";
import { LoadingState } from "../../../StateViews/StateViews";
import TemplateBuilderTab from "../TemplateBuilder";
import XrayReferrals from "./views/XrayReferrals";
import XrayInspectionResults from "./views/XrayInspectionResults";
import ReferralApproval from "./views/ReferralApproval";
import "./EmployeeWorkspace.css";

// ── Sub-tab IDs ───────────────────────────────────────────────────────────────

const SUB_TAB_XRAY_REFERRALS    = "xray-referrals";
const SUB_TAB_XRAY_RESULTS      = "xray-results";
const SUB_TAB_REFERRAL_APPROVAL = "referral-approval";
const SUB_TAB_INSPECTION_FORM   = "inspection-form";

type WorkspaceSubTab =
  | typeof SUB_TAB_XRAY_REFERRALS
  | typeof SUB_TAB_XRAY_RESULTS
  | typeof SUB_TAB_REFERRAL_APPROVAL
  | typeof SUB_TAB_INSPECTION_FORM;

const KNOWN_SUB_TABS = new Set<string>([
  SUB_TAB_XRAY_REFERRALS,
  SUB_TAB_XRAY_RESULTS,
  SUB_TAB_REFERRAL_APPROVAL,
  SUB_TAB_INSPECTION_FORM,
]);

// ── Tab config (auto-registered by tabRegistry) ───────────────────────────────

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "employee-workspace",
  label: "إدارة مساحة العمل",
  order: 15,
  allowedRoles: tabAllowedRoles("employee-workspace"),
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: SUB_TAB_XRAY_REFERRALS,    label: "صور الأشعة المحالة" },
    { id: SUB_TAB_XRAY_RESULTS,      label: "نتائج فحص الأشعة" },
    { id: SUB_TAB_REFERRAL_APPROVAL, label: "اعتماد الطلبات" },
    { id: SUB_TAB_INSPECTION_FORM,   label: "نموذج الفحص" },
  ],
};

// ── Main component ────────────────────────────────────────────────────────────

export default function EmployeeWorkspaceTab() {
  const { directoryHandle } = useWorkspace();
  const { can, canAccessTab } = usePermissions();
  const labels = useLabels();
  const [activeSubTab, setActiveSubTab] = useState<WorkspaceSubTab>(SUB_TAB_XRAY_REFERRALS);
  // Once a sub-tab has been the active tab, keep it mounted (hidden, not
  // unmounted) so switching back doesn't re-trigger its own data load — §T.
  // Adjusted during render (not in an effect) per React's "adjusting state
  // during render" pattern — mirrors ReportsTab's Report Designer gate —
  // avoiding both react-hooks/set-state-in-effect and the extra
  // effect-driven render pass a useEffect version would add.
  const [visitedSubTabs, setVisitedSubTabs] = useState<Set<WorkspaceSubTab>>(
    () => new Set([activeSubTab])
  );
  if (!visitedSubTabs.has(activeSubTab)) {
    setVisitedSubTabs((prev) => touchVisitedTabs(prev, activeSubTab));
  }

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

  // Stable element references (recomputed only when directoryHandle changes)
  // so switching activeSubTab back and forth — which re-renders
  // EmployeeWorkspaceTab — doesn't also re-invoke each visited view's own
  // render on every unrelated re-render; React bails out of re-rendering a
  // child subtree when the exact same element reference is passed again.
  const xrayReferralsElement = useMemo(
    () => (directoryHandle ? <XrayReferrals directoryHandle={directoryHandle} /> : null),
    [directoryHandle]
  );
  const referralApprovalElement = useMemo(
    () => (directoryHandle ? <ReferralApproval directoryHandle={directoryHandle} /> : null),
    [directoryHandle]
  );
  const xrayResultsElement = useMemo(
    () => (directoryHandle ? <XrayInspectionResults directoryHandle={directoryHandle} /> : null),
    [directoryHandle]
  );
  const inspectionFormElement = useMemo(() => <TemplateBuilderTab />, []);

  if (!directoryHandle) {
    return (
      <section className="ew-page">
        <p className="ew-empty">يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  const canViewXrayReferrals =
    canAccessTab("ew/xray-referrals") &&
    (can("submit-answers") ||
      can("submit-referrals") ||
      can("request-replacement") ||
      can("view-all-entries"));
  const canViewReferralApproval =
    canAccessTab("ew/referral-approval") &&
    (can("approve-referrals") || can("approve-replacements") || can("ew.reopenAnswer"));
  const canViewXrayResults = canAccessTab("ew/xray-results");
  const canViewInspectionForm = canAccessTab("ew/inspection-form");

  const activeAllowed =
    (activeSubTab === SUB_TAB_XRAY_REFERRALS && canViewXrayReferrals) ||
    (activeSubTab === SUB_TAB_REFERRAL_APPROVAL && canViewReferralApproval) ||
    (activeSubTab === SUB_TAB_XRAY_RESULTS && canViewXrayResults) ||
    (activeSubTab === SUB_TAB_INSPECTION_FORM && canViewInspectionForm);

  return (
    <>
      {visitedSubTabs.has(SUB_TAB_XRAY_REFERRALS) && canViewXrayReferrals && (
        <div hidden={activeSubTab !== SUB_TAB_XRAY_REFERRALS}>{xrayReferralsElement}</div>
      )}
      {visitedSubTabs.has(SUB_TAB_REFERRAL_APPROVAL) && canViewReferralApproval && (
        <div hidden={activeSubTab !== SUB_TAB_REFERRAL_APPROVAL}>{referralApprovalElement}</div>
      )}
      {visitedSubTabs.has(SUB_TAB_XRAY_RESULTS) && canViewXrayResults && (
        <div hidden={activeSubTab !== SUB_TAB_XRAY_RESULTS}>{xrayResultsElement}</div>
      )}
      {visitedSubTabs.has(SUB_TAB_INSPECTION_FORM) && canViewInspectionForm && (
        <div hidden={activeSubTab !== SUB_TAB_INSPECTION_FORM}>
          <Suspense fallback={<LoadingState label={labels.app_tab_loading} />}>
            {inspectionFormElement}
          </Suspense>
        </div>
      )}
      {!activeAllowed && <AccessDenied />}
    </>
  );
}
