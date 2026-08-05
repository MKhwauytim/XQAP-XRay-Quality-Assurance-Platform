/* eslint-disable react-refresh/only-export-components */
import { lazy } from "react";
import { BarChart3 } from "lucide-react";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import type { SidebarTabModule } from "../tabTypes";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "reports",
  label: "إدارة التقارير",
  order: 25,
  allowedRoles: tabAllowedRoles("reports"),
  icon: <BarChart3 size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "reports", label: "التقارير" },
    { id: "kpi", label: "مؤشرات الأداء", allowedRoles: tabAllowedRoles("reports/kpi") },
    { id: "report-designer", label: "مصمم التقارير", allowedRoles: tabAllowedRoles("reports/report-designer") },
  ],
};

export default lazy(() => import("./TabView"));
