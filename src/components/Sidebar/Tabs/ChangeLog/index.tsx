/* eslint-disable react-refresh/only-export-components */
import { lazy } from "react";
import { History } from "lucide-react";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import type { SidebarTabModule } from "../tabTypes";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "change-log",
  label: "سجل الإصدارات",
  order: 96,
  allowedRoles: tabAllowedRoles("change-log"),
  icon: <History size={20} strokeWidth={1.8} aria-hidden />,
};

export default lazy(() => import("./TabView"));
