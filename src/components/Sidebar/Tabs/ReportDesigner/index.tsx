/* eslint-disable react-refresh/only-export-components */
import { LayoutDashboard } from "lucide-react";
import type { SidebarTabModule } from "../tabTypes";
import "./ReportDesigner.css";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "report-designer",
  label: "مصمم التقارير",
  order: 27,
  allowedRoles: ["supervisor", "manager", "admin"],
  icon: <LayoutDashboard size={20} strokeWidth={1.8} aria-hidden />,
};

export default function ReportDesigner() {
  return (
    <div className="rd-root" dir="rtl">
      <h2 className="rd-title">مصمم التقارير</h2>
      <p className="rd-empty">لا توجد تقارير محفوظة بعد.</p>
    </div>
  );
}
