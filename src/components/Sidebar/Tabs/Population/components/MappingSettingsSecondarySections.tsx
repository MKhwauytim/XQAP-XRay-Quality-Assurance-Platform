import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  ExportColumnSetting,
  MappingTemplate,
  PopulationConfig,
  StageAliasMappings,
  StageKey,
} from "../../../../../data/population/populationConfig";

const STAGE_LABELS: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

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
          <input
            type="text"
            className="save-disk-input"
            value={(stageMappings[stageKey] ?? []).join(", ")}
            onChange={(event) => onChange(stageKey, event.target.value)}
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

export function WorkbookSheetsSection({
  template,
  fields,
  riskSheetNames,
  biSheetNames,
  riskColumnHints,
  biColumnHints,
  onApplyDetected,
  onPatternChange,
}: {
  template: MappingTemplate;
  fields: Array<{ key: string; label: string }>;
  riskSheetNames: string[];
  biSheetNames: string[];
  riskColumnHints: Record<string, string[]>;
  biColumnHints: Record<string, string[]>;
  onApplyDetected: () => void;
  onPatternChange: (type: "risk" | "bi", value: string) => void;
}) {
  const hasDetectedSheets = riskSheetNames.length > 0 || biSheetNames.length > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <p style={{ fontSize: "13px", color: "var(--population-muted)" }}>
        تتم قراءة كل أوراق العمل في الملفات المرفوعة. استخدم هذه الأنماط فقط
        لتصنيف مصدر الورقة ونوع الحركة عند الحاجة.
      </p>
      {hasDetectedSheets && (
        <div
          style={{
            border: "1px solid #dbeafe",
            borderRadius: "12px",
            background: "#eff6ff",
            padding: "12px",
            display: "grid",
            gap: "10px",
          }}
        >
          <strong style={{ color: "#17365d" }}>
            الأوراق والأعمدة المكتشفة من الملفات المرفوعة
          </strong>
          {riskSheetNames.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "#334155" }}>
              أوراق المخاطر: {riskSheetNames.join("، ")}
            </p>
          )}
          {biSheetNames.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: "#334155" }}>
              أوراق BI: {biSheetNames.join("، ")}
            </p>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "10px",
            }}
          >
            <ColumnHints
              title="أعمدة المخاطر المكتشفة"
              fields={fields}
              hints={riskColumnHints}
            />
            <ColumnHints
              title="أعمدة BI المكتشفة"
              fields={fields}
              hints={biColumnHints}
            />
          </div>
          <button
            type="button"
            className="secondary-action"
            style={{ justifySelf: "start" }}
            onClick={onApplyDetected}
          >
            تطبيق الأسماء والأعمدة المكتشفة
          </button>
        </div>
      )}
      <label className="save-disk-label">
        أنماط أسماء أوراق المخاطر (Risk Sheet Patterns)
        <input
          type="text"
          className="save-disk-input"
          value={template.sheetPatterns.risk.join(", ")}
          onChange={(event) => onPatternChange("risk", event.target.value)}
        />
      </label>
      <label className="save-disk-label">
        أنماط أسماء أوراق ذكاء الأعمال (BI Sheet Patterns)
        <input
          type="text"
          className="save-disk-input"
          value={template.sheetPatterns.bi.join(", ")}
          onChange={(event) => onPatternChange("bi", event.target.value)}
        />
      </label>
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

function ColumnHints({
  title,
  fields,
  hints,
}: {
  title: string;
  fields: Array<{ key: string; label: string }>;
  hints: Record<string, string[]>;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #dbeafe",
        borderRadius: "10px",
        padding: "10px",
      }}
    >
      <strong
        style={{
          display: "block",
          marginBottom: "8px",
          color: "#1e3a8a",
          fontSize: 12,
        }}
      >
        {title}
      </strong>
      <div style={{ display: "grid", gap: "6px" }}>
        {fields.map((field) => {
          const matches = hints[field.key] ?? [];
          return (
            <div
              key={field.key}
              style={{ display: "grid", gap: "2px", fontSize: 11 }}
            >
              <span style={{ color: "#334155", fontWeight: 800 }}>
                {field.label}
              </span>
              <span
                style={{ color: matches.length > 0 ? "#166534" : "#b45309" }}
              >
                {matches.length > 0
                  ? matches.join("، ")
                  : "لم يتم العثور على تطابق واضح"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
