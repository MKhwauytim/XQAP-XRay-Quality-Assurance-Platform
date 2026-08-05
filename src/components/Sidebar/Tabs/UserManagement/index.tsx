/* eslint-disable react-refresh/only-export-components */
import { lazy } from "react";
import { UserCog } from "lucide-react";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import type { SidebarTabModule } from "../tabTypes";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "user-management",
  label: "إدارة المستخدمين",
  order: 40,
  allowedRoles: tabAllowedRoles("user-management"),
  icon: <UserCog size={20} strokeWidth={1.8} aria-hidden />,
  subTabs: [
    { id: "users", label: "المستخدمون" },
    { id: "page-permissions", label: "صلاحيات الصفحات" },
    { id: "feature-permissions", label: "صلاحيات الميزات" },
    { id: "activity", label: "متابعة الأنشطة" },
    { id: "actions", label: "سجل الإجراءات" },
  ],
};

export default lazy(() => import("./TabView"));
