import type { SidebarTabDefinition, SidebarTabModule } from "./tabTypes";

const tabModules = import.meta.glob<SidebarTabModule>("./*/index.tsx", {
  eager: true
});

export const SIDEBAR_TABS: SidebarTabDefinition[] = Object.entries(tabModules)
  .filter(([, module]) => Boolean(module.tabConfig))
  .map(([, module]) => ({
    ...module.tabConfig,
    TabComponent: module.default
  }))
  .sort((firstTab, secondTab) => firstTab.order - secondTab.order);