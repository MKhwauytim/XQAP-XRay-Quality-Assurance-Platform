/* eslint-disable react-refresh/only-export-components */
import { BellRing } from "lucide-react";
import { tabAllowedRoles } from "../../../../auth/tabCatalog";
import { usePermissions } from "../../../../auth/usePermissions";
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { AccessDenied } from "../../../PermissionGuard";
import type { SidebarTabModule } from "../tabTypes";
import NotificationManager from "../EmployeeWorkspace/views/NotificationManager";

export const tabConfig: SidebarTabModule["tabConfig"] = {
  id: "ew/notifications",
  label: "مركز الإشعارات",
  order: 20,
  allowedRoles: tabAllowedRoles("ew/notifications"),
  icon: <BellRing size={20} strokeWidth={1.8} aria-hidden />,
};

export default function NotificationCenterTab() {
  const { directoryHandle } = useWorkspace();
  const { canAccessTab } = usePermissions();

  if (!canAccessTab("ew/notifications")) {
    return <AccessDenied />;
  }

  if (!directoryHandle) {
    return (
      <section className="ntf-page" dir="rtl">
        <p>يجب تحديد مساحة عمل أولاً.</p>
      </section>
    );
  }

  return <NotificationManager directoryHandle={directoryHandle} />;
}
