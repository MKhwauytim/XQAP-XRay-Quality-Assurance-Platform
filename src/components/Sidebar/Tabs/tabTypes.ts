import type { ComponentType, LazyExoticComponent, ReactNode } from "react";
import type { AuthRole } from "../../../auth/authTypes";

export type SidebarSubTab = {
  id: string;
  label: string;
  allowedRoles?: readonly AuthRole[];
};

export type SidebarTabDefinition = {
  id: string;
  label: string;
  order: number;
  allowedRoles: readonly AuthRole[];
  icon: ReactNode;
  TabComponent: ComponentType | LazyExoticComponent<ComponentType>;
  subTabs?: SidebarSubTab[];
};

export type SidebarTabModule = {
  default: ComponentType | LazyExoticComponent<ComponentType>;
  tabConfig?: Omit<SidebarTabDefinition, "TabComponent">;
};
