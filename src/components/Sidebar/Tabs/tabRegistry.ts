import type { SidebarTabDefinition, SidebarTabModule } from "./tabTypes";

const tabModules = import.meta.glob<SidebarTabModule>("./*/index.tsx", {
  eager: true
});

function hasTabConfig(
  entry: [string, SidebarTabModule]
): entry is [string, SidebarTabModule & { tabConfig: Omit<SidebarTabDefinition, "TabComponent"> }] {
  return Boolean(entry[1].tabConfig);
}

export const SIDEBAR_TABS: SidebarTabDefinition[] = Object.entries(tabModules)
  .filter(hasTabConfig)
  .map(([, module]) => ({
    ...module.tabConfig,
    TabComponent: module.default
  }))
  .sort((firstTab, secondTab) => firstTab.order - secondTab.order);
