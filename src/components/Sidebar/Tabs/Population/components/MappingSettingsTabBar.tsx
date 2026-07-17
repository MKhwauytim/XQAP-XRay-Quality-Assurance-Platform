export type MappingSettingsTab =
  "mappings" | "processing" | "stages" | "sheets" | "exports";

const TABS: Array<{
  id: Exclude<MappingSettingsTab, "processing">;
  label: string;
}> = [
  { id: "mappings", label: "تطابق الأعمدة والربط" },
  { id: "sheets", label: "أوراق العمل (Tabs)" },
  { id: "stages", label: "ترجمة المستويات" },
  { id: "exports", label: "أعمدة التصدير" },
];

export function MappingSettingsTabBar({
  activeTab,
  onChange,
}: {
  activeTab: MappingSettingsTab;
  onChange: (tab: MappingSettingsTab) => void;
}) {
  return (
    <div
      role="group"
      aria-label="أقسام إعدادات الربط"
      style={{
        display: "flex",
        background: "var(--population-bg-light)",
        borderBottom: "1px solid var(--population-border)",
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: isActive ? "var(--population-bg-card)" : "none",
              fontWeight: isActive ? "bold" : "normal",
              borderBottom: isActive
                ? "2px solid var(--population-primary)"
                : "none",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
