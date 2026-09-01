import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  ExportColumnSetting,
  PopulationConfig,
  StageAliasMappings,
  StageKey,
} from "../../../../../data/population/populationConfig";
import { DelimitedListInput } from "./DelimitedListInput";
import { STAGE_KEY_LABELS as STAGE_LABELS } from "./mappingSettingsConfig";

export function StageMappingsSection({
  stageMappings,
  onChange,
  onReset,
}: {
  stageMappings: StageAliasMappings;
  onChange: (stageKey: StageKey, value: string) => void;
  onReset: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
        حدد الكلمات أو القيم التي تعني كل مستوى. سيتم استخدام هذه القائمة في
        العرض، التصفية، المؤشرات، سحب العينة، والتوزيع. افصل بين القيم بفواصل.
      </p>
      {(Object.keys(STAGE_LABELS) as StageKey[]).map((stageKey) => (
        <label key={stageKey} className="save-disk-label">
          {STAGE_LABELS[stageKey]}
          <DelimitedListInput
            className="save-disk-input"
            value={stageMappings[stageKey] ?? []}
            onCommit={(aliases) => onChange(stageKey, aliases.join(", "))}
          />
        </label>
      ))}
      <button
        type="button"
        className="secondary-action"
        style={{ alignSelf: "flex-start" }}
        onClick={onReset}
      >
        استعادة القائمة الافتراضية
      </button>
    </div>
  );
}

export function ExportColumnsSection({
  config,
  onMove,
  onChange,
}: {
  config: PopulationConfig;
  onMove: (fieldKey: string, direction: "up" | "down") => void;
  onChange: (
    fieldKey: string,
    field: keyof ExportColumnSetting,
    value: ExportColumnSetting[keyof ExportColumnSetting],
  ) => void;
}) {
  const columns = [...(config.exportTemplates[0]?.columns ?? [])].sort(
    (a, b) => a.order - b.order,
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
        تحكم في تفعيل أو تعطيل، ترتيب، وتغيير عناوين الأعمدة المخرجة عند تصدير
        العينات لملفات Excel.
      </p>
      <div className="report-sheet-table" role="table">
        <div
          className="report-sheet-header"
          role="row"
          style={{ gridTemplateColumns: "auto 2fr 2fr 1fr" }}
        >
          <span>الترتيب</span>
          <span>اسم الحقل</span>
          <span>عنوان التصدير</span>
          <span>مفعل</span>
        </div>
        {columns.map((column, index) => (
          <div
            key={column.fieldKey}
            className="report-sheet-row"
            role="row"
            style={{
              gridTemplateColumns: "auto 2fr 2fr 1fr",
              alignItems: "center",
            }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                alignItems: "center",
              }}
            >
              <MoveButton
                direction="up"
                disabled={index === 0}
                onClick={() => onMove(column.fieldKey, "up")}
              />
              <MoveButton
                direction="down"
                disabled={index === columns.length - 1}
                onClick={() => onMove(column.fieldKey, "down")}
              />
            </span>
            <span
              style={{
                fontSize: "12px",
                color: "var(--population-muted)",
                fontFamily: "monospace",
              }}
            >
              {column.fieldKey}
            </span>
            <span>
              <input
                type="text"
                className="save-disk-input"
                style={{ padding: "4px", margin: 0 }}
                value={column.exportHeader}
                onChange={(event) =>
                  onChange(column.fieldKey, "exportHeader", event.target.value)
                }
              />
            </span>
            <span style={{ textAlign: "center" }}>
              <input
                type="checkbox"
                checked={column.isEnabled}
                onChange={(event) =>
                  onChange(column.fieldKey, "isEnabled", event.target.checked)
                }
              />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MoveButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}) {
  const label = direction === "up" ? "تحريك لأعلى" : "تحريك لأسفل";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "26px",
        height: "22px",
        border: "1px solid var(--population-border)",
        borderRadius: "4px",
        background: disabled ? "#f8fafc" : "#fff",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "#ccc" : "var(--population-primary)",
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title={label}
      aria-label={label}
    >
      {direction === "up" ? (
        <ChevronUp size={14} aria-hidden />
      ) : (
        <ChevronDown size={14} aria-hidden />
      )}
    </button>
  );
}
